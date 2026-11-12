const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

let trayInstance = null;
let isWinTray = false;

const { STATES, currentState, iconNameForState, describeState } = require("./trayState");

// The data dir the menu reads capture state from.
//
// buildMenuItems is called from the click handler and both platform inits, none
// of which thread options through — so rather than add a parameter to five call
// sites that would be easy to forget at one of them, initTray records it once
// and the menu text reads it from here. A forgotten parameter would silently
// drop the "(proxy)" / "(system-wide)" detail, which is the only part of the
// line worth reading.
let dataDir;

/**
 * Get icon base64 from file — used for systray (mac/linux)
 *
 * The icon carries the capture state: solid running, dot capturing, faded
 * stopped. All three are template images (black + alpha), so they differ by
 * shape and alpha alone — macOS inverts them per menu-bar theme and would
 * flatten any colour.
 */
function getIconBase64(state = STATES.RUNNING) {
  const isWin = process.platform === "win32";
  const base = iconNameForState(state);
  // Windows ships one .ico; the state variants are PNG only for now, so it
  // falls back rather than asking for a file that is not there.
  const candidates = isWin
    ? ["icon.ico"]
    : [`${base}.png`, "icon.png"];
  try {
    for (const iconFile of candidates) {
      const iconPath = path.join(__dirname, iconFile);
      if (fs.existsSync(iconPath)) {
        return fs.readFileSync(iconPath).toString("base64");
      }
    }
  } catch (e) {}
  // Fallback: minimal green dot icon (PNG)
  return "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAALEwAACxMBAJqcGAAAAHpJREFUOE9jYBgFgwEwMjIy/Gdg+P8fyP4PxP8ZGBgEcBnGyMjIsICBgSEAhyH/gfgBUNN8XJoZsdkCVL8Ah+b/QPwbqvkBMvk/AwMDAzYX/GdgYAhAN+A/SICRWAMYGfFEJSMjzriEiwDR/xmIa2RkZCSqnZERb3QCAAo3KxzxbKe1AAAAAElFTkSuQmCC";
}

let stateTimer = null;
let lastState = null;

/**
 * Keep the icon honest while kRouter runs.
 *
 * Capture is toggled from the dashboard, not from here, so without a poll the
 * icon would only ever show the state at launch — which is exactly the trap
 * this feature exists to close. 4s: slow enough to be free, fast enough that
 * the menu bar agrees with the dashboard before the user looks back at it.
 */
function startStateWatch(options) {
  stopStateWatch();
  const tick = () => {
    try {
      const next = currentState({ appDataDir: options.appDataDir, serverUp: true });
      if (next === lastState) return;          // nothing to redraw
      lastState = next;
      if (!trayInstance || isWinTray) return;  // Windows ships one .ico
      trayInstance.sendAction({
        type: "update-menu",
        menu: {
          icon: getIconBase64(next),
          isTemplateIcon: process.platform === "darwin",
          title: "",
          tooltip: describeState(next, dataDir),
          items: buildMenuItems(options.port, getAutostartEnabled(), next),
        },
      });
    } catch (e) {
      // A tray that cannot redraw must not take the server down with it.
    }
  };
  lastState = null;
  tick();
  stateTimer = setInterval(tick, 4000);
  // Never hold the process open on the icon's account.
  if (stateTimer.unref) stateTimer.unref();
}

function stopStateWatch() {
  if (stateTimer) { clearInterval(stateTimer); stateTimer = null; }
}

/**
 * Check if system tray is supported on current OS
 * Supported: macOS, Windows, Linux (with GUI)
 */
function isTraySupported() {
  const platform = process.platform;
  if (!["darwin", "win32", "linux"].includes(platform)) {
    return false;
  }
  if (platform === "linux" && !process.env.DISPLAY) {
    return false;
  }
  return true;
}

/**
 * Initialize system tray with menu
 * @param {Object} options - { port, onQuit, onOpenDashboard }
 * @returns {Object|null} tray instance or null if not supported/failed
 */
function initTray(options) {
  if (!isTraySupported()) {
    return null;
  }
  dataDir = options && options.appDataDir;

  // Windows uses PowerShell NotifyIcon (AV-safe), others use systray
  if (process.platform === "win32") {
    return initWindowsTray(options);
  }
  return initUnixTray(options);
}

/**
 * Build menu items array shared between platforms
 */
