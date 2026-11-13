const { exec, spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const os = require("os");
const https = require("https");
const crypto = require("crypto");
const { addDNSEntry, removeDNSEntry, removeAllDNSEntries, removeAllDNSEntriesSync, checkAllDNSStatus, TOOL_HOSTS, isSudoAvailable, isSudoPasswordRequired } = require("./dns/dnsConfig");
const { isAdmin } = require("./winElevated.js");
const { detectContainer } = require("./isContainer.js");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const { generateCert } = require("./cert/generate");
const { installCert, uninstallCert } = require("./cert/install");
const { isCertExpired } = require("./cert/rootCA");
const { DATA_DIR, MITM_DIR, IS_DEFAULT_DATA_DIR } = require("./paths");
const { log, err } = require("./logger");
const { LSOF_BIN } = require("./config");
const { setLinuxNodeExtraCaCerts } = require("./linuxNodeCaCerts");
const { setGoSslCertFile } = require("./goCaCerts");
const { configureIdeCaTrust } = require("./ideCaTrust");

const IS_LINUX = process.platform === "linux";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";

function shellQuoteSingle(str) {
  if (str == null || str === "") return "''";
  return `'${String(str).replace(/'/g, "'\\''")}'`;
}

// Env vars forwarded to the sudo-spawned MITM server when they are set.
//
// The server reads these; the four it always needs are set unconditionally at
// the call site. Keep this in sync with what src/mitm/* reads from process.env
// — a var missing here is not an error, it is a switch that silently does
// nothing, which is how MITM_FILE_LOG went unnoticed.
const SUDO_FORWARDED_ENV = Object.freeze([
  "MITM_FILE_LOG",
  "MITM_MAX_DUMP_FILES",
  "DEBUG_MITM",
  "DATA_DIR",
  "KROUTER_DATA_DIR",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
]);

// Sentinels framing the env block on the child's stdin. Not configurable: they
// only have to be text no shell `read` would produce from a password.
const ENV_BEGIN = "__KROUTER_ENV_BEGIN__";
const ENV_END = "__KROUTER_ENV_END__";

/**
 * The bytes written to the sudo child's stdin: password, then the env block.
 *
 * A value containing a newline would end the line early and the rest would be
 * exported as a separate assignment, so such a value is rejected rather than
 * silently truncated. Nothing legitimate here contains one.
 *
 * @param {string} password sudo password (may be empty when sudo is passwordless)
 * @param {Record<string,string>} env  variables for the child
 */
function buildSudoEnvStdin(password, env) {
  const lines = [`${password == null ? "" : password}`, ENV_BEGIN];
  for (const [k, v] of Object.entries(env)) {
    const value = v == null ? "" : String(v);
    if (/[\r\n]/.test(value) || /[\r\n=]/.test(k)) {
      throw new Error(`Refusing to pass ${k} to the MITM server: newline in name or value`);
    }
    lines.push(`${k}=${value}`);
  }
  lines.push(ENV_END, "");
  return lines.join("\n");
}

async function resolveMitmRouterBaseUrl() {
  if (!_getSettings) return DEFAULT_MITM_ROUTER_BASE;
  try {
    const s = await _getSettings();
    const raw = s && s.mitmRouterBaseUrl != null ? String(s.mitmRouterBaseUrl).trim() : "";
    if (!raw) return DEFAULT_MITM_ROUTER_BASE;
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return DEFAULT_MITM_ROUTER_BASE;
    return raw.replace(/\/+$/, "");
  } catch {
    return DEFAULT_MITM_ROUTER_BASE;
  }
}

const MITM_PORT = 443;
const MITM_WIN_NODE_PORT = 8443;
const PID_FILE = path.join(MITM_DIR, ".mitm.pid");
const LOCK_FILE = path.join(MITM_DIR, ".mitm.lock");
// How long a start lock can be held before it is treated as abandoned. Only a
// backstop for a reclaimed pid number; liveness is the primary check.
const STALE_LOCK_MS = 2 * 60 * 1000;

const MITM_MAX_RESTARTS = 5;
const MITM_RESTART_DELAYS_MS = [5000, 10000, 20000, 30000, 60000];
const MITM_RESTART_RESET_MS = 60000;

let mitmRestartCount = 0;
let mitmLastStartTime = 0;
let mitmIsRestarting = false;

function resolveBundledServerPath() {
  if (process.env.MITM_SERVER_PATH) return process.env.MITM_SERVER_PATH;
  const sibling = path.join(__dirname, "server.js");
  if (fs.existsSync(sibling)) return sibling;
  const fromCwd = path.join(process.cwd(), "src", "mitm", "server.js");
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromNext = path.join(process.cwd(), "..", "src", "mitm", "server.js");
  if (fs.existsSync(fromNext)) return fromNext;
  return fromCwd;
}

// Copy bundled server.js into DATA_DIR so MITM doesn't lock node_modules
// (prevents EBUSY on `npm i -g krouter@latest` while MITM is running).
function ensureRuntimeServer(bundledPath) {
  try {
    if (!bundledPath || !fs.existsSync(bundledPath)) return bundledPath;

    // Dev mode: source file has relative requires (./logger, ./config...),
    // only the bundled file inside node_modules is self-contained + safe to copy.
    if (!bundledPath.includes(`${path.sep}node_modules${path.sep}`)) {
      return bundledPath;
    }

    const runtimeDir = path.join(DATA_DIR, "runtime", "mitm");
    const runtimeServer = path.join(runtimeDir, "server.js");

    // Skip copy if sizes match (bundle unchanged since last run)
    if (fs.existsSync(runtimeServer)) {
      try {
        if (fs.statSync(bundledPath).size === fs.statSync(runtimeServer).size) return runtimeServer;
      } catch { /* recopy */ }
    }

    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.copyFileSync(bundledPath, runtimeServer);
    return runtimeServer;
  } catch (e) {
    try { log(`[MITM] runtime copy failed: ${e.message}`); } catch { /* ignore */ }
    return bundledPath;
  }
}

const SERVER_PATH = ensureRuntimeServer(resolveBundledServerPath());
const ENCRYPT_ALGO = "aes-256-gcm";
const ENCRYPT_SALT = "9router-mitm-pwd";

function getProcessUsingPort443() {
  try {
    if (IS_WIN) {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command ` +
        `"$c = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess } else { 0 }"`;
      const pidStr = execSync(psCmd, { encoding: "utf8", windowsHide: true }).trim();
      const pid = parseInt(pidStr, 10);
      if (pid && pid > 4) {
        const tasklistResult = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: "utf8", windowsHide: true });
        const processMatch = tasklistResult.match(/"([^"]+)"/);
        if (processMatch) return processMatch[1].replace(".exe", "");
      }
    } else {
      const result = execSync(`${LSOF_BIN} -i :443`, { encoding: "utf8", windowsHide: true });
      const lines = result.trim().split("\n");
      if (lines.length > 1) return lines[1].split(/\s+/)[0];
    }
  } catch {
    return null;
  }
  return null;
}

let serverProcess = null;
let serverPid = null;

function getCachedPassword() { return globalThis.__mitmSudoPassword || null; }
function setCachedPassword(pwd) { globalThis.__mitmSudoPassword = pwd; }

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists and belongs to someone else. The MITM
    // runs as root, so this is the normal answer for a healthy capture seen
    // from an unprivileged process -- reading it as dead would report "not
    // running" AND unlink the pid file, taking the tray's capture indicator
    // and the leftover-kill path down with it.
    //
    // The check used to be for EACCES, which Node's process.kill never throws:
    // the branch could not fire, so the only thing it did was look handled.
    return err.code === "EPERM" || err.code === "EACCES";
  }
}

function killProcess(pid, force = false, sudoPassword = null) {
  if (IS_WIN) {
    const flag = force ? "/F " : "";
    exec(`taskkill ${flag}/PID ${pid}`, { windowsHide: true }, () => { });
  } else {
    const sig = force ? "SIGKILL" : "SIGTERM";
    const cmd = `pkill -${sig} -P ${pid} 2>/dev/null; kill -${sig} ${pid} 2>/dev/null`;
    if (sudoPassword || isSudoAvailable()) {
      const { execWithPassword } = require("./dns/dnsConfig");
      execWithPassword(cmd, sudoPassword || "").catch(() => exec(cmd, { windowsHide: true }, () => { }));
    } else {
      exec(cmd, { windowsHide: true }, () => { });
    }
  }
}

/**
 * Every key this machine's saved sudo password could be under, best first.
 *
 * This used to be one key from `machineIdSync()`, with a silent fall back to the
 * salt alone when that threw — and on macOS under launchd it always threw.
 * `node-machine-id` shells out to `ioreg`, which lives in /usr/sbin, and the
 * LaunchAgent's PATH is /opt/homebrew/.../bin:/usr/local/bin:/usr/bin:/bin. No
 * /usr/sbin, no ioreg, so the key quietly became a different key than the one
 * the password was encrypted under, GCM rejected the tag, and the only symptom
 * was "MITM was enabled but no saved password found, skipping auto-start" on
 * every boot. MITM never came back after a restart, and the watchdog then
 * stripped the DNS redirects it could no longer serve.
 *
 * The first candidate is the machine id this app already persists to
 * DATA_DIR/machine-id (see shared/utils/machineId.js, which keeps that file for
 * exactly this reason: "guarantees CLI/server/middleware see same value even
 * when machineIdSync fails"). Reading a file needs no PATH.
 *
 * The rest are the historical keys. A password saved before this change still
 * opens, so nobody has to re-enter it — including on a machine where ioreg was
 * never reachable and the salt-only key is the real one.
 */
let _keyCandidates = null;
function deriveKeyCandidates() {
  if (_keyCandidates) return _keyCandidates;
  const keys = [];
  const add = (raw) => {
    const key = crypto.createHash("sha256").update(raw + ENCRYPT_SALT).digest();
    if (!keys.some((k) => k.equals(key))) keys.push(key);
  };

  try {
    const persisted = fs.readFileSync(path.join(DATA_DIR, "machine-id"), "utf8").trim();
    if (persisted) add(persisted);
  } catch { /* not written yet — fall through */ }

  try {
    // Shells out to ioreg on macOS. Kept for blobs saved under the old key, but
    // memoized: without that it ran on every decrypt attempt and printed
    // "/bin/sh: ioreg: command not found" to stderr once per call under launchd.
    const { machineIdSync } = require("node-machine-id");
    add(machineIdSync());
  } catch { /* no ioreg on PATH, which is the whole point of the file above */ }

  const saltOnly = crypto.createHash("sha256").update(ENCRYPT_SALT).digest();
  if (!keys.some((k) => k.equals(saltOnly))) keys.push(saltOnly);
  _keyCandidates = keys;
  return keys;
}

/** The key new passwords are encrypted under: the most stable one available. */
function deriveKey() {
  return deriveKeyCandidates()[0];
}

function encryptPassword(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptPassword(stored) {
  const [ivHex, tagHex, dataHex] = String(stored || "").split(":");
  if (!ivHex || !tagHex || !dataHex) return null;
  // Try every key this machine could have encrypted under, so a password saved
  // under an older derivation still opens instead of reading as "not saved".
  for (const key of deriveKeyCandidates()) {
    try {
      const decipher = crypto.createDecipheriv(ENCRYPT_ALGO, key, Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      return decipher.update(Buffer.from(dataHex, "hex")) + decipher.final("utf8");
    } catch { /* wrong key for this blob — try the next */ }
  }
  return null;
}

let _getSettings = null;
let _updateSettings = null;

function initDbHooks(getSettingsFn, updateSettingsFn) {
  _getSettings = getSettingsFn;
  _updateSettings = updateSettingsFn;
}

async function saveMitmSettings(enabled, password) {
  if (!_updateSettings) return;
  try {
    const updates = { mitmEnabled: enabled };
    if (password) updates.mitmSudoEncrypted = encryptPassword(password);
    await _updateSettings(updates);
  } catch (e) {
    err(`Failed to save settings: ${e.message}`);
  }
}

/**
 * Remember whether proxy capture is meant to be on.
 *
 * It used to record nothing but a pid file, so nothing could bring it back: the
 * only reason a long-running proxy survived app restarts is that it is spawned
 * detached and unref'd, so it outlives its parent and gets reparented to launchd.
 * Kill it once — a reboot, a crash, an unlucky pkill — and it was gone until
 * someone pressed the button again, with no record that it had ever been on.
 * The :443 transport has had `mitmEnabled` for exactly this; this is its twin.
 */
async function saveProxyCaptureEnabled(enabled) {
  if (!_updateSettings) return;
  try {
    await _updateSettings({ proxyCaptureEnabled: enabled });
  } catch (e) {
    err(`Failed to save proxy capture state: ${e.message}`);
  }
}

async function clearEncryptedPassword() {
  if (!_updateSettings) return;
  try {
    await _updateSettings({ mitmSudoEncrypted: null });
  } catch (e) {
    err(`Failed to clear encrypted password: ${e.message}`);
  }
}

/**
 * The saved sudo password, or null.
 *
 * Every failure here used to return a bare null, and the one caller that matters
 * — auto-start on boot — turned that into "no saved password found, skipping".
 * That sentence is wrong for three of the four ways this can fail, and it is the
 * only thing a user saw when MITM silently did not come up after a reboot. Each
 * cause now says which it is.
 */
async function loadEncryptedPassword() {
  if (!_getSettings) {
    log("🔐 Cannot read the saved sudo password: no settings hook registered (initDbHooks was never called in this module instance).");
    return null;
  }
  try {
    const settings = await _getSettings();
    if (!settings.mitmSudoEncrypted) {
      log("🔐 No sudo password saved — MITM has to be started once from the dashboard to store one.");
      return null;
    }
    const password = decryptPassword(settings.mitmSudoEncrypted);
    if (!password) {
      log("🔐 The saved sudo password did not decrypt. It is bound to this machine's id, so a changed machine id or a copied data dir invalidates it — start MITM once from the dashboard to save it again.");
    }
    return password;
  } catch (e) {
    log(`🔐 Reading the saved sudo password failed: ${e.message}`);
    return null;
  }
}

async function saveDnsToolState(tool, enabled) {
  if (!_updateSettings || !_getSettings) return;
  try {
    const s = await _getSettings();
    const next = { ...(s.dnsToolEnabled || {}), [tool]: enabled };
    await _updateSettings({ dnsToolEnabled: next });
  } catch (e) {
    err(`Failed to save DNS state: ${e.message}`);
  }
}

async function loadDnsToolState() {
  if (!_getSettings) return {};
  try {
    const s = await _getSettings();
    return s.dnsToolEnabled || {};
  } catch {
    return {};
  }
}

/**
 * Re-apply DNS for tools previously enabled — called on app startup after MITM running.
 */
async function restoreToolDNS(sudoPassword) {
  const state = await loadDnsToolState();
  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  for (const [tool, enabled] of Object.entries(state)) {
    if (!enabled || !TOOL_HOSTS[tool]) continue;
    try {
      await addDNSEntry(tool, password);
    } catch (e) {
      err(`DNS ${tool}: restore failed — ${e.message}`);
    }
  }
}

/**
 * Check if user has privilege to mutate hosts file.
 * Win: needs admin. Mac/Linux: root OR cached/encrypted sudo password.
 */
async function hasDnsPrivilege() {
  if (IS_WIN) return isAdmin();
  if (isAdmin()) return true;
  if (!isSudoPasswordRequired()) return true;
  const pwd = getCachedPassword() || await loadEncryptedPassword();
  return !!pwd;
}

function checkPort443Free() {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", (err) => {
      if (err.code === "EADDRINUSE") resolve("in-use");
      else resolve("no-permission");
    });
    tester.once("listening", () => { tester.close(() => resolve("free")); });
    tester.listen(MITM_PORT, "127.0.0.1");
  });
}

function getPort443Owner(sudoPassword) {
  return new Promise((resolve) => {
    if (IS_WIN) {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "` +
        `$c = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
        `if ($c) { $c.OwningProcess } else { 0 }"`;    
      exec(psCmd, { windowsHide: true }, (err, stdout) => {
        if (err) return resolve(null);
        const pid = parseInt(stdout.trim(), 10);
        if (!pid || pid <= 4) return resolve(null);
        exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { windowsHide: true }, (e2, out2) => {
          const m = out2?.match(/"([^"]+)"/);
          resolve({ pid, name: m ? m[1] : "unknown" });
        });
      });
    } else {
      // Only find process actually LISTENING on TCP port 443
      exec(`${LSOF_BIN} -nP -iTCP:443 -sTCP:LISTEN -t`, { windowsHide: true }, (err, stdout) => {
        if (err || !stdout?.trim()) return resolve(null);
        const pid = parseInt(stdout.trim().split("\n")[0], 10);
        if (!pid || isNaN(pid)) return resolve(null);
        exec(`ps -p ${pid} -o comm=`, { windowsHide: true }, (e2, out2) => {
          resolve({ pid, name: (out2?.trim() || "unknown") });
        });
      });
    }
  });
}

