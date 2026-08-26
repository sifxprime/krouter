#!/usr/bin/env node

const { spawn, exec, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const os = require("os");

// Native spinner - no external dependency
function createSpinner(text) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let interval = null;
  let currentText = text;
  return {
    start() {
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${frames[0]} ${currentText}`);
        interval = setInterval(() => {
          process.stdout.write(`\r${frames[i++ % frames.length]} ${currentText}`);
        }, 80);
      }
      return this;
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (process.stdout.isTTY) {
        process.stdout.write("\r\x1b[K");
      }
    },
    succeed(msg) {
      this.stop();
      console.log(`✅ ${msg}`);
    },
    fail(msg) {
      this.stop();
      console.log(`❌ ${msg}`);
    }
  };
}

const pkg = require("./package.json");
const { ensureSqliteRuntime, buildEnvWithRuntime } = require("./hooks/sqliteRuntime");
const { ensureTrayRuntime } = require("./hooks/trayRuntime");
const args = process.argv.slice(2);

// Self-heal SQLite runtime deps (sql.js + better-sqlite3) into ~/.krouter/runtime
// so the server can resolve them via NODE_PATH. Best-effort — sql.js is required,
// better-sqlite3 is optional. Logs to stderr only on failure.
//
// This runs before the argument parser, so `--version` and `--help` used to pay for
// it too: on a machine where the runtime is missing it shells out to a blocking
// `npm install` whose spawnSync timeout is 180s, printing nothing the whole time.
// Asking a program its version should never reach the network.
//
// KROUTER_SKIP_RUNTIME_HEAL=1 opts out entirely, for an air-gapped or CI machine where
// reaching npm is either impossible or unwanted. The server still starts; it just uses
// whatever runtime is already present instead of trying to repair it.
const RUNTIME_FREE_ARGS = new Set(["--version", "-v", "--help", "-h"]);
const skipRuntimeHeal =
  process.env.KROUTER_SKIP_RUNTIME_HEAL === "1" ||
  process.env.KROUTER_SKIP_RUNTIME_HEAL === "true";
if (!skipRuntimeHeal && !args.some((a) => RUNTIME_FREE_ARGS.has(a))) {
  try { ensureSqliteRuntime({ silent: true }); } catch {}
  // Self-heal tray runtime (systray for macOS/Linux only). Windows skipped.
  try { ensureTrayRuntime({ silent: true }); } catch {}
}

// Sweep autostart entries whose binary path no longer exists on disk (e.g. the
// user uninstalled the global kRouter then reinstalled to a different path).
// Cheap startup check; no-op when nothing's wrong.
try {
  const { sweepDanglingAutostartEntries } = require("./src/cli/tray/autostart");
  sweepDanglingAutostartEntries();
} catch {}

// Configuration constants
const APP_NAME = pkg.name; // Use from package.json
const INSTALL_CMD_LATEST = `npm i -g ${APP_NAME}@latest --prefer-online`;

const DEFAULT_PORT = 20128;
const DEFAULT_HOST = "0.0.0.0";
const MAX_PORT_ATTEMPTS = 10;
const PROCESS_IDENTIFIERS = ['krouter'];

// 0.5.52 — One-shot subcommand: `krouter backfill-tokens` rewrites old
// requestDetails rows where tokens.prompt_tokens is 0 but the raw
// providerResponse contains usageMetadata. Helps users with months of
// 0/0 rows produced before the Antigravity token-extraction bug was
// fixed in 0.5.51. Safe to re-run — only touches rows that actually
// have something to lift.
if (args[0] === "backfill-tokens") {
  const candidates = [
    path.join(process.env.HOME || "", ".krouter", "db", "data.sqlite"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "krouter", "db", "data.sqlite") : null,
  ].filter(Boolean);
  const dbPath = candidates.find(p => fs.existsSync(p));
  if (!dbPath) {
    console.error("No krouter database found at:", candidates.join(" or "));
    process.exit(1);
  }
  console.log("DB:", dbPath);
  const rows = JSON.parse(execSync(
    `sqlite3 -json "${dbPath}" "SELECT id, data FROM requestDetails WHERE json_extract(data,'$.tokens.prompt_tokens')=0 AND (json_extract(data,'$.providerResponse.response.usageMetadata.promptTokenCount') IS NOT NULL OR json_extract(data,'$.providerResponse.usageMetadata.promptTokenCount') IS NOT NULL)"`,
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }
  ) || "[]");
  console.log(`Candidates with extractable tokens: ${rows.length}`);
  let updated = 0;
  // 0.5.53 — stream UPDATEs through stdin so SQLite parses each statement
  // itself. Avoids the JSON-in-shell-quoted-SQL mangling that swallowed
  // every row silently on the first attempt.
  const tmpScript = path.join(os.tmpdir(), `krouter-backfill-${Date.now()}.sql`);
  const sqlLines = ["BEGIN;"];
  for (const row of rows) {
    try {
      const d = JSON.parse(row.data);
      const um = d.providerResponse?.response?.usageMetadata || d.providerResponse?.usageMetadata;
      if (!um) continue;
      const promptTokens = um.promptTokenCount || 0;
      const completionTokens = um.candidatesTokenCount || 0;
      const reasoningTokens = um.thoughtsTokenCount;
      if (promptTokens === 0 && completionTokens === 0) continue;
      d.tokens = { ...(d.tokens || {}), prompt_tokens: promptTokens, completion_tokens: completionTokens };
      if (reasoningTokens !== undefined) d.tokens.reasoning_tokens = reasoningTokens;
      const escapedData = JSON.stringify(d).replace(/'/g, "''");
      const escapedId = String(row.id).replace(/'/g, "''");
      sqlLines.push(`UPDATE requestDetails SET data='${escapedData}' WHERE id='${escapedId}';`);
      updated++;
    } catch (e) {
      console.error(`  row ${row.id} skipped: ${e.message}`);
    }
  }
  sqlLines.push("COMMIT;");
  fs.writeFileSync(tmpScript, sqlLines.join("\n"));
  try {
    execSync(`sqlite3 "${dbPath}" < "${tmpScript}"`, { stdio: ["ignore", "pipe", "pipe"] });
    console.log(`Backfilled ${updated} rows. Usage page totals will now reflect real token spend.`);
  } catch (e) {
    console.error(`Failed to apply: ${e.message?.split("\n")?.[0] || e}`);
    console.error(`SQL script left at ${tmpScript} for inspection.`);
    process.exit(2);
  }
  try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
  process.exit(0);
}

// Parse arguments
let port = DEFAULT_PORT;
let host = DEFAULT_HOST;
let noBrowser = false;
let skipUpdate = false;
let showLog = false;
let trayMode = false;

// `--flag=value` is the other half of the convention people expect; it used to fall
// through every branch and be dropped in silence, so `--port=3000` started the server
// on the default port instead.
function splitInlineValue(arg) {
  const eq = arg.indexOf("=");
  if (!arg.startsWith("-") || eq < 0) return null;
  return { flag: arg.slice(0, eq), value: arg.slice(eq + 1) };
}

for (let i = 0; i < args.length; i++) {
  const inline = splitInlineValue(args[i]);
  const arg = inline ? inline.flag : args[i];
  // Reading a value consumes the next argv entry only when it was not inlined.
  const takeValue = () => (inline ? inline.value : args[++i]);

  if (arg === "--port" || arg === "-p") {
    const raw = takeValue();
    // parseInt used to accept "3000abc" as 3000 and turn a typo, an empty value or a
    // missing one into DEFAULT_PORT — which is then force-freed by killProcessOnPort.
    // Silently starting on a different port than asked is worse than refusing.
    const parsed = Number(raw);
    if (raw === undefined || raw === "" || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      console.error(`Invalid --port value: ${raw === undefined || raw === "" ? "(missing)" : raw}. Expected an integer between 1 and 65535.`);
      process.exit(2);
    }
    port = parsed;
  } else if (arg === "--host" || arg === "-H") {
    const raw = takeValue();
    if (!raw) {
      console.error("Invalid --host value: (missing). Expected a hostname or IP, e.g. 127.0.0.1.");
      process.exit(2);
    }
    host = raw;
  } else if (arg === "--no-browser" || arg === "-n") {
    noBrowser = true;
  } else if (arg === "--log" || arg === "-l") {
    showLog = true;
  } else if (arg === "--skip-update") {
    skipUpdate = true;
  } else if (arg === "--tray" || arg === "-t") {
    trayMode = true;
    process.env.TRAY_MODE = "1";
  } else if (arg === "--help" || arg === "-h") {
    console.log(`
Usage: ${APP_NAME} [options]

Options:
  -p, --port <port>   Port to run the server (default: ${DEFAULT_PORT})
  -H, --host <host>   Host to bind (default: ${DEFAULT_HOST})
  -n, --no-browser    Don't open browser automatically
  -l, --log           Show server logs (default: hidden)
  -t, --tray          Run in system tray mode (background)
  --skip-update       Skip auto-update check
  -h, --help          Show this help message
  -v, --version       Show version
`);
    process.exit(0);
  } else if (arg === "--version" || arg === "-v") {
    console.log(pkg.version);
    process.exit(0);
  } else {
    // No terminal branch existed, so anything unrecognised was dropped without a
    // word: `krouter --prot 3000` or `krouter start` ran on the default port and
    // looked like it had worked.
    console.error(`Unknown option: ${args[i]}`);
    console.error(`Run \`${APP_NAME} --help\` to see the available options.`);
    process.exit(2);
  }
}

