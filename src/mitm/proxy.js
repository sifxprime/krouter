const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const { log, err } = require("./logger");
const { getToolForHost } = require("./config");
const { decideRoute } = require("./dispatch");
const { getSecureContext } = require("./certContext");
const { resolveTargetIP } = require("./resolveUpstream");

// 0.5.175 — Proxy capture mode.
//
// The second way to get an IDE's traffic to kRouter. The first (server.js) spoofs
// DNS in /etc/hosts and listens on :443. That works, and it costs:
//
//   - a sudo prompt on every toggle, for the hosts file and the privileged port
//   - machine-wide scope: redirecting api.anthropic.com redirects it for the
//     browser, curl and every script on the box, not just the IDE
//   - a black hole if kRouter is not listening while the entries remain, which
//     is the failure the 0.5.171 watchdog caused and 0.5.173 had to patch
//   - state on disk that something has to heal
//   - one hosts line per host, from a hardcoded list
//
// This mode listens on an ordinary port and speaks HTTP CONNECT. Only the client
// configured to use it is affected, nothing privileged is touched, nothing is
// left behind, and a kRouter that is not running means one refused connection in
// one app rather than a domain the whole machine cannot reach.
//
// It does NOT remove the certificate-trust requirement, and it only works for
// clients that honour a proxy setting. Antigravity's chat agent honours neither
// a proxy variable nor a CA override, so this does not help it; see
// MITM_TOOLS.antigravity.mitmLimitation.

const DEFAULT_PROXY_PORT = 20129;
const HEALTH_PATH = "/_krouter_proxy_health";

const handlers = {
  antigravity: require("./handlers/antigravity"),
  kiro: require("./handlers/kiro"),
  cursor: require("./handlers/cursor"),
  claude: require("./handlers/claude"),
};

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Forward a decrypted request on to the real vendor.
 *
 * Simpler than the :443 transport's passthrough, which has to rewrite hosts and
 * probe ALPN. Here nothing in the OS has been touched, so the only hazard is the
 * DNS capture mode being on for the same host at the same time: resolveTargetIP
 * bypasses /etc/hosts so we reach the vendor rather than our own listener.
 *
 * The ORIGINAL bytes are sent, with the client's own headers -- those still say
 * `content-encoding: gzip`, so a decoded body here would be a malformed request.
 */
async function forwardUpstream(req, res, bodyBuffer, host) {
  const headers = { ...req.headers, host };
  delete headers["proxy-connection"];

  let ip;
  try {
    ip = await resolveTargetIP(host);
  } catch (e) {
    err(`[proxy] DNS failed for ${host}: ${e.message}`);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { message: `DNS failed for ${host}`, type: "proxy_dns_error" } }));
  }

  log(`[proxy passthrough] ${req.method} ${host}${req.url}`);
  const upstream = https.request(
    { hostname: ip, servername: host, port: 443, path: req.url, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on("error", (e) => {
    err(`[proxy] upstream error for ${host}: ${e.message}`);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: e.message, type: "proxy_upstream_error" } }));
  });
  if (bodyBuffer && bodyBuffer.length) upstream.write(bodyBuffer);
  upstream.end();
}

/**
 * Blind-tunnel a host we do not intercept: copy bytes both ways without looking.
 * Normal OS resolution on purpose -- a tunnelled host may be internal or
 * corporate, and only the hosts we intercept can be the ones in /etc/hosts.
 */