async function killLeftoverMitm(sudoPassword) {
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill("SIGKILL"); } catch { /* ignore */ }
    serverProcess = null;
    serverPid = null;
  }
  try {
    if (fs.existsSync(PID_FILE)) {
      const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
      if (savedPid && isProcessAlive(savedPid)) {
        killProcess(savedPid, true, sudoPassword);
        await new Promise(r => setTimeout(r, 500));
      }
      fs.unlinkSync(PID_FILE);
    }
  } catch { /* ignore */ }
  if (!IS_WIN && SERVER_PATH) {
    try {
      const escaped = SERVER_PATH.replace(/'/g, "'\\''");
      if (sudoPassword || isSudoAvailable()) {
        const { execWithPassword } = require("./dns/dnsConfig");
        await execWithPassword(`pkill -SIGKILL -f "${escaped}" 2>/dev/null || true`, sudoPassword || "").catch(() => { });
      } else {
        exec(`pkill -SIGKILL -f "${escaped}" 2>/dev/null || true`, { windowsHide: true }, () => { });
      }
      await new Promise(r => setTimeout(r, 500));
    } catch { /* ignore */ }
  }
}

function pollMitmHealth(timeoutMs, port = MITM_PORT) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const req = https.request(
        { hostname: "127.0.0.1", port, path: "/_mitm_health", method: "GET", rejectUnauthorized: false },
        (res) => {
          let body = "";
          res.on("data", (d) => { body += d; });
          res.on("end", () => {
            try {
              const json = JSON.parse(body);
              resolve(json.ok === true ? { ok: true, pid: json.pid || null } : null);
            } catch { resolve(null); }
          });
        }
      );
      req.on("error", () => {
        if (Date.now() < deadline) setTimeout(check, 500);
        else resolve(null);
      });
      req.end();
    };
    check();
  });
}