// Auto-relaunch after update: detached process has no TTY → fallback to tray
if (skipUpdate && !trayMode && !process.stdin.isTTY) {
  trayMode = true;
  process.env.TRAY_MODE = "1";
}

// Always use Node.js runtime with absolute path
const RUNTIME = process.execPath;

// Compare semver versions: returns 1 if a > b, -1 if a < b, 0 if equal
function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

// Get app data dir — kept in sync with src/mitm/paths.js
const DATA_DIR_NAME = "krouter";
function getAppDataDir() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || "", DATA_DIR_NAME)
    : path.join(os.homedir(), `.${DATA_DIR_NAME}`);
}

// Kill PID from file (best-effort, removes file after)
function killByPidFile(pidFile) {
  try {
    if (!fs.existsSync(pidFile)) return;
    const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (!pid) return;
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 });
      } else {
        process.kill(pid, "SIGKILL");
      }
    } catch { }
    try { fs.unlinkSync(pidFile); } catch { }
  } catch { }
}

// Kill tunnel processes (cloudflared/tailscale) by their PID files
function killTunnelByPidFile() {
  const tunnelDir = path.join(getAppDataDir(), "tunnel");
  killByPidFile(path.join(tunnelDir, "cloudflared.pid"));
  killByPidFile(path.join(tunnelDir, "tailscale.pid"));
}

