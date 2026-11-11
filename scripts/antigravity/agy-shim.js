/**
 * agy-shim — sit between the Antigravity IDE and the agy hub, and watch the hop.
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
 * WHY IT SPAWNS ITS OWN HUB
 *
 * Setting that override stops the IDE spawning `agy` at all. The first version of
 * this tool only forwarded to "the hub that is already running", so with the
 * override in place there was no hub to forward to and the run printed
 * NOTHING ARRIVED -- which looked like the override being ignored, and was not.
 *
 * If we are the server URL, we have to be the one that brings a hub up. So by
 * default this starts its own `agy --hub` on a private port and fronts it. Two
 * consequences:
 *
 *   - The hub's csrf token is ours, and the IDE cannot know it, so the token on
 *     each request is swapped on the way through. That is the only byte this
 *     changes, and every call is logged.
 *   - The hub is ours to clean up. It is not detached, and it is killed on the way
 *     out, including on a crash -- an orphan would hold its port and ~200MB.
 *
 * `--attach` keeps the original behaviour: forward to a hub somebody else started
 * and change nothing at all.
 *
 * WHAT IT IS FOR
 *
 * Answering three questions before any real interception is written:
 *
 *   1. Is the override honoured for the chat, or does the JetskiWeb webview learn
 *      the hub port some other way?                 -> does anything arrive at all
 *   2. Do the streaming Cascade RPCs need HTTP/2?   -> the `http` column
 *   3. How much of the 347-RPC surface must be served before the IDE works?
 *                                                   -> the summary on exit
 *
 * USAGE
 *
 *   node scripts/antigravity/agy-shim.js --add-dir="$PWD"
 *
 * Then, in Antigravity, set
 *   "antigravity.serverUrl": "http://127.0.0.1:20130"
 * in settings.json and reload the window. Ctrl-C prints a per-RPC summary and
 * stops the hub. Remove the setting to go back to normal. `--help` for the rest.
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
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");

const LISTEN_PORT = Number(process.env.AGY_SHIM_PORT || 20130);
const LOG_DIR = process.env.AGY_SHIM_LOG_DIR || path.join(os.homedir(), ".krouter", "logs");
const LOG_FILE = path.join(LOG_DIR, "agy-shim.jsonl");
const HUB_LOG_FILE = path.join(LOG_DIR, "agy-hub.log");
const AGY_BIN = process.env.AGY_BIN || path.join(os.homedir(), ".gemini", "bin", "agy");
const APP_DATA_DIR = process.env.AGY_APP_DATA_DIR || "antigravity";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * Ports of every running `agy --hub`, excluding ones this process started.
 *
 * The exclusion is the point: without it the first match is usually our own child,
 * the "the IDE still has its own hub" warning never fires, and a run where the IDE
 * ignored serverUrl looks identical to one where it obeyed and said nothing.
 */
function findRunningHubPorts(excludePort = null) {
  let out = "";
  try {
    out = execSync("ps -Ao command=", { encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 });
  } catch {
    return [];
  }
  return out
    .split("\n")
    .filter((l) => l.includes("/agy") && l.includes("--hub-port="))
    .map((l) => Number((l.match(/--hub-port=(\d+)/) || [])[1]))
    .filter((port) => port && port !== excludePort);
}

/** Ask the OS for a port nobody is using, then let go of it. */
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Poll until something accepts on `port`.
 *
 * The delay is not optional. ECONNREFUSED comes back in microseconds, so a loop
 * without a sleep burns all its attempts before the thing it is waiting for has
 * finished starting -- the exact bug that made proxy-capture mode report ready
 * when nothing was listening.
 */
async function waitForPort(port, { tries = 80, delayMs = 250 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const open = await new Promise((resolve) => {
      const probe = net.connect({ host: "127.0.0.1", port });
      const settle = (value) => { probe.destroy(); resolve(value); };
      probe.setTimeout(1000, () => settle(false));
      probe.once("connect", () => settle(true));
      probe.once("error", () => settle(false));
    });
    if (open) return true;
    await sleep(delayMs);
  }
  return false;
}

function tailFile(file, lines = 14) {
  try {
    const text = fs.readFileSync(file, "utf-8").trimEnd();
    if (!text) return "(the hub wrote nothing)";
    return text.split("\n").slice(-lines).map((l) => `    ${l}`).join("\n");
  } catch {
    return "(no hub log)";
  }
}

/**
 * Start our own hub and own it.
 *
 * This is the whole reason the shim was rewritten. Setting `antigravity.serverUrl`
 * stops the IDE spawning `agy` at all -- so a pass-through shim pointed at "the
 * running hub" has no upstream to point at, and the first run of this tool printed
 * NOTHING ARRIVED for exactly that reason. If we are the server URL, we have to be
 * the one that brings up a hub.
 *
 * Because the hub is ours, its csrf token is ours too, and the IDE's token will not
 * match it. So this mode rewrites `x-codeium-csrf-token` on the way through. That
 * is the one byte-level change the shim makes, and it is logged.
 */