/**
 * Get full MITM status including per-tool DNS status
 */
// 0.5.173 — is something actually accepting on the MITM port?
//
// `running` was decided by the in-process handle plus the PID file. Both are blind to a
// MITM server that outlives the app process that spawned it: restart the app and
// serverProcess is null, while the real server — spawned through sudo, owned by root —
// is still listening. `lsof` cannot see a root-owned listener as an ordinary user either,
// which is the same blind spot that made a manual check report "MITM is down" earlier.
//
// That matters because of what reads this flag: healStaleMitmDns treats
// "DNS redirects present + server not running" as the blackhole state and REMOVES the
// redirects. With a false negative here it deleted live, working redirects every
// watchdog tick. Observed on a real machine: antigravity and kiro DNS confirmed active
// and intercepting at 12:02, both entries gone minutes later with the server still up,
// and the IDEs quietly back on the vendor's own billing.
//
// A TCP connect is the one check that does not care who owns the socket. Being wrong in
// the other direction is cheap: we keep redirects we could have cleaned, and the next
// tick tries again. Deleting a working redirect is not cheap.
const MITM_LOCAL_PORT = 443;

function isPortAccepting(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (v) => { try { socket.destroy(); } catch { /* ignore */ } resolve(v); };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    try { socket.connect(port, "127.0.0.1"); } catch { done(false); }
  });
}

// ── Proxy capture mode ───────────────────────────────────────
// 0.5.175 — The second capture transport (src/mitm/proxy.js). Everything here
// is deliberately simpler than the :443 path because nothing is privileged:
// no sudo, no /etc/hosts, no port 443 to wrestle away from another process, and
// nothing left behind to heal if the process dies. Stopping it cannot leave a
// domain unreachable, which is the failure mode the DNS transport has.

const PROXY_DEFAULT_PORT = 20129;
const PROXY_PID_FILE = path.join(MITM_DIR, ".proxy.pid");
const PROXY_LOG_FILE = path.join(MITM_DIR, "proxy.log");
let proxyProcess = null;
let proxyPid = null;

function proxyPort() {
  const n = Number(process.env.MITM_PROXY_PORT || PROXY_DEFAULT_PORT);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : PROXY_DEFAULT_PORT;
}

