#!/usr/bin/env node
/**
 * agy-shim — a logging pass-through for the Antigravity IDE <-> agy hub hop.
 *
 * WHY THIS EXISTS
 *
 * Intercepting Antigravity at `agy -> Google` is impossible: ~/.gemini/bin/agy is a
 * Go/boringcrypto binary carrying its own cert pool, with zero references to
 * HTTPS_PROXY, SSL_CERT_FILE, NODE_EXTRA_CA_CERTS or GODEBUG. No DNS redirect,
 * CONNECT proxy or transparent-decrypt scheme can touch it.
 *
 * The OTHER hop is wide open. The IDE spawns
 *   agy --hub --hub-port=<port> --app_data_dir=antigravity --csrf_token=<uuid>
 * and talks to it over PLAIN HTTP on loopback -- Connect RPC (@bufbuild,
 * exa.language_server_pb.LanguageServerService) with an x-codeium-csrf-token
 * header. No TLS, so no certificate is involved at all.
 *
 * And the IDE supports being repointed, in getEffectiveServerUrl():
 *   process.env.ANTIGRAVITY_SERVER_URL
 *     ?? workspace.getConfiguration("antigravity").get("serverUrl")
 *     ?? this.serverUrl
 *
 * WHAT THIS DOES, AND DELIBERATELY DOES NOT DO
 *
 * It forwards every byte in both directions, unchanged, and writes down what went
 * past. It rewrites nothing. The point is to answer three questions before any
 * real interception is written:
 *
 *   1. Is the override actually honoured for the chat, or does the JetskiWeb
 *      webview learn the hub port some other way?  -> does anything arrive at all
 *   2. Do the streaming Cascade RPCs need HTTP/2?   -> the `http` column
 *   3. How much of the 347-RPC surface must be served before the IDE works?
 *                                                   -> the summary on exit
 *
 * USAGE
 *
 *   node scripts/antigravity/agy-shim.js
 *
 * It finds the running agy hub port by itself. Then, in Antigravity, set
 *   "antigravity.serverUrl": "http://127.0.0.1:20130"
 * and reload the window (or relaunch with ANTIGRAVITY_SERVER_URL set to it).
 * Ctrl-C prints a per-RPC summary. Remove the setting to go back to normal.
 *
 * Both HTTP/1.1 and h2c arrive on the same port, so the first bytes of each
 * connection are sniffed for the HTTP/2 preface and the socket is handed to
 * whichever server speaks it.
 */

const net = require("net");
const http = require("http");
const http2 = require("http2");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const LISTEN_PORT = Number(process.env.AGY_SHIM_PORT || 20130);
const LOG_DIR = process.env.AGY_SHIM_LOG_DIR || path.join(os.homedir(), ".krouter", "logs");
const LOG_FILE = path.join(LOG_DIR, "agy-shim.jsonl");

// The HTTP/2 cleartext connection preface. A client that sends this is speaking
// h2c and would be rejected outright by an HTTP/1.1 server.
const H2_PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "ascii");

const stats = new Map(); // rpc -> { count, http1, http2, bytesIn, bytesOut, ms, statuses }

function recordCall({ rpc, isRpc, httpVersion, bytesIn, bytesOut, ms, status }) {
  const s = stats.get(rpc) || {
    count: 0, http1: 0, http2: 0, bytesIn: 0, bytesOut: 0, ms: 0, statuses: new Set(), isRpc,
  };
  s.count += 1;
  if (httpVersion === "2") s.http2 += 1; else s.http1 += 1;
  s.bytesIn += bytesIn;
  s.bytesOut += bytesOut;
  s.ms += ms;
  s.statuses.add(status);
  stats.set(rpc, s);
}

let logStream = null;
function logLine(entry) {
  if (!logStream) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
  }
  logStream.write(`${JSON.stringify(entry)}\n`);
}

/** A Connect RPC path is /<pkg>.<Service>/<Method>; anything else is a web asset. */
function describePath(url) {
  const p = String(url || "").split("?")[0];
  const m = p.match(/^\/([A-Za-z0-9_.]+)\/([A-Za-z0-9_]+)$/);
  return m ? { rpc: `${m[1].split(".").pop()}/${m[2]}`, isRpc: true } : { rpc: p, isRpc: false };
}