// Kill cloudflared whose --url targets this app's port (covers stale PID file case)
function killCloudflaredByAppPort(appPort) {
  if (!appPort) return [];
  const portMatchers = [`localhost:${appPort}`, `127.0.0.1:${appPort}`];
  const pids = [];
  try {
    if (process.platform === "win32") {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "Get-WmiObject Win32_Process -Filter 'Name=\\"cloudflared.exe\\"' | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"`;
      const output = execSync(psCmd, { encoding: "utf8", windowsHide: true, timeout: 5000 });
      const lines = output.split("\n").slice(1).filter(l => l.trim());
      lines.forEach(line => {
        if (portMatchers.some(m => line.includes(m))) {
          const match = line.match(/^"(\d+)"/);
          if (match && match[1]) pids.push(match[1]);
        }
      });
    } else {
      const output = execSync("ps -eo pid,command 2>/dev/null", { encoding: "utf8", timeout: 5000 });
      output.split("\n").forEach(line => {
        if (line.includes("cloudflared") && portMatchers.some(m => line.includes(m))) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[0];
          if (pid && !isNaN(pid)) pids.push(pid);
        }
      });
    }
  } catch { }
  return pids;
}

// Kill all kRouter processes
function killAllAppProcesses(appPort) {
  return new Promise((resolve) => {
    try {
      // Kill MIT first (privileged process, needs special handling)
      killProxyByPidFile();
      // Kill cloudflared/tailscale by PID file (precise, only this app's tunnel)
      killTunnelByPidFile();

      const platform = process.platform;
      let pids = [];

      // Catch stale PID files: kill cloudflared bound to this app's port
      pids.push(...killCloudflaredByAppPort(appPort));

      if (platform === "win32") {
        // Windows: use WMI to get full CommandLine (tasklist /V doesn't include it)
        try {
          // Same ancestry rule as the POSIX branch below: a bare "next-server" match
          // would take down every Next server on the machine, our own being
          // indistinguishable from anyone else's by command line.
          const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "Get-WmiObject Win32_Process -Filter 'Name=\\"node.exe\\"' | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"`;
          const output = execSync(psCmd, {
            encoding: "utf8",
            windowsHide: true,
            timeout: 5000
          });
          const rows = output.split("\n").slice(1).filter(l => l.trim()).map(line => {
            const m = line.match(/^"(\d+)","(\d+)",(.*)$/);
            return m ? { pid: m[1], ppid: m[2], cmd: (m[3] || "").toLowerCase() } : null;
          }).filter(Boolean);

          // Same rule as the POSIX branch: the invoked script, not any mention of it.
          const isCliInvocation = (cmd) =>
            /(^|[\s"'])[^\s"']*[\/\\]krouter[\/\\]cli\.js(\s|$|["'])/i.test(cmd) ||
            /(^|[\s"'])[^\s"']*[\/\\]\.bin[\/\\]krouter(\s|$|["'])/i.test(cmd);
          const roots = new Set(rows.filter(r => isCliInvocation(r.cmd)).map(r => r.pid));
          const byParent = new Map();
          for (const r of rows) {
            if (!byParent.has(r.ppid)) byParent.set(r.ppid, []);
            byParent.get(r.ppid).push(r.pid);
          }
          const doomed = new Set(roots);
          const queue = [...roots];
          while (queue.length) {
            for (const child of byParent.get(queue.shift()) || []) {
              if (!doomed.has(child)) { doomed.add(child); queue.push(child); }
            }
          }
          for (const pid of doomed) {
            if (pid !== process.pid.toString()) pids.push(pid);
          }
        } catch (e) {
          // No processes found or error - continue
        }
      } else {
        // macOS/Linux. Identify our own processes by ancestry, never by name.
        //
        // Next renames its server process to a bare "next-server (v16.3.1)" -- no path,
        // no project, nothing tying it to an app. Matching that string killed every
        // Next server on the machine, so starting kRouter SIGKILLed a developer's
        // unrelated dev server. The whitelist above it could not help: our own server
        // matches by that string and nothing else, so the two are indistinguishable
        // from the command line alone. Ancestry is the only thing that separates them.
        try {
          const output = execSync('ps -Ao pid,ppid,command 2>/dev/null', {
            encoding: 'utf8',
            timeout: 5000
          });
          const rows = output.split('\n').slice(1)
            .map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
            .filter(Boolean)
            .map(m => ({ pid: m[1], ppid: m[2], cmd: m[3].toLowerCase() }));

          // Roots: node processes whose *invoked script* is this CLI. Testing for
          // "krouter" anywhere in the command line would promote any process that
          // merely mentions the app -- a grep, an editor, a script taking the path as
          // an argument -- into a root, and every descendant of a root is killed.
          // Match the argv[1] path instead.
          const isCliInvocation = (cmd) =>
            /(^|[\s"'])[^\s"']*[\/\\]krouter[\/\\]cli\.js(\s|$|["'])/i.test(cmd) ||
            /(^|[\s"'])[^\s"']*[\/\\]\.bin[\/\\]krouter(\s|$|["'])/i.test(cmd);
          const roots = new Set(
            rows.filter(r => r.cmd.includes("node") && isCliInvocation(r.cmd)).map(r => r.pid)
          );

          // Everything descended from a root, however deep. Next spawns its server as
          // a child, so this reaches it without ever matching on "next-server".
          const byParent = new Map();
          for (const r of rows) {
            if (!byParent.has(r.ppid)) byParent.set(r.ppid, []);
            byParent.get(r.ppid).push(r.pid);
          }
          const doomed = new Set(roots);
          const queue = [...roots];
          while (queue.length) {
            for (const child of byParent.get(queue.shift()) || []) {
              if (!doomed.has(child)) { doomed.add(child); queue.push(child); }
            }
          }

          for (const pid of doomed) {
            if (pid !== process.pid.toString()) pids.push(pid);
          }
        } catch (e) {
          // No processes found or error - continue
        }
      }

      // Kill all found processes
      if (pids.length > 0) {
        pids.forEach(pid => {
          try {
            if (platform === "win32") {
              execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore', shell: true, windowsHide: true, timeout: 3000 });
            } else {
              execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
            }
          } catch (err) {
            // Process already dead or can't kill - continue
          }
        });

        // Wait for processes to fully terminate
        setTimeout(() => resolve(), 1000);
      } else {
        resolve();
      }
    } catch (err) {
      // Silent fail - continue anyway
      resolve();
    }
  });
}