/** Last line the proxy wrote, so a failed start says why. */
function lastProxyLogLine() {
  try {
    const lines = fs.readFileSync(PROXY_LOG_FILE, "utf-8").trim().split("\n");
    return lines[lines.length - 1] || "";
  } catch {
    return "";
  }
}

function resolveBundledProxyPath() {
  if (process.env.MITM_PROXY_PATH) return process.env.MITM_PROXY_PATH;
  const sibling = path.join(__dirname, "proxy.js");
  if (fs.existsSync(sibling)) return sibling;
  const fromCwd = path.join(process.cwd(), "src", "mitm", "proxy.js");
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromNext = path.join(process.cwd(), "..", "src", "mitm", "proxy.js");
  if (fs.existsSync(fromNext)) return fromNext;
  return fromCwd;
}

/**
 * Is the proxy accepting? The PORT decides, never the process handle.
 *
 * Holding a live child handle is not evidence that anything is listening: a
 * child that spawned and then failed to bind leaves the handle intact, and
 * reporting "running" for it is how 0.5.171 came to delete working DNS
 * redirects -- status that disagrees with reality is worse than status that
 * says nothing. Asking the port also credits a proxy that outlived this app.
 */
async function getProxyCaptureStatus() {
  const port = proxyPort();
  const alive = await isPortAccepting(port);
  let pid = proxyPid;
  if (!pid) {
    try { pid = Number(fs.readFileSync(PROXY_PID_FILE, "utf-8").trim()) || null; } catch { pid = null; }
  }
  return {
    running: alive,
    port,
    pid: alive ? pid : null,
    // What the user has to put in front of the client. Nothing can set this for
    // an already-running app, so it is surfaced rather than applied.
    proxyUrl: `http://127.0.0.1:${port}`,
  };
}

/** Start the proxy. Never asks for a password -- that is the point of the mode. */
async function startProxyCapture(apiKey) {
  const port = proxyPort();
  if (await isPortAccepting(port)) {
    // Already up is still "on", so record the intent — otherwise a second press
    // of an already-enabled toggle leaves it unrecorded and unrestartable.
    await saveProxyCaptureEnabled(true);
    return { ...(await getProxyCaptureStatus()), alreadyRunning: true };
  }

  const proxyPath = resolveBundledProxyPath();
  if (!fs.existsSync(proxyPath)) throw new Error(`Proxy not found at ${proxyPath}`);

  const mitmRouterBase = await resolveMitmRouterBaseUrl();

  // Detached, with output to a file rather than a pipe. Piped stdio ties the
  // child's lifetime to a reader: once this app exits, the read end closes and
  // the child's next log write hits a dead pipe, which in testing killed the
  // request it was serving while the port stayed open -- a proxy that accepts
  // connections and answers nothing. A file also means a failed start is still
  // diagnosable after the parent has gone.
  let logFd = null;
  try {
    logFd = fs.openSync(PROXY_LOG_FILE, "a");
  } catch { /* fall back to discarding output rather than failing to start */ }

  proxyProcess = spawn(process.execPath, [proxyPath], {
    detached: true,
    windowsHide: true,
    cwd: os.tmpdir(),
    stdio: ["ignore", logFd ?? "ignore", logFd ?? "ignore"],
    env: {
      ...process.env,
      ROUTER_API_KEY: apiKey,
      MITM_ROUTER_BASE: mitmRouterBase,
      MITM_PROXY_PORT: String(port),
    },
  });
  proxyProcess.unref();
  if (logFd !== null) { try { fs.closeSync(logFd); } catch { /* ignore */ } }
  proxyPid = proxyProcess.pid;
  try { fs.writeFileSync(PROXY_PID_FILE, String(proxyPid)); } catch { /* best effort */ }
  proxyProcess.on("exit", () => {
    proxyProcess = null;
    proxyPid = null;
    try { fs.rmSync(PROXY_PID_FILE, { force: true }); } catch { /* ignore */ }
  });

  // Wait for it to actually accept. A refused connect returns instantly, so
  // this needs its own delay -- without one the whole loop finishes in
  // microseconds and reports a port that is not listening yet.
  for (let i = 0; i < 50; i++) {
    if (await isPortAccepting(port, 200)) break;
    if (proxyProcess === null) break; // exited; the exit handler cleared it
    await new Promise((r) => setTimeout(r, 100));
  }

  const status = await getProxyCaptureStatus();
  if (!status.running) {
    // Deliberately not recorded as enabled: a start that failed is not a state
    // to restore on the next boot, it is a state to leave alone.
    throw new Error(`Proxy did not start on port ${port}: ${lastProxyLogLine() || "no output"}`);
  }
  await saveProxyCaptureEnabled(true);
  return status;
}