async function spawnOwnHub(addDirs) {
  if (!fs.existsSync(AGY_BIN)) {
    throw new Error(`no agy binary at ${AGY_BIN} -- set AGY_BIN=/path/to/agy`);
  }
  const port = await pickFreePort();
  const csrfToken = crypto.randomUUID();
  const args = [
    "--hub",
    `--hub-port=${port}`,
    `--app_data_dir=${APP_DATA_DIR}`,
    `--csrf_token=${csrfToken}`,
    ...addDirs.map((dir) => `--add-dir=${dir}`),
  ];

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const hubLog = fs.openSync(HUB_LOG_FILE, "a");
  fs.writeSync(hubLog, `\n=== agy hub spawned by agy-shim at ${new Date().toISOString()} on port ${port} ===\n`);

  // stdin MUST be a pipe. With "ignore" it is /dev/null, and agy then goes looking
  // for a controlling terminal and dies with
  //   bubbletea: could not open TTY: open /dev/tty: device not configured
  // after it has already bound the hub port -- so readiness passes and every
  // request afterwards is ECONNREFUSED. The IDE spawns it with a pipe; so do we.
  //
  // Deliberately NOT detached: when the shim goes away the hub goes with it. An
  // orphaned 200MB hub sitting on a port is the failure mode the proxy-capture
  // work already paid for once.
  // AGY_ENABLE_HUB=1 is load-bearing and undocumented. Without it `--hub` is
  // simply ignored: agy runs its interactive CLI instead, which either dies
  // hunting for a TTY (stdin=/dev/null) or sits forever waiting on stdin
  // (stdin=pipe) -- in both cases binding nothing, with the flag accepted and no
  // complaint. Read off the IDE's own agy process, which sets it alongside
  // ANTIGRAVITY_VSCODE_HOST=1.
  const child = spawn(AGY_BIN, args, {
    stdio: ["pipe", hubLog, hubLog],
    env: { ...process.env, AGY_ENABLE_HUB: "1", ANTIGRAVITY_VSCODE_HOST: "1" },
  });

  let exit = null;
  let serving = false;
  const onGone = (why) => {
    exit = why;
    if (!serving) return;
    // Before this, a hub that died after startup left the shim cheerfully
    // answering `502 ECONNREFUSED` forever, with the reason only in a log file
    // nobody had been told to read.
    console.error("");
    console.error(`agy-shim: the hub exited (${why.message || `code=${why.code} signal=${why.signal}`}).`);
    console.error(`  Nothing can be forwarded now. Hub log: ${HUB_LOG_FILE}`);
    console.error(tailFile(HUB_LOG_FILE));
    process.exit(1);
  };
  child.on("exit", (code, signal) => onGone({ code, signal }));
  child.on("error", (e) => onGone({ code: null, signal: null, message: e.message }));

  console.log(`agy-shim: starting our own hub -- ${AGY_BIN}`);
  console.log(`  --hub-port=${port} --app_data_dir=${APP_DATA_DIR}${addDirs.length ? ` (+${addDirs.length} --add-dir)` : ""}`);

  const ready = await waitForPort(port);
  if (!ready || exit) {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    const why = exit
      ? `it exited (${exit.message || `code=${exit.code} signal=${exit.signal}`})`
      : "it never accepted a connection";
    throw new Error(
      `the hub did not come up on port ${port} -- ${why}\n  hub log: ${HUB_LOG_FILE}\n${tailFile(HUB_LOG_FILE)}`
    );
  }

  serving = true;
  return { host: "127.0.0.1", port, csrfToken, child, mode: "spawned" };
}

/** Attach to a hub somebody else started, and change nothing at all. */
function attachToHub(explicit) {
  if (explicit) {
    const [host, port] = explicit.split(":");
    return { host: host || "127.0.0.1", port: Number(port), csrfToken: null, child: null, mode: "attached" };
  }
  const [port] = findRunningHubPorts();
  if (!port) {
    throw new Error(
      "no running `agy --hub` to attach to. Start Antigravity first, pass AGY_UPSTREAM=127.0.0.1:<port>,\n" +
      "  or drop --attach and let the shim start its own hub."
    );
  }
  return { host: "127.0.0.1", port, csrfToken: null, child: null, mode: "attached" };
}

function parseArgs(argv) {
  const opts = { attach: false, addDirs: [] };
  for (const arg of argv) {
    if (arg === "--attach") opts.attach = true;
    else if (arg.startsWith("--add-dir=")) opts.addDirs.push(arg.slice("--add-dir=".length));
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`unknown argument ${arg} (try --help)`);
  }
  return opts;
}

async function resolveUpstream(opts) {
  if (process.env.AGY_UPSTREAM) return attachToHub(process.env.AGY_UPSTREAM);
  if (opts.attach) return attachToHub(null);
  return spawnOwnHub(opts.addDirs);
}

