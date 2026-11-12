"use strict";

// What the interactive menu should be able to tell the user before they choose.
//
// The menu used to show only the server URL, so "Hide to Tray + Start on Login"
// was a leap of faith: no way to tell whether a background service already
// existed, whether the thing answering the port was this terminal's server or a
// detached one, or whether the last handoff had actually worked. When it
// silently failed, the menu looked identical to when it succeeded.

const { execFileSync } = require("child_process");

function sh(cmd, args, timeout = 4000) {
  try {
    return execFileSync(cmd, args, { encoding: "utf-8", timeout, stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** PID listening on the port, or null. */
function portHolder(port) {
  if (process.platform === "win32") {
    const out = sh("netstat", ["-ano", "-p", "TCP"]);
    for (const line of out.split("\n")) {
      if (line.includes(`:${port} `) && line.includes("LISTENING")) {
        const pid = Number(line.trim().split(/\s+/).pop());
        if (pid) return pid;
      }
    }
    return null;
  }
  const out = sh("/bin/sh", ["-c", `lsof -nP -a -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | head -1`]);
  const pid = Number(out);
  return pid || null;
}

/** Walk up a process tree, bounded. Returns the chain including `pid`. */
function ancestry(pid, limit = 8) {
  const chain = [];
  let cur = pid;
  for (let i = 0; i < limit && cur && cur !== 1; i += 1) {
    chain.push(cur);
    const pp = Number(sh("/bin/ps", ["-o", "ppid=", "-p", String(cur)]));
    if (!pp || pp === cur) break;
    cur = pp;
  }
  return chain;
}

/**
 * How the thing on the port is being kept alive.
 *
 *   "launchd"   — macOS agent; survives logout of this terminal entirely
 *   "detached"  — background process with no controlling terminal
 *   "terminal"  — tied to a tty; closing that terminal stops kRouter
 *   "none"      — nothing is listening
 *   "unknown"   — something listens but we could not attribute it
 */
function backgroundMode(port, { selfPid = process.pid } = {}) {
  const holder = portHolder(port);
  if (!holder) return { mode: "none", holder: null };

  if (process.platform === "win32") {
    // No cheap tty notion here; "not us" is the useful distinction.
    return { mode: holder === selfPid ? "terminal" : "detached", holder };
  }

  const chain = ancestry(holder);
  if (chain.includes(selfPid)) return { mode: "terminal", holder, note: "this terminal" };

  // Owned by launchd when the top of the chain reparents to init AND the agent
  // is the one launchd reports.
  if (process.platform === "darwin") {
    const out = sh("launchctl", ["list", "com.krouter.autostart"]);
    const m = out.match(/"PID"\s*=\s*(\d+)/);
    const agent = m ? Number(m[1]) : null;
    if (agent && chain.includes(agent)) return { mode: "launchd", holder, agent };
  }

  const top = chain[chain.length - 1];
  const tty = sh("/bin/ps", ["-o", "tty=", "-p", String(top)]);
  if (!tty || tty === "??" || tty === "?") return { mode: "detached", holder };
  return { mode: "terminal", holder, tty };
}

/** One short line for the menu subtitle. */
function describeBackground(info) {
  switch (info.mode) {
    case "launchd":
      return "\x1b[32mrunning in background\x1b[0m (launchd — survives closing this terminal)";
    case "detached":
      return "\x1b[32mrunning in background\x1b[0m (detached — survives closing this terminal)";
    case "terminal":
      return "\x1b[33mtied to this terminal\x1b[0m — closing it stops kRouter";
    case "none":
      return "\x1b[31mnot running\x1b[0m";
    default:
      return "running (owner unknown)";
  }
}

module.exports = { backgroundMode, describeBackground, portHolder, ancestry };