async function stopProxyCapture() {
  const port = proxyPort();

  // The pid file is the only thing a proxy from a previous app run leaves
  // behind -- there is no system state to undo, which is the whole advantage
  // of this transport over the DNS one.
  let filePid = null;
  try { filePid = Number(fs.readFileSync(PROXY_PID_FILE, "utf-8").trim()) || null; } catch { /* none */ }

  const signal = (sig) => {
    if (proxyProcess && !proxyProcess.killed) {
      try { proxyProcess.kill(sig); } catch { /* ignore */ }
    }
    if (filePid && isProcessAlive(filePid)) killProcess(filePid, sig === "SIGKILL");
  };

  // Signals are asynchronous: checking the port immediately after kill() reports
  // "still running" for a process that is about to exit. Wait for the port to
  // actually stop accepting, then escalate rather than reporting a lie.
  signal("SIGTERM");
  let closed = false;
  for (let i = 0; i < 30; i++) {
    if (!(await isPortAccepting(port, 150))) { closed = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!closed) {
    signal("SIGKILL");
    for (let i = 0; i < 20; i++) {
      if (!(await isPortAccepting(port, 150))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  proxyProcess = null;
  proxyPid = null;
  try { fs.rmSync(PROXY_PID_FILE, { force: true }); } catch { /* ignore */ }
  // Turning it off is as much a decision as turning it on, so it has to be
  // recorded too — otherwise the next boot helpfully starts it again.
  await saveProxyCaptureEnabled(false);
  return getProxyCaptureStatus();
}

/**
 * The two capture transports are one switch.
 *
 * They used to start and stop independently, and the states that produced were
 * worse than either transport being off. The proxy is spawned detached and
 * unref'd so it outlives the app: stop MITM, or kill the app, and the proxy kept
 * listening on 20129 with nothing behind it. Measured in that state — the port
 * accepts, `/_krouter_proxy_health` answers `{"ok":true}`, and every intercepted
 * request dies with `500 {"error":{"message":"fetch failed"}}` because the
 * router it forwards to is gone. Anything pointed at HTTPS_PROXY then breaks for
 * reasons that look like a network fault, which is exactly how it was reported.
 *
 * Best effort on purpose: the :443 transport is useful on its own, so a proxy
 * that will not come up must not fail a MITM start that already succeeded.
 */
async function startProxyWithMitm(apiKey) {
  try {
    const status = await startProxyCapture(apiKey);
    log(`🔀 Proxy capture ${status.alreadyRunning ? "already listening" : "started"} on ${status.proxyUrl}`);
  } catch (e) {
    err(`Proxy capture did not start alongside MITM: ${e.message}`);
  }
}

/** The other half of the switch. Never throws, for the same reason. */
async function stopProxyWithMitm() {
  try {
    const status = await stopProxyCapture();
    if (status.running) err(`Proxy capture is still listening on port ${status.port} after a stop`);
    else log("🔀 Proxy capture stopped");
  } catch (e) {
    err(`Proxy capture did not stop alongside MITM: ${e.message}`);
  }
}

async function getMitmStatus() {
  let running = serverProcess !== null && !serverProcess.killed;
  let pid = serverPid;

  if (!running) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          running = true;
          pid = savedPid;
        } else {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch { /* ignore */ }
  }

  // 0.5.173 — last resort before declaring it down: ask the port. See isPortAccepting.
  if (!running && await isPortAccepting(MITM_LOCAL_PORT)) {
    running = true;
  }

  const dnsStatus = checkAllDNSStatus();
  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  const certExists = fs.existsSync(rootCACertPath);
  const { checkCertInstalled } = require("./cert/install");
  const certTrusted = certExists ? await checkCertInstalled(rootCACertPath) : false;

  // 0.5.134 — Detect the SILENT BLACKHOLE state: DNS redirects still point the
  // intercepted provider hosts at 127.0.0.1 while the MITM server is DOWN, so
  // every request to those providers gets connection-refused ("fetch failed")
  // with no obvious cause. This happens because /etc/hosts cleanup on exit needs
  // sudo (best-effort, silently fails without a cached password) and auto-start
  // then bails for the same reason — leaving the redirects orphaned.
  const staleDnsTools = running ? [] : Object.keys(dnsStatus || {}).filter((t) => dnsStatus[t]);
  const staleDns = staleDnsTools.length > 0;

  // Interception is host-scoped. In a container the hosts file and :443 belong
  // to the container, while the IDEs being intercepted run on the host — so the
  // controls are surfaced as unavailable rather than half-working.
  const { containerized, kind: containerKind } = detectContainer();

  return { running, pid, certExists, certTrusted, dnsStatus, staleDns, staleDnsTools, containerized, containerKind };
}

async function scheduleMitmRestart(apiKey) {
  if (mitmIsRestarting) return;
  // Set guard synchronously before any await to prevent concurrent calls
  // from passing the check above.
  mitmIsRestarting = true;

  // If the MITM server is already up (e.g. user toggled OFF then ON manually
  // while a stale restart was queued, or two callers raced), there's nothing
  // to restart. Without this guard, the queued restart calls startServer →
  // hits the 'MITM server is already running' throw → catch reschedules →
  // infinite "Restart attempt 1/5 failed" loop that spams the user's log
  // every 5 seconds. Reset the counter so a future genuine crash gets a
  // clean retry budget.
  if (serverProcess && !serverProcess.killed) {
    mitmRestartCount = 0;
    log("MITM server already running, no restart needed");
    return;
  }

  const aliveMs = Date.now() - mitmLastStartTime;
  if (aliveMs >= MITM_RESTART_RESET_MS) mitmRestartCount = 0;

  if (mitmRestartCount >= MITM_MAX_RESTARTS) {
    err("Max restart attempts reached. Giving up.");
    mitmIsRestarting = false;
    return;
  }

  const attempt = mitmRestartCount;
  const delay = MITM_RESTART_DELAYS_MS[Math.min(attempt, MITM_RESTART_DELAYS_MS.length - 1)];
  mitmRestartCount++;

  log(`Restarting in ${delay / 1000}s... (${mitmRestartCount}/${MITM_MAX_RESTARTS})`);
  await new Promise((r) => setTimeout(r, delay));

  try {
    const settings = _getSettings ? await _getSettings() : null;
    if (settings && !settings.mitmEnabled) {
      log("MITM disabled, skipping restart");
      mitmIsRestarting = false;
      return;
    }
    const password = getCachedPassword() || await loadEncryptedPassword();
    if (!password && !IS_WIN) {
      err("No cached password, cannot auto-restart");
      mitmIsRestarting = false;
      return;
    }
    await startServer(apiKey, password);
    log("🔄 Restarted successfully");
    mitmRestartCount = 0;
    mitmIsRestarting = false;
  } catch (e) {
    err(`Restart attempt ${mitmRestartCount}/${MITM_MAX_RESTARTS} failed: ${e.message}`);
    mitmIsRestarting = false;
    // Schedule next retry
    scheduleMitmRestart(apiKey);
  }
}

/**
 * Start MITM server only (cert + server, no DNS)
 */
async function killPort443Owner(owner, sudoPassword) {
  if (!owner || !owner.pid) return;
  if (IS_WIN) {
    try {
      execSync(`powershell -NonInteractive -WindowStyle Hidden -Command "Stop-Process -Id ${owner.pid} -Force -ErrorAction SilentlyContinue"`, { windowsHide: true });
    } catch { /* best effort */ }
  } else {
    try {
      const { execWithPassword } = require("./dns/dnsConfig");
      if (sudoPassword || isSudoAvailable()) {
        await execWithPassword(`kill -9 ${owner.pid}`, sudoPassword || "");
      } else {
        execSync(`kill -9 ${owner.pid}`, { windowsHide: true });
      }
    } catch { /* best effort */ }
  }
  await new Promise(r => setTimeout(r, 800));
}

async function startServer(apiKey, sudoPassword, forceKillPort443 = false) {
  if (!serverProcess || serverProcess.killed) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const savedPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
        if (savedPid && isProcessAlive(savedPid)) {
          serverPid = savedPid;
          log(`♻️ Reusing existing process (PID: ${savedPid})`);
          await saveMitmSettings(true, sudoPassword);
          if (sudoPassword) setCachedPassword(sudoPassword);
          // Also on this path: a MITM that was already up can still have been
          // left without its proxy, and the toggle has to converge both.
          await startProxyWithMitm(apiKey);
          return { running: true, pid: savedPid };
        } else {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch { /* ignore */ }
  }

  if (serverProcess && !serverProcess.killed) {
    throw new Error("MITM server is already running");
  }

  // Atomically claim lock to prevent concurrent startServer across processes.
  // O_EXCL (flag: "wx") fails with EEXIST if the file already exists.
  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    // A lock only means something while the process holding it is alive.
    //
    // It is removed on every clean path, but not by a SIGKILL — `launchctl
    // kickstart -k`, a crash, a power cut — and the bare throw below then made
    // EVERY later start fail with "already starting". Not until the next boot:
    // forever, because nothing ever deleted the file. Observed here as
    // "[InitApp] MITM auto-start failed: MITM server is already starting (lock
    // contention)" with the lock naming a pid that had been dead for minutes.
    const holder = (() => {
      try { return parseInt(fs.readFileSync(LOCK_FILE, "utf8").trim(), 10) || null; } catch { return null; }
    })();
    const ageMs = (() => {
      try { return Date.now() - fs.statSync(LOCK_FILE).mtimeMs; } catch { return Infinity; }
    })();
    // The age check is the backstop for a recycled pid: a start that is genuinely
    // in flight finishes or fails well inside this window, so a lock older than
    // that is not a start in progress whoever owns the number now.
    const live = holder && isProcessAlive(holder) && ageMs < STALE_LOCK_MS;
    if (live) throw new Error("MITM server is already starting (lock contention)");
    log(`🔓 Reclaiming a stale start lock (pid ${holder ?? "unknown"}, age ${Math.round(ageMs / 1000)}s)`);
    fs.writeFileSync(LOCK_FILE, String(process.pid));
  }

  try {
    await killLeftoverMitm(sudoPassword);

  if (!IS_WIN) {
    const portStatus = await checkPort443Free();
    if (portStatus === "in-use" || portStatus === "no-permission") {
      const owner = await getPort443Owner(sudoPassword);
      if (owner) {
        const shortName = owner.name.includes("/")
          ? owner.name.split("/").filter(Boolean).pop()
          : owner.name;
        if (forceKillPort443) {
          log(`Killing process on port 443 (PID ${owner.pid}, name=${shortName})...`);
          await killPort443Owner(owner, sudoPassword);
        } else {
          const e = new Error(`Port 443 is already in use by "${shortName}" (PID ${owner.pid}).`);
          e.code = "PORT_443_BUSY";
          e.portOwner = { pid: owner.pid, name: shortName };
          throw e;
        }
      }
    }
  }

  // Step 1: Generate Root CA if missing or expired
  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  const rootCAKeyPath = path.join(MITM_DIR, "rootCA.key");
  const certExists = fs.existsSync(rootCACertPath) && fs.existsSync(rootCAKeyPath);

  if (!certExists || isCertExpired(rootCACertPath)) {
    if (certExists) {
      // Uninstall expired cert from system store before regenerating
      log("🔐 Cert expired — uninstalling old cert...");
      const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
      try { await uninstallCert(password, rootCACertPath); } catch { /* best effort */ }
    }
    log("🔐 Generating Root CA...");
    await generateCert();
  }

  // Step 1.5: Auto-install Root CA if not trusted yet
  const { checkCertInstalled } = require("./cert/install");
  const rootCATrusted = await checkCertInstalled(rootCACertPath);
  const linuxNoSystemTrust = !IS_WIN && !IS_MAC && !isSudoAvailable();
  if (!rootCATrusted) {
    log("🔐 Cert: not trusted → installing...");
    const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
    if (linuxNoSystemTrust) {
      log(`🔐 Cert: skipping system trust (no sudo). Install ${rootCACertPath} as a trusted CA on machines that use this proxy.`);
    } else {
      if (!password && isSudoPasswordRequired()) {
        throw new Error("Sudo password required to install Root CA certificate");
      }
      try {
        await installCert(password, rootCACertPath);
        log("🔐 Cert: ✅ trusted");
      } catch (e) {
        throw new Error(`Failed to trust certificate: ${e.message}`);
      }
    }
  } else {
    log("🔐 Cert: already trusted ✅");
  }

  // Step 2: Spawn server (Root CA already installed in Step 1.5)
  // Verify server.js exists — recopy if runtime file was deleted (antivirus/cleanup)
  let effectiveServerPath = SERVER_PATH;
  if (!effectiveServerPath || !fs.existsSync(effectiveServerPath)) {
    log(`[MITM] server.js missing at ${effectiveServerPath} → recopying`);
    effectiveServerPath = ensureRuntimeServer(resolveBundledServerPath());
    if (!effectiveServerPath || !fs.existsSync(effectiveServerPath)) {
      throw new Error(`MITM server.js not found at ${effectiveServerPath}. Reinstall kRouter.`);
    }
  }
  const mitmRouterBase = await resolveMitmRouterBaseUrl();
  log(`🚀 Starting server... (router: ${mitmRouterBase})`);
  if (IS_WIN) {
    // Check port 443 — ask user before killing
    const winOwner = await getPort443Owner(sudoPassword);
    if (winOwner) {
      if (forceKillPort443) {
        log(`Killing process on port 443 (PID ${winOwner.pid}, name=${winOwner.name})...`);
        await killPort443Owner(winOwner, sudoPassword);
      } else {
        const e = new Error(`Port 443 is already in use by "${winOwner.name}" (PID ${winOwner.pid}).`);
        e.code = "PORT_443_BUSY";
        e.portOwner = { pid: winOwner.pid, name: winOwner.name };
        throw e;
      }
    }

    // Spawn directly — process already has admin rights
    // cwd=tmpdir so process doesn't lock the install dir on Windows (EBUSY on update)
    serverProcess = spawn(
      process.execPath,
      [effectiveServerPath],
      {
        detached: false,
        windowsHide: true,
        cwd: os.tmpdir(),
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ROUTER_API_KEY: apiKey,
          NODE_ENV: "production",
          MITM_ROUTER_BASE: mitmRouterBase,
        },
      }
    );

    if (_updateSettings) await _updateSettings({ mitmCertInstalled: true }).catch(() => { });
  } else if (isSudoAvailable()) {
    // The environment goes down stdin, not argv.
    //
    // Two reasons. argv is world-readable: `ROUTER_API_KEY=sk-...` on the
    // command line showed the key to every local process in `ps`. And the old
    // inline list was a fixed four variables, so MITM_FILE_LOG and DEBUG_MITM
    // never reached the child on macOS — file logging looked enabled and wrote
    // nothing, which is the worst way for an observability switch to fail.
    //
    // HOME is in the list because sudo resets it; without it os.homedir()
    // resolves to /root and the server writes its state to the wrong place.
    const childEnv = {
      HOME: os.homedir(),
      NODE_ENV: "production",
      ROUTER_API_KEY: apiKey,
      MITM_ROUTER_BASE: mitmRouterBase,
    };
    // Forwarded only when set, so an unset var stays unset in the child rather
    // than arriving as the empty string, which several of these treat as on.
    for (const k of SUDO_FORWARDED_ENV) {
      if (process.env[k] != null && process.env[k] !== "") childEnv[k] = process.env[k];
    }

    // Read past whatever sudo did or did not consume before taking the vars.
    //
    // `sudo -S` reads the password line only when it actually prompts; with a
    // cached timestamp or NOPASSWD it reads nothing, and a script that blindly
    // took the first line would then export the password as the API key and
    // fail in a way that reads like a bad key. Skipping to a sentinel is
    // correct either way.
    const inlineCmd = [
      `while IFS= read -r l; do [ "$l" = "${ENV_BEGIN}" ] && break; done`,
      `while IFS= read -r l; do [ "$l" = "${ENV_END}" ] && break; export "$l"; done`,
      `exec ${shellQuoteSingle(process.execPath)} ${shellQuoteSingle(effectiveServerPath)}`,
    ].join("; ");

    serverProcess = spawn(
      "sudo", ["-S", "-E", "sh", "-c", inlineCmd],
      { detached: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    serverProcess.stdin.write(buildSudoEnvStdin(sudoPassword, childEnv));
    serverProcess.stdin.end();
  } else {
    // Docker/minimal images: no sudo — same as Windows-style direct spawn
    serverProcess = spawn(process.execPath, [effectiveServerPath], {
      detached: false,
      windowsHide: true,
      cwd: os.tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ROUTER_API_KEY: apiKey,
        NODE_ENV: "production",
        MITM_ROUTER_BASE: mitmRouterBase,
      },
    });
  }

  if (serverProcess) {
    serverPid = serverProcess.pid;
    fs.writeFileSync(PID_FILE, String(serverPid));
    mitmLastStartTime = Date.now();
  }

  // Set NODE_EXTRA_CA_CERTS so Node-based GUI apps (Electron / Antigravity
  // language_server / VS Code extensions / Claude Desktop on Linux) trust
  // MITM cert. Node ignores the OS trust store and reads its own bundled
  // Mozilla CA list — without this, system curl works but Node-based apps
  // reject our cert with 'x509: certificate signed by unknown authority'.
  // 0.5.169 — NODE_EXTRA_CA_CERTS covers Node/Electron only. Antigravity's language
  // server is Go: it reads neither the OS store nor that variable, and fails sign-in
  // with "x509: certificate signed by unknown authority" the moment DNS points at us.
  // Write its own setting too, on every platform.
  // 0.5.170 — only the real installation writes machine-wide trust. See IS_DEFAULT_DATA_DIR.
  if (!IS_DEFAULT_DATA_DIR) {
    log(`[ide-ca] Skipped: DATA_DIR is not the default install, so machine-wide CA trust is left alone`);
  } else {
    try {
      const caPath = path.join(MITM_DIR, "rootCA.crt");
      const ide = configureIdeCaTrust(caPath);
      for (const w of ide.written) log(`[ide-ca] ${w} -> kRouter root CA`);
      for (const x of ide.failed) log(`[ide-ca] ${x}`);
    } catch (e) { log(`[ide-ca] Failed: ${e.message}`); }
  }

  // 0.5.170 — same gate as the per-IDE settings above: NODE_EXTRA_CA_CERTS is set for
  // the whole login session and points at an absolute path inside DATA_DIR, so a second
  // instance run against a scratch DATA_DIR would repoint every Electron app on the
  // machine at a certificate under /tmp. See IS_DEFAULT_DATA_DIR in paths.js.
  if (!IS_DEFAULT_DATA_DIR) {
    log(`[node-ca] Skipped: DATA_DIR is not the default install, so NODE_EXTRA_CA_CERTS is left alone`);
  } else if (IS_MAC) {
    const rootCAPath = path.join(MITM_DIR, "rootCA.crt");
    if (fs.existsSync(rootCAPath)) {
      exec(`launchctl setenv NODE_EXTRA_CA_CERTS "${rootCAPath}"`, { windowsHide: true }, (e) => {
        if (e) log(`[launchctl] Failed to set NODE_EXTRA_CA_CERTS: ${e.message}`);
        else log(`[launchctl] NODE_EXTRA_CA_CERTS set to ${rootCAPath}`);
      });
    }
  } else if (IS_WIN) {
    const rootCAPath = path.join(MITM_DIR, "rootCA.crt");
    if (fs.existsSync(rootCAPath)) {
      exec(`setx NODE_EXTRA_CA_CERTS "${rootCAPath}"`, { windowsHide: true }, (e) => {
        if (e) log(`[setx] Failed to set NODE_EXTRA_CA_CERTS: ${e.message}`);
        else log(`[setx] NODE_EXTRA_CA_CERTS set for current user`);
      });
    }
  }

  // Go CLIs read SSL_CERT_FILE, not NODE_EXTRA_CA_CERTS, and it REPLACES the
  // system trust store instead of adding to it. Without this, Antigravity's agy
  // rejects the MITM cert on a machine where anything already exported that
  // variable -- which is how "Antigravity pins its CA" got into this codebase as
  // a fact. Unix only: on Windows Go uses the cert store certutil already filled.
  if (!IS_WIN) {
    const rootCAPath = path.join(MITM_DIR, "rootCA.crt");
    if (fs.existsSync(rootCAPath)) {
      try {
        const res = setGoSslCertFile(rootCAPath, MITM_DIR);
        if (res.skipped) {
          log(`[go-ca] SSL_CERT_FILE not wired: ${res.skipped}`);
        } else if (res.written.length > 0) {
          log(`[go-ca] SSL_CERT_FILE -> ${res.bundlePath} (${res.certCount} certs) in ${res.written.length} file(s)`);
          log(`[go-ca] ⚠ Already-running Go tools keep the old value: restart them (Antigravity: Quit + reopen)`);
        } else {
          log(`[go-ca] SSL_CERT_FILE already wired, no changes needed`);
        }
      } catch (e) {
        log(`[go-ca] Failed to wire SSL_CERT_FILE: ${e.message}`);
      }
    }
  }

  if (IS_LINUX) {
    const rootCAPath = path.join(MITM_DIR, "rootCA.crt");
    if (fs.existsSync(rootCAPath)) {
      try {
        const written = setLinuxNodeExtraCaCerts(rootCAPath);
        if (written.length > 0) {
          log(`[linux-node-ca] NODE_EXTRA_CA_CERTS written to ${written.length} file(s): ${written.map(p => p.replace(os.homedir(), "~")).join(", ")}`);
          log(`[linux-node-ca] ⚠ Terminal-launched IDE: open a NEW terminal OR run: source ~/.profile`);
          log(`[linux-node-ca] ⚠ Menu-launched IDE (GNOME / KDE Activities, .desktop): log out + back in OR run: systemctl --user daemon-reload && systemctl --user import-environment`);
        } else {
          log(`[linux-node-ca] NODE_EXTRA_CA_CERTS already set, no changes needed`);
        }
      } catch (e) {
        log(`[linux-node-ca] Failed to set NODE_EXTRA_CA_CERTS: ${e.message}`);
      }
    }
  }

  let startError = null;
  if (serverProcess) {
    serverProcess.stdout.on("data", (data) => {
      // server.js already formats its own logs — print as-is
      process.stdout.write(data);
    });
    serverProcess.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      // Mac/Linux: filter sudo password prompt noise
      if (msg && (IS_WIN || (!msg.includes("Password:") && !msg.includes("password for")))) {
        err(msg);
        startError = msg;
      }
      // Detect wrong/missing password — clear cache and stop retry loop
      if (!IS_WIN && (msg.includes("incorrect password") || msg.includes("no password was provided"))) {
        setCachedPassword(null);
        clearEncryptedPassword();
        mitmIsRestarting = true; // prevent scheduleMitmRestart from firing
      }
    });
    serverProcess.on("exit", (code) => {
      log(`Server exited (code: ${code})`);
      serverProcess = null;
      serverPid = null;
      try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
      try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
      // Auto-restart on unexpected exit
      if (code !== 0 && !mitmIsRestarting) scheduleMitmRestart(apiKey);
    });
  }

  const health = await pollMitmHealth(8000, MITM_PORT);
  if (!health) {
    if (serverProcess && !serverProcess.killed) { try { serverProcess.kill(); } catch { /* ignore */ } serverProcess = null; }
    const processUsing443 = getProcessUsingPort443();
    const portInfo = processUsing443 ? ` Port 443 already in use by ${processUsing443}.` : "";
    const reason = startError || `Check sudo password or port 443 access.${portInfo}`;
    throw new Error(`MITM server failed to start. ${reason}`);
  }

  if (_updateSettings) await _updateSettings({ mitmCertInstalled: true }).catch(() => { });

  log(`✅ Server healthy (PID: ${serverPid || health.pid})`);

  // Log DNS status per tool
  const dnsStatus = checkAllDNSStatus();
  for (const [tool, active] of Object.entries(dnsStatus)) {
    log(`🌐 DNS ${tool}: ${active ? "✅ active" : "❌ inactive"}`);
  }

  await saveMitmSettings(true, sudoPassword);
  if (sudoPassword) setCachedPassword(sudoPassword);

  // Server is healthy — remove lock file (PID file persists as the marker)
  try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }

  // One switch: the proxy transport comes up with the DNS one. Started after
  // :443 is healthy so a failure here cannot be mistaken for a failed MITM.
  await startProxyWithMitm(apiKey);

  return { running: true, pid: serverPid };
  } catch (e) {
    // Clean up lock on any failure
    try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
    throw e;
  }
}