function buildMenuItems(port, autostartEnabled, state = STATES.RUNNING) {
  return [
    { title: `kRouter (Port ${port})`, tooltip: describeState(state, dataDir), enabled: false },
    { title: describeState(state, dataDir), tooltip: "Capture state", enabled: false },
    { title: "Open Dashboard", tooltip: "Open in browser", enabled: true },
    {
      title: autostartEnabled ? "✓ Auto-start Enabled" : "Enable Auto-start",
      tooltip: "Run on OS startup",
      enabled: true
    },
    { title: "Quit", tooltip: "Stop server and exit", enabled: true }
  ];
}

// Menu item indexes
// A line was added after STATUS, so every index below it moved. These are
// positional: the click handler and every update-item call address menu rows
// by number, and a stale index here silently wires a click to the wrong row.
const MENU_INDEX = { STATUS: 0, STATE: 1, DASHBOARD: 2, AUTOSTART: 3, QUIT: 4 };

/**
 * Get current autostart state
 */
function getAutostartEnabled() {
  try {
    const { isAutoStartEnabled } = require("./autostart");
    return isAutoStartEnabled();
  } catch (e) {
    return false;
  }
}

/**
 * Handle menu item click (shared logic)
 */
function handleClick(index, options, onAutostartToggle) {
  const { onQuit, onOpenDashboard, port } = options;
  if (index === MENU_INDEX.DASHBOARD) {
    if (onOpenDashboard) onOpenDashboard();
    else openBrowser(`http://localhost:${port}/dashboard`);
  } else if (index === MENU_INDEX.AUTOSTART) {
    const enabled = getAutostartEnabled();
    try {
      const { enableAutoStart, disableAutoStart } = require("./autostart");
      if (enabled) disableAutoStart();
      else enableAutoStart();
      onAutostartToggle(!enabled);
    } catch (e) {}
  } else if (index === MENU_INDEX.QUIT) {
    console.log("\n👋 Shutting down...");
    if (onQuit) onQuit();
    killTray();
    setTimeout(() => process.exit(0), 500);
  }
}

/**
 * Windows tray via PowerShell NotifyIcon
 */
function initWindowsTray(options) {
  const { port } = options;
  try {
    const { initWinTray } = require("./trayWin");
    const iconPath = path.join(__dirname, "icon.ico");
    const autostartEnabled = getAutostartEnabled();
    const state = currentState({ appDataDir: options.appDataDir, serverUp: true });
    const items = buildMenuItems(port, autostartEnabled, state);

    trayInstance = initWinTray({
      iconPath,
      tooltip: `kRouter - Port ${port}`,
      items,
      onClick: (index) => {
        handleClick(index, options, (newEnabled) => {
          const newTitle = newEnabled ? "✓ Auto-start Enabled" : "Enable Auto-start";
          trayInstance.updateItem(MENU_INDEX.AUTOSTART, newTitle, true);
        });
      }
    });

    isWinTray = true;
    return trayInstance;
  } catch (err) {
    return null;
  }
}

/**
 * macOS/Linux tray via systray binary
 *
 * Prefers `systray2` (active fork of `systray`, ships newer
 * getlantern/systray-portable binaries that work on macOS 14+ and Apple
 * Silicon under Rosetta). Falls back to legacy `systray@1.0.5` if systray2
 * is not available, though that binary's Mach-O headers are rejected by
 * modern dyld and the icon will not appear.
 */
function resolveSystray() {
  let runtimeDir = null;
  try {
    const { getRuntimeNodeModules } = require("../../../hooks/sqliteRuntime");
    runtimeDir = getRuntimeNodeModules();
  } catch (e) {}

  // 1) systray2 in runtime dir (where ensureTrayRuntime installs it)
  if (runtimeDir) {
    try { return { mod: require(path.join(runtimeDir, "systray2")).default, isV2: true }; } catch (e) {}
  }
  // 2) systray2 resolvable from the package's own node_modules / NODE_PATH
  try { return { mod: require("systray2").default, isV2: true }; } catch (e) {}
  // 3) Legacy systray fallback (unlikely to render on modern macOS)
  try { return { mod: require("systray").default, isV2: false }; } catch (e) {}
  if (runtimeDir) {
    try { return { mod: require(path.join(runtimeDir, "systray")).default, isV2: false }; } catch (e) {}
  }
  return null;
}

function chmodTrayBin(pkgName) {
  // systray2's npm tarball occasionally lands without +x on the bundled Go
  // binary (observed on macOS). spawn() then fails with EACCES. Best-effort
  // chmod on every init avoids a hard-to-diagnose silent tray failure.
  try {
    const { getRuntimeNodeModules } = require("../../../hooks/sqliteRuntime");
    const binName = process.platform === "darwin" ? "tray_darwin_release" : "tray_linux_release";
    const candidates = [
      path.join(getRuntimeNodeModules(), pkgName, "traybin", binName),
      path.join(__dirname, "..", "..", "..", "node_modules", pkgName, "traybin", binName)
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) fs.chmodSync(p, 0o755);
    }
  } catch (e) {}
}

