"use strict";

// Hand the running server over to launchd, so "Hide to Tray" survives the
// terminal that started it.
//
// The old macOS path kept the foreground process alive and told the user they
// could close the terminal. They could not: closing it took kRouter with it.
// Worse, enabling autostart had already written a plist with RunAtLoad and run
// `launchctl load -w`, so launchd immediately tried to start a SECOND kRouter
// while the first still held the port. That one died on EADDRINUSE, leaving the
// terminal-bound process as the only server — exactly the one about to be
// killed.
//
// So the handoff is ordered the other way round: stop ours, free the port, then
// let launchd start the agent and prove it answers before we exit. A process
// launchd owns runs in the user's Aqua session, which is what the tray icon
// needs, and it outlives any terminal.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const net = require("net");

const APP_LABEL = "com.krouter.autostart";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function plistPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
}

/** True when nothing is accepting on the port any more. */
function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.connect({ host: "127.0.0.1", port });
    const settle = (free) => { probe.destroy(); resolve(free); };
    probe.setTimeout(1000, () => settle(false));
    probe.once("connect", () => settle(false));
    probe.once("error", () => settle(true));
  });
}

/**
 * Poll with a real delay between attempts.
 *
 * ECONNREFUSED returns in microseconds, so a loop without a sleep burns every
 * attempt before the thing it waits for has started — the same mistake that
 * made proxy-capture mode report ready against a dead port.
 */
async function waitFor(check, { tries = 40, delayMs = 250 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return true;
    await sleep(delayMs);
  }
  return false;
}

/**
 * Start (or restart) the launchd agent and wait for it to serve the port.
 *
 * `kickstart -k` restarts the service if it is already running, which is what we
 * want: `launchctl load -w` during autostart may have left a failed instance
 * behind after it lost the port race.
 */
async function handOffToLaunchd({
  port, stopCurrent, isKrouterOnPort, log = () => {},
  // Budgets are injectable so they can be exercised in a test without a
  // 30-second wait. Defaults are the production ones.
  freeBudget = { tries: 24, delayMs: 250 },
  serveBudget = { tries: 60, delayMs: 500 },
}) {
  if (process.platform !== "darwin") return { ok: false, reason: "not-darwin" };
  if (!fs.existsSync(plistPath())) return { ok: false, reason: "no-launch-agent" };

  log("Handing the server over to launchd...");

  // Stop ONLY our own server. The first version called the CLI's
  // killAllAppProcesses() here, which kills every kRouter process on the
  // machine -- including this one, mid-handoff, and the launchd agent it was
  // about to start. The menu printed "Handing the server over to launchd..."
  // and the user got their shell prompt back with nothing running and the
  // agent recorded as LastExitStatus = 9.
  try {
    await stopCurrent();
  } catch (e) {
    return { ok: false, reason: `stop-failed: ${e.message}` };
  }

  // Wait for OUR server to let go. A previous agent may legitimately still hold
  // the port -- kickstart -k replaces that one itself, so it is not a blocker.
  await waitFor(() => portIsFree(port), freeBudget);

  try {
    execFileSync("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${APP_LABEL}`], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 15000,
    });
  } catch (e) {
    return { ok: false, reason: `kickstart-failed: ${e.message}` };
  }

  // "Started" is not "serving", and "serving" is not "serving from launchd".
  // Without the ownership check a leftover terminal-bound server answering the
  // port would read as success — which is the exact failure this feature
  // exists to prevent.
  const ok = await waitFor(
    () => Promise.resolve(isKrouterOnPort(port) && agentOwnsPort(port)),
    serveBudget
  );
  if (!ok) {
    return {
      ok: false,
      reason: isKrouterOnPort(port) ? "port-served-but-not-by-launchd" : "agent-did-not-serve",
    };
  }

  return { ok: true, label: APP_LABEL, pid: agentPid() };
}

/** PID launchd reports for our agent, or null when it is not running. */
function agentPid() {
  try {
    const out = execFileSync("launchctl", ["list", APP_LABEL], { encoding: "utf-8", timeout: 5000 });
    const m = out.match(/"PID"\s*=\s*(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * True when the process holding the port is the launchd agent, or descends
 * from it. The server runs as a child (cli.js --tray spawns next-server), so
 * the holder is usually the agent's child rather than the agent itself.
 */
function agentOwnsPort(port) {
  const agent = agentPid();
  if (!agent) return false;
  let holder;
  try {
    const out = execFileSync("/bin/sh", ["-c", `lsof -nP -a -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | head -1`],
      { encoding: "utf-8", timeout: 5000 }).trim();
    holder = Number(out);
  } catch {
    return false;
  }
  if (!holder) return false;

  // Walk up: holder -> ... -> agent. Bounded, because a cycle here would hang
  // the menu rather than fail it.
  let cur = holder;
  for (let i = 0; i < 8 && cur && cur !== 1; i += 1) {
    if (cur === agent) return true;
    try {
      cur = Number(execFileSync("/bin/ps", ["-o", "ppid=", "-p", String(cur)],
        { encoding: "utf-8", timeout: 3000 }).trim());
    } catch {
      return false;
    }
  }
  return false;
}


/**
 * Windows / Linux: stop ours, THEN start the detached child, then prove it serves.
 *
 * The old order spawned the child first and called cleanup() afterwards, with a
 * comment saying cleanup "kills server so bgProcess can claim the port fresh".
 * The child does not wait for that: it starts binding immediately, loses to the
 * parent that still holds the port, and lands in the EADDRINUSE restart loop.
 * Sometimes it recovers, sometimes the user is left with a message promising
 * they can close the terminal and no server behind it.
 */
async function handOffToDetachedChild({
  port, cliPath, spawn, stopCurrent, isKrouterOnPort, log = () => {},
  freeBudget = { tries: 24, delayMs: 250 },
  serveBudget = { tries: 60, delayMs: 500 },
}) {
  log("Stopping the foreground server...");
  try {
    await stopCurrent();
  } catch (e) {
    return { ok: false, reason: `stop-failed: ${e.message}` };
  }
  const freed = await waitFor(() => portIsFree(port), freeBudget);
  if (!freed) return { ok: false, reason: "port-still-held" };

  log("Starting the background process...");
  const child = spawn(process.execPath, [cliPath, "--tray", "--skip-update", "-p", String(port)], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env },
  });
  child.unref();

  const serving = await waitFor(() => Promise.resolve(isKrouterOnPort(port)), serveBudget);
  if (!serving) return { ok: false, reason: "background-process-did-not-serve", pid: child.pid };

  return { ok: true, pid: child.pid };
}

module.exports = { handOffToLaunchd, handOffToDetachedChild, agentPid, agentOwnsPort, plistPath, APP_LABEL, portIsFree, waitFor };