/**
 * Stop MITM server — removes ALL tool DNS entries first, then kills server
 */
async function stopServer(sudoPassword) {
  // Prevent auto-restart from triggering on intentional stop
  mitmIsRestarting = true;
  mitmRestartCount = 0;
  log("⏹ Stopping server...");

  // One switch: the proxy goes down with the DNS transport. First, so that the
  // window where a proxy is listening without the rest of capture behind it is
  // as short as possible rather than permanent.
  await stopProxyWithMitm();

  // Kill server process
  const proc = serverProcess;
  const pidToKill = proc && !proc.killed
    ? proc.pid
    : (() => { try { return parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10); } catch { return null; } })();

  if (pidToKill && isProcessAlive(pidToKill)) {
    log(`Killing server (PID: ${pidToKill})...`);
    killProcess(pidToKill, false, sudoPassword);
    await new Promise(r => setTimeout(r, 1000));
    if (isProcessAlive(pidToKill)) killProcess(pidToKill, true, sudoPassword);
  }
  serverProcess = null;
  serverPid = null;

  if (IS_WIN) {
    const hostsFile = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts");
    const allHosts = Object.values(TOOL_HOSTS).flat();
    try {
      const { isAdmin, runElevatedPowerShell, quotePs } = require("./winElevated.js");
      if (isAdmin()) {
        // Direct fs write — bypass PowerShell to avoid parser pitfalls
        const content = fs.readFileSync(hostsFile, "utf8");
        const filtered = content.split(/\r?\n/).filter(l => !allHosts.some(h => l.includes(h))).join("\r\n");
        const next = filtered.replace(/[\r\n\s]+$/g, "") + "\r\n";
        if (next !== content) fs.writeFileSync(hostsFile, next, "utf8");
        try { require("child_process").execSync("ipconfig /flushdns", { windowsHide: true, stdio: "ignore" }); } catch { /* ignore */ }
        log("🌐 DNS: ✅ all tool hosts removed");
      } else {
        const hostsList = allHosts.map(quotePs).join(",");
        const script = `
          $hosts = @(${hostsList})
          $lines = Get-Content -LiteralPath ${quotePs(hostsFile)}
          $filtered = $lines | Where-Object {
            $line = $_
            -not ($hosts | Where-Object { $line -match [regex]::Escape($_) })
          }
          Set-Content -LiteralPath ${quotePs(hostsFile)} -Value $filtered
          ipconfig /flushdns | Out-Null
        `;
        await runElevatedPowerShell(script);
      }
    } catch (e) { err(`Failed to clean hosts: ${e.message}`); }
  } else {
    await removeAllDNSEntries(sudoPassword);
  }

  // 0.5.169 — CA trust is deliberately NOT torn down here. It used to be, and that is
  // what forced the "restart every IDE" dance: a tool launched while MITM was off had
  // no NODE_EXTRA_CA_CERTS and no antigravity.caCertificates, so the next time MITM
  // came up its TLS failed until the user restarted it. Trust is inert while MITM is
  // off - nothing resolves to us, so our cert is never presented - and it is removed
  // when the root CA itself is uninstalled.

  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
  await saveMitmSettings(false, null);
  mitmIsRestarting = false;

  return { running: false, pid: null };
}

