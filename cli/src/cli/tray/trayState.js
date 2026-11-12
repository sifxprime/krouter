"use strict";

// What the tray icon should be showing right now.
//
// The menu bar could not answer "is capture on" — the one question that costs
// the most time when a tool silently stops routing, because enabling capture
// while an IDE is already running looks identical to it working. The icon is
// the right place for that: it is already on screen.
//
// Deliberately filesystem-only. /api/mitm/* is local-only gated behind the CLI
// token, and the tray runs in the CLI process which has no token derivation —
// but the MITM already writes a pid file the CLI reads elsewhere to kill it.
// Reading that file is cheaper than an authenticated HTTP round trip and has
// no failure mode where a slow server makes the icon lie.
//
// There are TWO ways capture runs, and both have to count. `.mitm.pid` is the
// :443 interceptor (hosts-file + sudo) that Claude Desktop and Kiro need;
// `.proxy.pid` is the CONNECT proxy on 20129 that Antigravity's local hop uses
// and that anything with HTTPS_PROXY can point at. Reading only the first made
// the icon say "capture off" with a live Antigravity capture running — exactly
// the lie this is here to prevent.

const fs = require("fs");
const os = require("os");
const path = require("path");

// Fallback when a caller forgets to pass one. path.join(undefined, ...) throws,
// and the throw lands in a catch that reports "not capturing" — so a missing
// argument would quietly disable the whole feature rather than fail loudly.
const DEFAULT_DATA_DIR = process.env.KROUTER_DATA_DIR || path.join(os.homedir(), ".krouter");

const STATES = Object.freeze({
  RUNNING: "running",    // server up, nothing being intercepted
  CAPTURING: "capturing",// MITM alive: traffic is being routed through kRouter
  STOPPED: "stopped",    // server not serving
});

// Icon file per state. The compact mark for all three: these are template
// images (black + alpha) and macOS inverts them per menu-bar theme, so the
// states differ by SHAPE and ALPHA only — colour would be flattened away.
const ICON_FOR_STATE = Object.freeze({
  [STATES.RUNNING]: "icon",
  [STATES.CAPTURING]: "icon-capture",
  [STATES.STOPPED]: "icon-stopped",
});

/** Is this pid a live process? */
function pidAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists and belongs to someone else — the MITM runs under
    // sudo, so this is the normal answer for a healthy capture, not a failure.
    return e && e.code === "EPERM";
  }
}

// Pid file per capture mode, and the word for it in the menu.
const CAPTURE_MODES = Object.freeze({
  intercept: { file: ".mitm.pid", label: "system-wide" },
  proxy: { file: ".proxy.pid", label: "proxy" },
});

/**
 * Is the process named by one mode's pid file alive?
 *
 * A stale pid file is the expected case after a hard kill, so the pid is
 * always probed rather than trusted — otherwise the icon would claim capture
 * forever after one `pkill`.
 */
function modeAlive(appDataDir, file) {
  try {
    const pidFile = path.join(appDataDir || DEFAULT_DATA_DIR, "mitm", file);
    if (!fs.existsSync(pidFile)) return false;
    const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    return pidAlive(pid);
  } catch {
    return false;
  }
}

/**
 * Which capture modes are live right now.
 * @returns {{intercept: boolean, proxy: boolean}}
 */
function captureModes(appDataDir = DEFAULT_DATA_DIR) {
  return {
    intercept: modeAlive(appDataDir, CAPTURE_MODES.intercept.file),
    proxy: modeAlive(appDataDir, CAPTURE_MODES.proxy.file),
  };
}

/** True when capture is live in EITHER mode. */
function isCapturing(appDataDir = DEFAULT_DATA_DIR) {
  const m = captureModes(appDataDir);
  return m.intercept || m.proxy;
}

/**
 * @param {object} opts
 * @param {string} opts.appDataDir  kRouter's data dir (holds mitm/.mitm.pid)
 * @param {boolean} [opts.serverUp] false when the server is known to be down
 */
function currentState({ appDataDir = DEFAULT_DATA_DIR, serverUp = true } = {}) {
  if (!serverUp) return STATES.STOPPED;
  return isCapturing(appDataDir) ? STATES.CAPTURING : STATES.RUNNING;
}

/**
 * Name the live modes, so "Capturing" can say WHICH tools are covered.
 * Proxy-only capture covers Antigravity but not Claude Desktop, and that
 * difference is the whole reason someone looks at this line.
 */
function describeCapture(appDataDir = DEFAULT_DATA_DIR) {
  const m = captureModes(appDataDir);
  const live = [];
  if (m.intercept) live.push(CAPTURE_MODES.intercept.label);
  if (m.proxy) live.push(CAPTURE_MODES.proxy.label);
  return live.join(" + ");
}

/** Base name of the icon for a state, without extension. */
function iconNameForState(state) {
  return ICON_FOR_STATE[state] || ICON_FOR_STATE[STATES.RUNNING];
}

/** One line for the menu, so the state is readable as words too. */
function describeState(state, appDataDir = DEFAULT_DATA_DIR) {
  switch (state) {
    case STATES.CAPTURING: {
      const modes = describeCapture(appDataDir);
      return modes
        ? `Capturing (${modes}) — IDE traffic routes through kRouter`
        : "Capturing — IDE traffic routes through kRouter";
    }
    case STATES.STOPPED:   return "Stopped — not serving";
    default:               return "Running — capture off";
  }
}

module.exports = { STATES, DEFAULT_DATA_DIR, CAPTURE_MODES, currentState, iconNameForState, describeState, describeCapture, captureModes, isCapturing, pidAlive };