function initUnixTray(options) {
  const { port } = options;
  try {
    const resolved = resolveSystray();
    if (!resolved) return null;
    const { mod: SysTray, isV2 } = resolved;

    chmodTrayBin(isV2 ? "systray2" : "systray");

    const autostartEnabled = getAutostartEnabled();
    const state = currentState({ appDataDir: options.appDataDir, serverUp: true });
    const items = buildMenuItems(port, autostartEnabled, state);

    const menu = {
      icon: getIconBase64(state),
      // 0.5.182 — the icons ARE template images now (black + alpha), so this is
      // true on macOS and the glyph follows the menu-bar theme. It was false
      // because the old icon.png was a full-colour RGBA logo, which template
      // mode renders as a solid white square.
      isTemplateIcon: process.platform === "darwin",
      title: "",
      tooltip: `kRouter - Port ${port}`,
      items
    };

    trayInstance = new SysTray({ menu, debug: false, copyDir: true });
    isWinTray = false;
    startStateWatch(options);

    trayInstance.onClick((action) => {
      handleClick(action.seq_id, options, (newEnabled) => {
        trayInstance.sendAction({
          type: "update-item",
          item: {
            title: newEnabled ? "✓ Auto-start Enabled" : "Enable Auto-start",
            tooltip: "Run on OS startup",
            enabled: true
          },
          seq_id: MENU_INDEX.AUTOSTART
        });
      });
    });

    if (isV2) {
      // systray2 exposes a ready() promise instead of onReady/onError. Surface
      // failures (binary crash, EACCES, etc.) so users can see why the icon
      // didn't appear instead of getting a misleading "running in tray" log.
      trayInstance.ready().catch((err) => {
        process.stderr.write(`[krouter] tray failed to start: ${err && err.message ? err.message : err}\n`);
      });
    } else {
      trayInstance.onReady(() => {});
      trayInstance.onError(() => {});
    }

    return trayInstance;
  } catch (err) {
    process.stderr.write(`[krouter] tray init error: ${err.message}\n`);
    return null;
  }
}

/**
 * Kill tray, wait Go binary fully exit (returns Promise).
 * Critical for hide-to-tray: macOS must release NSStatusItem before bgProcess
 * spawns a new tray, otherwise the new icon silently fails to register.
 */
function killTray() {
  stopStateWatch();
  const instance = trayInstance;
  const wasWin = isWinTray;
  trayInstance = null;
  if (!instance) return Promise.resolve();

  if (wasWin) {
    try { instance.kill(); } catch (e) {}
    return Promise.resolve();
  }

  // Unix: get the Go tray child process handle.
  let proc = null;
  try {
    proc = instance._process || (typeof instance.process === "function" ? instance.process() : null);
  } catch (e) {}

  // Graceful shutdown: send {type:"exit"} via IPC so the Go binary can call
  // systray.Quit() and release NSStatusItem. SIGKILL leaves a ghost icon on
  // the macOS menubar until logout, causing duplicate icons after re-spawn.
  const gracefulQuit = () => { try { instance.kill(true); } catch (e) {} };
  const closeIpc = () => { try { instance.kill(false); } catch (e) {} };

  if (!proc || !proc.pid) {
    gracefulQuit();
    closeIpc();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; closeIpc(); resolve(); };

    proc.once("exit", finish);
    gracefulQuit();

    // Escalate: SIGTERM after 800ms, SIGKILL after 1600ms if still alive.
    setTimeout(() => { try { process.kill(proc.pid, 0); proc.kill("SIGTERM"); } catch (e) {} }, 800);
    setTimeout(() => { try { process.kill(proc.pid, 0); proc.kill("SIGKILL"); } catch (e) {} }, 1600);

    // Fallback poll in case "exit" never fires (detached child, pipe closed)
    const deadline = Date.now() + 3000;
    const poll = setInterval(() => {
      try { process.kill(proc.pid, 0); } catch { clearInterval(poll); finish(); return; }
      if (Date.now() > deadline) { clearInterval(poll); finish(); }
    }, 50);
  });
}

/**
 * Open browser
 */
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

  exec(cmd);
}

module.exports = {
  initTray,
  killTray
};