/**
 * Enable DNS for a specific tool (requires server running)
 */
async function enableToolDNS(tool, sudoPassword) {
  const status = await getMitmStatus();
  if (!status.running) throw new Error("MITM server is not running. Start the server first.");

  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  await addDNSEntry(tool, password);
  await saveDnsToolState(tool, true);
  return { success: true };
}

/**
 * Disable DNS for a specific tool
 */
async function disableToolDNS(tool, sudoPassword) {
  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  await removeDNSEntry(tool, password);
  await saveDnsToolState(tool, false);
  return { success: true };
}

/**
 * Install Root CA to system trust store (standalone, no server start)
 */
async function trustCert(sudoPassword) {
  const rootCACertPath = path.join(MITM_DIR, "rootCA.crt");
  if (!fs.existsSync(rootCACertPath)) throw new Error("Root CA not found. Start server first to generate it.");
  const { installCert } = require("./cert/install");
  if (!IS_WIN && !IS_MAC && !isSudoAvailable()) {
    log(`🔐 Cert: system trust unavailable (no sudo). Use file: ${rootCACertPath}`);
    return;
  }
  const password = sudoPassword || getCachedPassword() || await loadEncryptedPassword();
  if (!password && isSudoPasswordRequired()) throw new Error("Sudo password required to trust certificate");
  await installCert(password, rootCACertPath);
  if (password) setCachedPassword(password);
}

// Legacy aliases for backward compatibility
const startMitm = startServer;
const stopMitm = stopServer;

module.exports = {
  buildSudoEnvStdin,
  SUDO_FORWARDED_ENV,
  ENV_BEGIN,
  ENV_END,
  getMitmStatus,
  startProxyCapture,
  stopProxyCapture,
  getProxyCaptureStatus,
  PROXY_DEFAULT_PORT,
  startServer,
  stopServer,
  enableToolDNS,
  disableToolDNS,
  trustCert,
  // Legacy
  startMitm,
  stopMitm,
  getCachedPassword,
  setCachedPassword,
  loadEncryptedPassword,
  clearEncryptedPassword,
  isSudoPasswordRequired,
  initDbHooks,
  restoreToolDNS,
  hasDnsPrivilege,
  removeAllDNSEntries,
  removeAllDNSEntriesSync,
  // The sudo-password crypto, so a test can prove the key does not depend on
  // PATH. It silently did, and MITM auto-start was off on every boot for it.
  __test__: { encryptPassword, decryptPassword, deriveKeyCandidates },
};