/** Find the agy hub the IDE already spawned, so there is nothing to look up by hand. */
function discoverUpstream() {
  if (process.env.AGY_UPSTREAM) {
    const [host, port] = process.env.AGY_UPSTREAM.split(":");
    return { host: host || "127.0.0.1", port: Number(port) };
  }
  let out = "";
  try {
    out = execSync("ps -Ao command=", { encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 });
  } catch {
    throw new Error("could not list processes to find the agy hub");
  }
  const line = out.split("\n").find((l) => l.includes("/agy") && l.includes("--hub-port="));
  if (!line) {
    throw new Error(
      "no running `agy --hub` found. Start Antigravity first, or set AGY_UPSTREAM=127.0.0.1:<port>"
    );
  }
  const port = Number((line.match(/--hub-port=(\d+)/) || [])[1]);
  if (!port) throw new Error("found agy but could not read --hub-port");
  return { host: "127.0.0.1", port };
}

// ── HTTP/1.1 ─────────────────────────────────────────────────

function createH1Server(upstream) {
  return http.createServer((req, res) => {
    const started = Date.now();
    const { rpc, isRpc } = describePath(req.url);
    let bytesIn = 0;
    let bytesOut = 0;

    // Forward the client's headers untouched -- including x-codeium-csrf-token,
    // without which the hub rejects the call.
    const headers = { ...req.headers, host: `${upstream.host}:${upstream.port}` };

    const fwd = http.request(
      { host: upstream.host, port: upstream.port, method: req.method, path: req.url, headers },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.on("data", (c) => { bytesOut += c.length; });
        up.pipe(res);
        up.on("end", () => {
          const ms = Date.now() - started;
          const entry = {
            t: new Date().toISOString(), http: "1.1", method: req.method, rpc,
            isRpc, status: up.statusCode, bytesIn, bytesOut, ms,
            ct: req.headers["content-type"] || null,
          };
          logLine(entry);
          recordCall({ rpc, isRpc, httpVersion: "1.1", bytesIn, bytesOut, ms, status: up.statusCode });
          if (isRpc) {
            console.log(
              `  h1 ${String(up.statusCode).padEnd(3)} ${rpc.padEnd(52)} ` +
              `${String(bytesIn).padStart(7)}B ->${String(bytesOut).padStart(8)}B  ${ms}ms`
            );
          }
        });
      }
    );

    fwd.on("error", (e) => {
      console.error(`  h1 ERR ${rpc}: ${e.message}`);
      logLine({ t: new Date().toISOString(), http: "1.1", rpc, error: e.message });
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(`agy-shim: ${e.message}`);
    });

    req.on("data", (c) => { bytesIn += c.length; });
    req.pipe(fwd);
  });
}

// ── HTTP/2 (h2c) ─────────────────────────────────────────────

function createH2Server(upstream) {
  const server = http2.createServer();
  server.on("stream", (stream, headers) => {
    const started = Date.now();
    const reqPath = headers[":path"] || "/";
    const { rpc, isRpc } = describePath(reqPath);
    let bytesIn = 0;
    let bytesOut = 0;

    const client = http2.connect(`http://${upstream.host}:${upstream.port}`);
    client.on("error", (e) => {
      console.error(`  h2 ERR ${rpc}: ${e.message}`);
      logLine({ t: new Date().toISOString(), http: "2", rpc, error: e.message });
      if (!stream.destroyed) stream.respond({ ":status": 502 }, { endStream: true });
      client.close();
    });

    // Pseudo-headers other than these are set by the client call itself; the
    // connection-level ones must not be forwarded.
    const fwdHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      if (k === ":authority" || k === ":scheme" || k === "connection") continue;
      fwdHeaders[k] = v;
    }
    fwdHeaders[":authority"] = `${upstream.host}:${upstream.port}`;

    const up = client.request(fwdHeaders);
    let status = null;
    up.on("response", (resHeaders) => {
      // Read the real :status rather than assuming one -- 401 vs 200 is how we
      // tell whether the csrf header survived the hop.
      status = Number(resHeaders[":status"]) || null;
      const clean = { ...resHeaders };
      delete clean["connection"];
      if (!stream.destroyed) stream.respond(clean);
    });
    up.on("data", (c) => { bytesOut += c.length; });
    up.pipe(stream);
    up.on("end", () => {
      const ms = Date.now() - started;
      logLine({
        t: new Date().toISOString(), http: "2", method: headers[":method"], rpc, isRpc,
        status, bytesIn, bytesOut, ms, ct: headers["content-type"] || null,
      });
      recordCall({ rpc, isRpc, httpVersion: "2", bytesIn, bytesOut, ms, status });
      if (isRpc) {
        console.log(
          `  h2 ${String(status ?? "-").padEnd(3)} ${rpc.padEnd(52)} ` +
          `${String(bytesIn).padStart(7)}B ->${String(bytesOut).padStart(8)}B  ${ms}ms`
        );
      }
      client.close();
    });

    stream.on("data", (c) => { bytesIn += c.length; });
    stream.pipe(up);
    stream.on("error", () => { try { client.close(); } catch { /* ignore */ } });
  });
  return server;
}