// Sleep helper using SharedArrayBuffer wait (sync, no busy-loop)
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ }
}

// Wait until process dies or timeout reached
function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    sleepSync(100);
  }
  return false;
}

// Kill MIT server by PID file (runs privileged, needs special handling)
// Sends SIGTERM first so MIT can clean up host entries before dying.
function killProxyByPidFile() {
  try {
    const pidFile = path.join(getAppDataDir(), "mitm", ".mitm.pid");
    if (!fs.existsSync(pidFile)) return;
    const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (!pid) return;

    if (process.platform === "win32") {
      // Graceful first (lets server cleanup hosts), then force
      try { execSync(`taskkill /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 2000 }); } catch { }
      if (!waitForExit(pid, 1500)) {
        try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 }); } catch { }
      }
      // Last-resort: PowerShell Stop-Process (sometimes succeeds where taskkill fails on admin processes)
      if (!waitForExit(pid, 500)) {
        try { execSync(`powershell -NonInteractive -WindowStyle Hidden -Command "Stop-Process -Id ${pid} -Force"`, { stdio: "ignore", windowsHide: true, timeout: 3000 }); } catch { }
      }
    } else {
      // SIGTERM via cached sudo token first
      try { execSync(`sudo -n kill -TERM ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 2000 }); }
      catch { try { process.kill(pid, "SIGTERM"); } catch { } }
      if (!waitForExit(pid, 1500)) {
        try { execSync(`sudo -n kill -9 ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 2000 }); }
        catch { try { process.kill(pid, "SIGKILL"); } catch { } }
      }
    }
    try { fs.unlinkSync(pidFile); } catch { }
  } catch { }
}

// Is this PID one of our own server processes?
//
// killProcessOnPort used to kill-9 whatever `lsof -ti:PORT` returned, with no check on
// what it was. `krouter --port 3000` destroyed the user's own app on 3000 and
// `--port 5432` took out their Postgres, silently and before anything was printed.
//
// An orphaned kRouter server is the hard case: its parent CLI is gone, so ancestry
// cannot reach it, and Next has renamed it to a bare "next-server (vX)", so the command
// line says nothing either. spawnServer pins cwd to standaloneDir, and that survives
// both — it is the one durable marker of "this install's server".
function isOwnServerPid(pid) {
  try {
    const mine = fs.realpathSync(standaloneDir);
    if (process.platform === "linux") {
      return fs.realpathSync(`/proc/${pid}/cwd`) === mine;
    }
    if (process.platform === "darwin") {
      const out = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`, {
        encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "ignore"],
      });
      const line = out.split("\n").find((l) => l.startsWith("n"));
      return !!line && fs.realpathSync(line.slice(1).trim()) === mine;
    }
    if (process.platform === "win32") {
      // No cheap cwd read on Windows. Fall back to the executable path, which for our
      // server points inside the package directory.
      const out = execSync(
        `powershell -NonInteractive -WindowStyle Hidden -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path"`,
        { encoding: "utf8", windowsHide: true, timeout: 4000 }
      ).trim();
      return !!out && out.toLowerCase().includes("krouter");
    }
  } catch { /* process gone, or no permission to inspect it — treat as not ours */ }
  return false;
}