// ── HTTP/1.1 ─────────────────────────────────────────────────

function createH1Server(upstream) {
  return http.createServer((req, res) => {
    const started = Date.now();
    const { rpc, isRpc } = describePath(req.url);
    let bytesIn = 0;
    let bytesOut = 0;

    // Forward the client's headers untouched -- except, when the hub is ours, the
    // csrf token, which the IDE cannot know. Without this swap every call 401s.
    const headers = { ...req.headers, host: `${upstream.host}:${upstream.port}` };
    if (upstream.csrfToken) headers["x-codeium-csrf-token"] = upstream.csrfToken;

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
    if (upstream.csrfToken) fwdHeaders["x-codeium-csrf-token"] = upstream.csrfToken;

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

const HELP = `agy-shim — sit between the Antigravity IDE and the agy hub.

  node scripts/antigravity/agy-shim.js [--add-dir=<path> ...] [--attach]

  (default)        start our own \`agy --hub\` and front it. Use this one:
                   setting antigravity.serverUrl stops the IDE spawning a hub,
                   so the shim has to supply it.
  --add-dir=<p>    workspace folder to give the hub; repeatable. The IDE normally
                   passes the open folders this way.
  --attach         do not spawn; forward to a hub that is already running and
                   change nothing (pure observation, needs the IDE to have one).
  AGY_UPSTREAM     host:port of a hub to attach to; implies --attach.
  AGY_BIN          path to the agy binary (default ~/.gemini/bin/agy).
  AGY_SHIM_PORT    port to listen on (default 20130).
`;

async function start() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }

  const upstream = await resolveUpstream(opts);
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

  // Without this, a port already in use crashes with a raw unhandled 'error'
  // stack trace that says nothing about what to do.
  front.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.error(`agy-shim: port ${LISTEN_PORT} is already in use.`);
      console.error(`  Another shim is probably still running: pkill -f agy-shim.js`);
      console.error(`  Or pick a different one: AGY_SHIM_PORT=20131 node ${process.argv[1]}`);
    } else {
      console.error(`agy-shim: ${e.message}`);
    }
    process.exit(1);
  });

  front.listen(LISTEN_PORT, "127.0.0.1", () => {
    console.log(`agy-shim listening on http://127.0.0.1:${LISTEN_PORT}`);
    console.log(`  upstream hub: ${upstream.host}:${upstream.port} (${upstream.mode})`);
    console.log(`  log: ${LOG_FILE}`);
    if (upstream.mode === "spawned") {
      console.log(`  hub log: ${HUB_LOG_FILE}`);
      // Two hubs means the IDE kept its own, which means it is not asking us --
      // and any silence that follows is that, not a broken shim.
      const theirs = findRunningHubPorts(upstream.port);
      if (theirs.length) {
        console.log("");
        console.log(`  NOTE: another agy hub is running on ${theirs.join(", ")} (the IDE's own).`);
        console.log("  If it is talking to that one, nothing will reach this shim. Reload the");
        console.log("  Antigravity window after setting serverUrl, and check this note again.");
      }
    }
    console.log("");
    console.log("In Antigravity, set this and reload the window:");
    console.log(`  "antigravity.serverUrl": "http://127.0.0.1:${LISTEN_PORT}"`);
    console.log("");
    console.log(
      upstream.mode === "spawned"
        ? "Ctrl-C for a per-RPC summary, and the hub is stopped with it."
        : "Ctrl-C for a per-RPC summary. Nothing is modified -- this only watches."
    );
    console.log("");
  });

  const stopHub = () => {
    if (!upstream.child || upstream.child.exitCode !== null) return;
    try { upstream.child.kill("SIGTERM"); } catch { /* already gone */ }
    // If it ignores SIGTERM it still has to go -- an orphan holds the port and
    // 200MB of RSS, and the next run would silently attach to the wrong hub.
    setTimeout(() => { try { upstream.child.kill("SIGKILL"); } catch { /* gone */ } }, 2000).unref();
  };

  const summarise = () => {
    stopHub();
    const all = [...stats.entries()];
    const rows = all.filter(([, s]) => s.isRpc);
    const assets = all.filter(([, s]) => !s.isRpc);
    console.log("\n── RPCs seen ────────────────────────────────────────────────");
    if (!rows.length) {
      console.log("  NOTHING ARRIVED.");
      console.log("  Either the setting was not applied (reload the window after setting it),");
      console.log("  or the IDE reaches the hub without consulting antigravity.serverUrl --");
      console.log("  which is exactly the thing this shim exists to find out.");
      if (upstream.mode === "spawned") {
        console.log(`  The hub itself did come up on ${upstream.port}; see ${HUB_LOG_FILE}.`);
      }
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
  // A crash must not leave the hub behind either.
  process.on("exit", stopHub);
}

start().catch((e) => {
  console.error(`agy-shim: ${e.message}`);
  process.exit(1);
});