// ── Front door: sniff the preface, hand the socket to the right server ──

function start() {
  const upstream = discoverUpstream();
  const h1 = createH1Server(upstream);
  const h2 = createH2Server(upstream);

  const front = net.createServer((socket) => {
    socket.setNoDelay(true);
    socket.once("readable", () => {
      // An h2c client opens with a fixed 24-byte preface. Read just enough to
      // tell, then put it back so the chosen server parses from the start.
      const peek = socket.read(H2_PREFACE.length) || socket.read() || Buffer.alloc(0);
      if (peek.length) socket.unshift(peek);
      const isH2 = peek.length >= 4 && peek.subarray(0, 4).equals(H2_PREFACE.subarray(0, 4));
      (isH2 ? h2 : h1).emit("connection", socket);
    });
    socket.on("error", () => socket.destroy());
  });

  front.listen(LISTEN_PORT, "127.0.0.1", () => {
    console.log(`agy-shim listening on http://127.0.0.1:${LISTEN_PORT}`);
    console.log(`  forwarding to the real agy hub at ${upstream.host}:${upstream.port}`);
    console.log(`  log: ${LOG_FILE}`);
    console.log("");
    console.log("In Antigravity, set this and reload the window:");
    console.log(`  "antigravity.serverUrl": "http://127.0.0.1:${LISTEN_PORT}"`);
    console.log("");
    console.log("Ctrl-C for a per-RPC summary. Nothing is modified -- this only watches.");
    console.log("");
  });

  const summarise = () => {
    const all = [...stats.entries()];
    const rows = all.filter(([, s]) => s.isRpc);
    const assets = all.filter(([, s]) => !s.isRpc);
    console.log("\n── RPCs seen ────────────────────────────────────────────────");
    if (!rows.length) {
      console.log("  NOTHING ARRIVED.");
      console.log("  Either the setting was not applied (reload the window after setting it),");
      console.log("  or the IDE reaches the hub without consulting antigravity.serverUrl --");
      console.log("  which is exactly the thing this shim exists to find out.");
    } else {
      rows.sort((a, b) => b[1].count - a[1].count);
      console.log(
        `  ${"RPC".padEnd(52)} ${"n".padStart(4)} ${"h1".padStart(4)} ${"h2".padStart(4)} ` +
        `${"in".padStart(9)} ${"out".padStart(10)}  avg`
      );
      for (const [rpc, s] of rows) {
        console.log(
          `  ${rpc.padEnd(52)} ${String(s.count).padStart(4)} ${String(s.http1).padStart(4)} ` +
          `${String(s.http2).padStart(4)} ${String(s.bytesIn).padStart(8)}B ` +
          `${String(s.bytesOut).padStart(9)}B  ${Math.round(s.ms / s.count)}ms`
        );
      }
      const anyH2 = rows.some(([, s]) => s.http2 > 0);
      console.log(`\n  HTTP/2 used: ${anyH2 ? "YES — a shim must speak h2c" : "no — HTTP/1.1 was enough"}`);
      console.log(`  distinct RPCs: ${rows.length}  (of 347 request types in the schema)`);
      console.log(`  non-RPC requests (webview assets, etc.): ${assets.length} path(s)`);
    }
    console.log(`\n  full detail: ${LOG_FILE}`);
    process.exit(0);
  };

  process.on("SIGINT", summarise);
  process.on("SIGTERM", summarise);
}

try {
  start();
} catch (e) {
  console.error(`agy-shim: ${e.message}`);
  process.exit(1);
}