// Kill ALL processes listening on the given port. Returns true if any were killed.
// Previous version: on Windows only killed the first PID from netstat, missing
// parent/child pairs (next-server has a watcher + worker). Now sweeps all PIDs.
function killProcessOnPort(port) {
  return new Promise((resolve) => {
    let killedAny = false;
    try {
      const platform = process.platform;
      const pidsToKill = new Set();
      const foreign = [];

      if (platform === "win32") {
        try {
          const output = execSync(`netstat -ano | findstr :${port}`, {
            encoding: 'utf8',
            shell: true,
            windowsHide: true,
            timeout: 5000
          }).trim();
          output.split('\n').filter(l => l.includes('LISTENING')).forEach(line => {
            const pid = line.trim().split(/\s+/).pop();
            if (!pid || !/^\d+$/.test(pid) || pid === String(process.pid)) return;
            if (isOwnServerPid(pid)) pidsToKill.add(pid);
            else foreign.push(pid);
          });
          for (const pid of pidsToKill) {
            try {
              execSync(`taskkill /F /T /PID ${pid} 2>nul`, { stdio: 'ignore', shell: true, windowsHide: true, timeout: 3000 });
              killedAny = true;
            } catch { /* PID may have already exited */ }
          }
        } catch (e) {
          // Port is free or netstat failed
        }
      } else {
        // macOS/Linux — lsof returns all PIDs holding the port (TCP, both IPv4 + IPv6)
        try {
          const pidOutput = execSync(`lsof -ti:${port}`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          }).trim();
          pidOutput.split('\n').filter(Boolean).forEach(pid => {
            if (pid === String(process.pid)) return;
            // Only ever kill our own server. Anything else holding the port is the
            // user's — say so and let them choose the port, rather than killing it.
            if (isOwnServerPid(pid)) pidsToKill.add(pid);
            else foreign.push(pid);
          });
          for (const pid of pidsToKill) {
            try {
              execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
              killedAny = true;
            } catch { /* PID may have already exited */ }
          }
        } catch (e) {
          // Port is free or lsof errored
        }
      }

      // Something that is not ours is holding the port. Say so and name it, instead
      // of failing to start with no explanation -- the caller only learns "port busy".
      if (foreign.length) {
        const described = foreign.map((pid) => {
          try {
            const name = platform === "win32"
              ? execSync(`powershell -NonInteractive -WindowStyle Hidden -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName"`,
                  { encoding: "utf8", windowsHide: true, timeout: 4000 }).trim()
              : execSync(`ps -p ${pid} -o comm= 2>/dev/null`, { encoding: "utf8", timeout: 3000 }).trim();
            return name ? `${name} (pid ${pid})` : `pid ${pid}`;
          } catch { return `pid ${pid}`; }
        });
        console.error(`\n⚠️  Port ${port} is held by ${described.join(", ")} — not kRouter.`);
        console.error(`   Refusing to kill it. Start kRouter on another port, e.g. --port ${port + 1}.\n`);
        // Exit rather than fall through: we deliberately did not free the port, so
        // every subsequent bind attempt fails. The retry path treats EADDRINUSE as
        // transient and would spin here forever.
        process.exit(1);
      }

      // Wait for kernel to release the socket (Windows is slow here, give it 1s).
      // Then verify the port is actually free — if not, surface the result so
      // the caller can decide whether to retry or fail-fast.
      setTimeout(() => resolve(killedAny), platform === "win32" ? 1000 : 500);
    } catch (err) {
      // Silent fail - continue anyway
      resolve(false);
    }
  });
}


// Detect if running in restricted environment (Codespaces, Docker)
function isRestrictedEnvironment() {
  // Check for Codespaces
  if (process.env.CODESPACES === "true" || process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    return "GitHub Codespaces";
  }

  // Check for Docker
  if (fs.existsSync("/.dockerenv") || (fs.existsSync("/proc/1/cgroup") && fs.readFileSync("/proc/1/cgroup", "utf8").includes("docker"))) {
    return "Docker";
  }

  return null;
}

