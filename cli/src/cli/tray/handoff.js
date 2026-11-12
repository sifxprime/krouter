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

  // Ours has to let go of the port first, or the agent dies on EADDRINUSE the
  // same way it has been doing silently until now.
  try {
    await stopCurrent();
  } catch (e) {
    return { ok: false, reason: `stop-failed: ${e.message}` };
  }
  const freed = await waitFor(() => portIsFree(port), freeBudget);
  if (!freed) return { ok: false, reason: "port-still-held" };

  try {
    execFileSync("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${APP_LABEL}`], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 15000,
    });
  } catch (e) {
    return { ok: false, reason: `kickstart-failed: ${e.message}` };
  }

  // "Started" is not "serving". Only a reply from the port counts, and only one
  // that identifies itself as kRouter — something else may have taken the port
  // in the gap we just opened.
  const serving = await waitFor(() => Promise.resolve(isKrouterOnPort(port)), serveBudget);
  if (!serving) return { ok: false, reason: "agent-did-not-serve" };

  return { ok: true, label: APP_LABEL };
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

module.exports = { handOffToLaunchd, handOffToDetachedChild, plistPath, APP_LABEL, portIsFree, waitFor };