function tunnel(host, port, clientSocket, head) {
  const upstream = net.connect(port, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  const drop = () => { upstream.destroy(); clientSocket.destroy(); };
  upstream.on("error", (e) => {
    if (!clientSocket.destroyed) clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\n\r\n${e.code || ""}`);
    drop();
  });
  clientSocket.on("error", drop);
}

/** The plain HTTP server that handles requests after TLS is terminated. */
function createDecryptedServer() {
  return http.createServer(async (req, res) => {
    const host = String(req.headers.host || "").split(":")[0];
    try {
      const bodyBuffer = await collectBody(req);
      const route = decideRoute(req, bodyBuffer);

      if (route.action === "passthrough") {
        return forwardUpstream(req, res, bodyBuffer, host);
      }

      // The path is in the line because of a real incident shape: Claude Desktop
      // produced ~100 identical-looking intercepts in one second on launch, and
      // without the path there is no telling a count_tokens fan-out (benign,
      // one per conversation in the sidebar) from a retry storm (not benign).
      log(`[proxy intercept] ${route.tool} ${route.model || "?"} ${String(req.url || "").split("?")[0]} -> ${route.mappedModel}`);
      // Hand the handler the DECODED body and a passthrough that still sends the
      // original bytes, exactly as the :443 transport does.
      return handlers[route.tool].intercept(
        req, res, route.body, route.mappedModel,
        (q, s, b) => forwardUpstream(q, s, b || bodyBuffer, host)
      );
    } catch (e) {
      err(`[proxy] unhandled error for ${host}: ${e.message}`);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message, type: "proxy_error" } }));
    }
  });
}

/**
 * Start the proxy. Resolves once it is accepting connections.
 * Needs no elevation: an ordinary port, no hosts file, no system settings.
 */
function startProxy({ port = DEFAULT_PROXY_PORT, host = "127.0.0.1" } = {}) {
  const decrypted = createDecryptedServer();

  const proxy = http.createServer((req, res) => {
    if (req.url === HEALTH_PATH || req.url === `http://${host}:${port}${HEALTH_PATH}`) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, pid: process.pid, mode: "proxy", port }));
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("kRouter proxy capture mode. Point HTTPS_PROXY at this address.\n");
  });

  proxy.on("connect", (req, clientSocket, head) => {
    clientSocket.setNoDelay(true);
    const [reqHost, reqPort] = String(req.url || "").split(":");
    const targetPort = Number(reqPort || 443);

    // Anything we do not intercept is tunnelled untouched, so pointing a whole
    // app at this proxy never breaks its other traffic.
    if (!reqHost || targetPort !== 443 || !getToolForHost(reqHost)) {
      return tunnel(reqHost, targetPort, clientSocket, head);
    }

    let ctx;
    try {
      ctx = getSecureContext(reqHost);
    } catch (e) {
      err(`[proxy] no certificate for ${reqHost}: ${e.message}`);
      return tunnel(reqHost, targetPort, clientSocket, head);
    }

    clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: kRouter\r\n\r\n");
    // Bytes already read past the CONNECT line belong to the ClientHello.
    if (head && head.length) clientSocket.unshift(head);

    const tlsSocket = new tls.TLSSocket(clientSocket, { isServer: true, secureContext: ctx });
    tlsSocket.on("error", (e) => {
      // A client that does not trust our root lands here. It is the same trust
      // requirement as the :443 mode, so say which host so it is diagnosable.
      err(`[proxy] TLS error for ${reqHost}: ${e.message}`);
      tlsSocket.destroy();
    });
    decrypted.emit("connection", tlsSocket);
  });

  proxy.on("clientError", (e, socket) => {
    if (!socket.destroyed) socket.destroy();
  });

  return new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(port, host, () => {
      // Report the port actually bound, not the one asked for: port 0 means
      // "any free port", which tests use so they never collide with a running
      // proxy or with each other.
      const bound = proxy.address().port;
      log(`[proxy] capture mode listening on ${host}:${bound}`);
      resolve({
        port: bound,
        host,
        server: proxy,
        close: () => new Promise((done) => proxy.close(done)),
      });
    });
  });
}

module.exports = { startProxy, DEFAULT_PROXY_PORT, HEALTH_PATH, _forwardUpstream: forwardUpstream };

// Standalone entrypoint, so the manager can spawn this WITHOUT sudo -- the whole
// point of the mode. Same env contract as the :443 server (ROUTER_API_KEY,
// MITM_ROUTER_BASE), so manager.js reuses the environment it already builds.
if (require.main === module) {
  startProxy({ port: Number(process.env.MITM_PROXY_PORT || DEFAULT_PROXY_PORT) }).catch((e) => {
    err(`[proxy] failed to start: ${e.message}`);
    process.exit(1);
  });
}