// Check if new version available, return latest version or null
function checkForUpdate() {
  return new Promise((resolve) => {
    if (skipUpdate) {
      resolve(null);
      return;
    }

    const spinner = createSpinner("Checking for updates...").start();
    let resolved = false;

    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        spinner.stop();
        resolve(null);
      }
    }, 8000);

    const done = (version) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(safetyTimeout);
      spinner.stop();
      resolve(version);
    };

    const req = https.get(`https://registry.npmjs.org/${pkg.name}/latest`, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const latest = JSON.parse(data);
          if (latest.version && compareVersions(latest.version, pkg.version) > 0) {
            done(latest.version);
          } else {
            done(null);
          }
        } catch (e) {
          done(null);
        }
      });
    });

    req.on("error", () => done(null));
    req.on("timeout", () => { req.destroy(); done(null); });
  });
}

// Open browser
function openBrowser(url) {
  const platform = process.platform;
  let cmd;

  if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else if (platform === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, { windowsHide: true }, (err) => {
    if (err) {
      console.log(`Open browser manually: ${url}`);
    }
  });
}

// Find standalone server (bundled in bin/app for published package).
// Prefer custom-server.js (injects real socket IP) when present.
const standaloneDir = path.join(__dirname, "app");
const customServerPath = path.join(standaloneDir, "custom-server.js");
const serverPath = fs.existsSync(customServerPath)
  ? customServerPath
  : path.join(standaloneDir, "server.js");

if (!fs.existsSync(serverPath)) {
  console.error("Error: Standalone build not found.");
  console.error("Please run 'npm run build:cli' first.");
  process.exit(1);
}

// Check for updates FIRST, then start server
checkForUpdate().then((latestVersion) => {
  killAllAppProcesses(port).then(() => {
    return killProcessOnPort(port);
  }).then(() => {
    startServer(latestVersion);
  });
});

// Show interface selection menu
async function showInterfaceMenu(latestVersion) {
  const { selectMenu } = require("./src/cli/utils/input");
  const { clearScreen } = require("./src/cli/utils/display");
  const { getEndpoint } = require("./src/cli/utils/endpoint");

  clearScreen();

  const displayHost = host === DEFAULT_HOST ? "localhost" : host;

  // Detect tunnel/local mode for server URL display
  let serverUrl;
  try {
    const { endpoint, tunnelEnabled } = await getEndpoint(port);
    serverUrl = tunnelEnabled ? endpoint.replace(/\/v1$/, "") : `http://${displayHost}:${port}`;
  } catch (e) {
    serverUrl = `http://${displayHost}:${port}`;
  }

  const subtitle = `🚀 Server: \x1b[32m${serverUrl}\x1b[0m`;

  const menuItems = [];

  if (latestVersion) {
    menuItems.push({ label: `Update to v${latestVersion} (current: v${pkg.version})`, icon: "⬆" });
  }

  menuItems.push(
    { label: "Web UI (Open in Browser)", icon: "🌐" },
    { label: "Terminal UI (Interactive CLI)", icon: "💻" },
    { label: "Hide to Tray (Background)", icon: "🔔" },
    { label: "Exit", icon: "🚪" }
  );

  const selected = await selectMenu(`Choose Interface (v${pkg.version})`, menuItems, 0, subtitle);

  const offset = latestVersion ? 1 : 0;

  if (latestVersion && selected === 0) return "update";
  if (selected === offset) return "web";
  if (selected === offset + 1) return "terminal";
  if (selected === offset + 2) return "hide";
  return "exit";
}

const MAX_RESTARTS = 2;
const RESTART_RESET_MS = 30000; // Reset counter if alive > 30s

// First non-internal IPv4 — the address remote peers actually reach when bound to 0.0.0.0.
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}

function startServer(latestVersion) {
  const displayHost = host === DEFAULT_HOST ? "localhost" : host;
  const url = `http://${displayHost}:${port}/dashboard`;

  // Surface real network exposure when bound to all interfaces (default 0.0.0.0).
  // Ported from upstream — without this the user has no signal that their
  // dashboard + API is reachable from anyone else on their LAN.
  if (host === DEFAULT_HOST) {
    const lanIp = getLanIp();
    if (lanIp) {
      console.log(`\x1b[33m⚠ Network-exposed: reachable at http://${lanIp}:${port} (bound 0.0.0.0). Use --host 127.0.0.1 for local-only.\x1b[0m`);
      // Remote callers already need an API key for /v1/* and a login for the
      // dashboard, so the exposure is bounded. Say so, rather than leaving the
      // reader to guess whether their provider quota is reachable.
      console.log(`\x1b[33m  Remote callers still need an API key for /v1/* and a login for the dashboard.\x1b[0m`);
    }
  }

  let restartCount = 0;
  let serverStartTime = Date.now();

  const CRASH_LOG_LINES = 50;
  let crashLog = [];

  function spawnServer() {
    serverStartTime = Date.now();
    crashLog = [];
    const child = spawn(RUNTIME, ["--max-old-space-size=6144", serverPath], {
      cwd: standaloneDir,
      stdio: showLog ? "inherit" : ["ignore", "ignore", "pipe"],
      detached: true,
      windowsHide: true,
      env: {
        ...buildEnvWithRuntime(process.env),
        PORT: port.toString(),
        HOSTNAME: host
      }
    });
    if (!showLog && child.stderr) {
      child.stderr.on("data", (data) => {
        const lines = data.toString().split("\n").filter(Boolean);
        crashLog.push(...lines);
        if (crashLog.length > CRASH_LOG_LINES) crashLog = crashLog.slice(-CRASH_LOG_LINES);
      });
    }
    return child;
  }

  let server = spawnServer();

  // Cleanup function - force kill server process
  let isCleaningUp = false;
  function cleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;
    try {
      // Kill tray if running
      try {
        const { killTray } = require("./src/cli/tray/tray");
        killTray();
      } catch (e) { }
      // Kill MIT server (privileged process) via PID file
      killProxyByPidFile();
      // Kill cloudflared/tailscale via PID file (only this app's tunnel)
      killTunnelByPidFile();
      // Kill server process directly
      if (server.pid) {
        process.kill(server.pid, "SIGKILL");
      }
      // Also try to kill process group
      process.kill(-server.pid, "SIGKILL");
    } catch (e) { }
  }

  // Suppress all errors during shutdown (systray lib throws JSON parse errors)
  let isShuttingDown = false;
  process.on("uncaughtException", (err) => {
    if (isShuttingDown) return;
    console.error("Error:", err.message);
  });

  // Handle all exit scenarios
  process.on("SIGINT", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\nExiting...");
    cleanup();
    setTimeout(() => process.exit(0), 100);
  });
  process.on("SIGTERM", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    cleanup();
    setTimeout(() => process.exit(0), 100);
  });
  process.on("SIGHUP", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    cleanup();
    setTimeout(() => process.exit(0), 100);
  });

  // Initialize tray icon (runs alongside TUI)
  const initTrayIcon = () => {
    try {
      const { initTray } = require("./src/cli/tray/tray");
      initTray({
        port,
        onQuit: () => {
          isShuttingDown = true;
          console.log("\n👋 Shutting down from tray...");
          cleanup();
          setTimeout(() => process.exit(0), 100);
        },
        onOpenDashboard: () => openBrowser(url)
      });
    } catch (err) {
      // Tray not available - continue without it
    }
  };

  // Tray-only mode: no TUI, just tray icon
  if (trayMode) {
    // Ignore SIGHUP so macOS terminal close doesn't kill the background tray process
    process.removeAllListeners("SIGHUP");
    process.on("SIGHUP", () => {});

    console.log(`\n🚀 ${pkg.name} v${pkg.version}`);
    console.log(`Server: http://${displayHost}:${port}`);

    setTimeout(() => {
      initTrayIcon();
      console.log("\n💡 Router is now running in system tray. Close this terminal if you want.");
      console.log("   Right-click tray icon to open dashboard or quit.\n");
    }, 2000);

    return;
  }

  // Wait for server to be ready, then show interface menu loop + tray
  setTimeout(async () => {
    // Start tray icon alongside TUI
    initTrayIcon();

    try {
      while (true) {
        const choice = await showInterfaceMenu(latestVersion);

        if (choice === "update") {
          isShuttingDown = true;
          const { clearScreen } = require("./src/cli/utils/display");
          clearScreen();
          console.log(`\n⬆  Update v${pkg.version} → v${latestVersion}\n`);
          console.log(`Run this after exit:\n`);
          console.log(`   \x1b[33m${INSTALL_CMD_LATEST}\x1b[0m\n`);
          cleanup();
          await killAllAppProcesses(port);
          await killProcessOnPort(port);
          setTimeout(() => process.exit(0), 200);
          return;
        } else if (choice === "web") {
          openBrowser(url);
          // Wait for user to come back
          const { pause } = require("./src/cli/utils/input");
          await pause("\nPress Enter to go back to menu...");
        } else if (choice === "terminal") {
          // Start Terminal UI - it will return when user selects Back
          const { startTerminalUI } = require("./src/cli/terminalUI");
          await startTerminalUI(port);
          // Loop continues, show menu again
        } else if (choice === "hide") {
          const { clearScreen } = require("./src/cli/utils/display");
          clearScreen();

          // Enable auto startup on OS boot
          try {
            const { enableAutoStart } = require("./src/cli/tray/autostart");
            enableAutoStart(__filename);
          } catch (e) { }

          if (process.platform === "darwin") {
            // macOS: keep current process alive — spawning a detached child puts
            // it outside the login session so NSStatusItem silently fails.
            process.removeAllListeners("SIGHUP");
            process.on("SIGHUP", () => {});

            console.log(`\n⏳ Switching to tray mode... (icon already visible in menu bar)`);
            console.log(`🔔 kRouter is running in tray (PID: ${process.pid})`);
            console.log(`   Server: http://${displayHost}:${port}`);
            console.log(`\n💡 You can close this terminal. Right-click tray icon to quit.\n`);

            // Tray already init'd at startup — just keep event loop alive.
            return;
          }

          // Windows/Linux: spawn detached bgProcess (systray works fine in child)
          console.log(`\n⏳ Starting background process... (tray icon will appear in ~3s)`);

          const bgProcess = spawn(process.execPath, [__filename, "--tray", "--skip-update", "-p", port.toString()], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            env: { ...process.env }
          });
          bgProcess.unref();

          console.log(`🔔 kRouter is now running in background (PID: ${bgProcess.pid})`);
          console.log(`   Server: http://${displayHost}:${port}`);
          console.log(`\n💡 You can close this terminal. Right-click tray icon to quit.\n`);

          // cleanup() kills server so bgProcess can claim the port fresh
          cleanup();
          process.exit(0);
        } else if (choice === "exit") {
          isShuttingDown = true;
          console.log("\nExiting...");
          cleanup();
          setTimeout(() => process.exit(0), 100);
        }
      }
    } catch (err) {
      console.error("Error:", err.message);
      cleanup();
      process.exit(1);
    }
  }, 3000);

  function attachServerEvents() {
    server.on("error", (err) => {
      console.error("Failed to start server:", err.message);
      if (!isShuttingDown) tryRestart();
      else { cleanup(); process.exit(1); }
    });

    server.on("close", (code) => {
      if (isShuttingDown || code === 0) {
        process.exit(code || 0);
        return;
      }
      tryRestart(code);
    });
  }

  // Detect "address already in use" in the captured crash log so we can take
  // the correct recovery path (re-kill the port-holder) instead of the generic
  // crash path (disable MITM — which is unrelated to a port conflict and only
  // wastes the user's time).
  function crashIsAddressInUse() {
    return crashLog.some(l => /EADDRINUSE|address already in use|port.*in use/i.test(l));
  }

  function tryRestart(code) {
    const aliveMs = Date.now() - serverStartTime;
    // Reset counter if last run was stable
    if (aliveMs >= RESTART_RESET_MS) restartCount = 0;

    // EADDRINUSE recovery path: another process is holding the port. Most
    // commonly a stale next-server from a previous run that didn't exit
    // cleanly. Sweep all
    // PIDs on the port (including parent+child pairs); if even after that the
    // port is still occupied, exit with a clear actionable error instead of
    // looping forever (which is what 0.5.7 did).
    if (crashIsAddressInUse()) {
      console.error(`\n⚠️  Port ${port} is in use by another process. Trying to free it...`);
      Promise.all([killAllAppProcesses(port), killProcessOnPort(port)]).then(() => {
        // Give the kernel one more breath, then probe.
        setTimeout(() => {
          const net = require("net");
          const probe = net.createServer();
          probe.once("error", (e) => {
            if (e.code === "EADDRINUSE") {
              console.error(`\n❌ Port ${port} is still occupied after attempted cleanup.`);
              console.error(`   Identify the holder (Windows: netstat -ano | findstr :${port}; macOS/Linux: lsof -i:${port}).`);
              console.error(`   Either stop that process, or run kRouter on a different port: krouter --port <N>`);
              process.exit(1);
            }
            // Other error — try anyway
            server = spawnServer();
            attachServerEvents();
          });
          probe.once("listening", () => {
            probe.close(() => {
              restartCount = 0;
              server = spawnServer();
              attachServerEvents();
            });
          });
          probe.listen(port, host);
        }, 800);
      });
      return;
    }

    if (restartCount >= MAX_RESTARTS) {
      console.error(`\n⚠️  Server crashed ${MAX_RESTARTS} times. Disabling MIT and restarting...`);
      try {
        const dbPath = path.join(getAppDataDir(), "db.json");
        if (fs.existsSync(dbPath)) {
          const db = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
          if (db.settings) db.settings.mitmEnabled = false;
          fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        }
      } catch { /* best effort */ }
      restartCount = 0;
      server = spawnServer();
      attachServerEvents();
      return;
    }

    restartCount++;
    const delay = Math.min(1000 * restartCount, 10000);
    console.error(`\n⚠️  Server exited (code=${code ?? "unknown"}). Restarting in ${delay / 1000}s... (${restartCount}/${MAX_RESTARTS})`);
    if (crashLog.length) {
      console.error("\n--- Server crash log ---");
      crashLog.forEach(l => console.error(l));
      console.error("--- End crash log ---\n");
    }

    setTimeout(() => {
      server = spawnServer();
      attachServerEvents();
    }, delay);
  }

  attachServerEvents();
}
