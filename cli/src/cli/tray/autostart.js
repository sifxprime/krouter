const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const APP_NAME = "krouter";
const APP_LABEL = "com.krouter.autostart";

/**
 * Resolve the absolute path to this package's cli.js.
 *
 * Order of preference:
 *   1. Explicit `cliPath` argument — cleanest, used when called from running
 *      cli.js with `__filename`.
 *   2. `process.argv[1]` if it's our cli.js — true when kRouter is currently
 *      running and the tray menu fires this code path.
 *   3. Compute relative to this file's own location. autostart.js lives at
 *      `<pkg>/src/cli/tray/autostart.js`, so cli.js is three levels up.
 *      This works for any global install layout (nvm, Volta, asdf, Homebrew,
 *      /usr/local, etc.) without depending on `npm bin -g` (removed in npm 9)
 *      or a hardcoded `/usr/local/...` path.
 *
 * Returns null if no candidate exists — callers should not write an autostart
 * entry pointing at a non-existent script.
 */
function getCliJsPath(cliPath) {
  if (cliPath) {
    const resolved = path.resolve(cliPath);
    if (fs.existsSync(resolved)) return resolved;
  }
  if (process.argv[1]) {
    const resolved = path.resolve(process.argv[1]);
    if (path.basename(resolved) === "cli.js" && fs.existsSync(resolved)) {
      return resolved;
    }
  }
  const computed = path.resolve(__dirname, "..", "..", "..", "cli.js");
  if (fs.existsSync(computed)) return computed;
  return null;
}

/**
 * Enable auto startup on OS boot
 * @param {string} cliPath - Optional path to cli.js (defaults to auto-detect)
 * @returns {boolean} success
 */
function enableAutoStart(cliPath) {
  const platform = process.platform;

  if (!["darwin", "win32", "linux"].includes(platform)) return false;
  if (platform === "linux" && !process.env.DISPLAY) return false;

  try {
    if (platform === "darwin") return enableMacOS(cliPath);
    if (platform === "win32") return enableWindows(cliPath);
    if (platform === "linux") return enableLinux(cliPath);
  } catch (err) {
    // Silent fail — autostart is optional
  }
  return false;
}

/**
 * Disable auto startup
 * @returns {boolean} success
 */
function disableAutoStart() {
  const platform = process.platform;
  try {
    if (platform === "darwin") return disableMacOS();
    if (platform === "win32") return disableWindows();
    if (platform === "linux") return disableLinux();
  } catch (err) {}
  return false;
}

/**
 * Check if autostart is enabled.
 *
 * On macOS, both the plist file and the launchd registration must be present —
 * otherwise the tray menu would lie about the state (showing "Enabled" even
 * when launchd has the agent in a failed state or hasn't loaded it).
 */
function isAutoStartEnabled() {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
      if (!fs.existsSync(plistPath)) return false;
      try {
        execSync(`launchctl list ${APP_LABEL}`, {
          stdio: ["ignore", "ignore", "ignore"],
          timeout: 3000
        });
        return true;
      } catch { return false; }
    } else if (platform === "win32") {
      const startupDir = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
      return fs.existsSync(path.join(startupDir, `${APP_NAME}.vbs`));
    } else if (platform === "linux") {
      const autostartDir = path.join(os.homedir(), ".config", "autostart");
      return fs.existsSync(path.join(autostartDir, `${APP_NAME}.desktop`));
    }
  } catch (e) {}
  return false;
}

// ============ macOS ============

/**
 * Returns true when the current Node process IS the running instance that
 * launchd is managing under our agent label.
 *
 * `launchctl unload <plist>` for an Aqua user-domain agent sends SIGTERM to
 * the running process. When the running kRouter cli.js was itself spawned by
 * the autostart launchd agent (i.e. user enabled autostart, then rebooted,
 * then clicked the tray icon's "Disable Auto-start" menu item), an unload
 * would kill the very process executing the click handler — and the tray
 * icon would disappear instead of the menu label flipping back to "Enable
 * Auto-start". This helper lets the enable and disable paths sidestep that
 * by skipping launchctl when we'd otherwise be killing ourselves.
 */
function isAgentSelfMacOS(label = APP_LABEL) {
  try {
    const output = execSync(`launchctl list ${label}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000
    });
    const match = output.match(/"PID"\s*=\s*(\d+)/);
    return !!(match && parseInt(match[1], 10) === process.pid);
  } catch (e) {
    return false;
  }
}

/**
 * Startup sweep: detect autostart entries pointing at a binary or script that
 * no longer exists on disk and remove them. Catches the case where a user
 * reinstalls kRouter to a different global path (nvm switch, Homebrew → npm,
 * etc.) — the old entry references a missing binary and launchd logs an
 * error every boot with no tray icon. After cleanup the user re-enables from
 * the new tray menu and a fresh entry is written.
 */
function sweepDanglingAutostartEntries() {
  if (process.platform === "darwin") {
    const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
    if (!fs.existsSync(plistPath)) return;
    try {
      const content = fs.readFileSync(plistPath, "utf-8");
      const argMatches = [...content.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
      const scriptArg = argMatches.find((a) => /cli\.js$/.test(a));
      if (scriptArg && !fs.existsSync(scriptArg)) {
        if (!isAgentSelfMacOS(APP_LABEL)) {
          try { execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" }); } catch { /* ignore */ }
        }
        fs.unlinkSync(plistPath);
      }
    } catch { /* unreadable plist — skip */ }
  } else if (process.platform === "win32") {
    const startupDir = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    const vbsPath = path.join(startupDir, `${APP_NAME}.vbs`);
    if (!fs.existsSync(vbsPath)) return;
    try {
      const content = fs.readFileSync(vbsPath, "utf-8");
      // VBS shape: WshShell.Run """{nodePath}"" ""{cliJsPath}"" --tray --skip-update", 0, False
      const m = content.match(/WshShell\.Run\s+"""([^"]+)""\s+""([^"]+)""/);
      if (m && (!fs.existsSync(m[1]) || !fs.existsSync(m[2]))) {
        fs.unlinkSync(vbsPath);
      }
    } catch { /* unreadable vbs — skip */ }
  } else if (process.platform === "linux") {
    const autostartDir = path.join(os.homedir(), ".config", "autostart");
    const desktopPath = path.join(autostartDir, `${APP_NAME}.desktop`);
    if (!fs.existsSync(desktopPath)) return;
    try {
      const content = fs.readFileSync(desktopPath, "utf-8");
      const m = content.match(/^Exec=(\S+)\s+(\S+)/m);
      if (m && (!fs.existsSync(m[1]) || !fs.existsSync(m[2]))) {
        fs.unlinkSync(desktopPath);
      }
    } catch { /* unreadable desktop — skip */ }
  }
}

function enableMacOS(cliPath) {
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(launchAgentsDir, `${APP_LABEL}.plist`);

  if (!fs.existsSync(launchAgentsDir)) {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
  }

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  // Don't write a broken plist that references a non-existent script.
  if (!routerScript) return false;

  // Invoke node + cli.js directly with absolute paths — no shell wrapper.
  // EnvironmentVariables.PATH explicitly includes node's bin dir so child
  // processes spawned by cli.js (npm install at runtime, etc.) resolve.
  const launchPath = `${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin`;

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${APP_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${routerScript}</string>
        <string>--tray</string>
        <string>--skip-update</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${launchPath}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/krouter.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/krouter.error.log</string>
</dict>
</plist>`;

  fs.writeFileSync(plistPath, plistContent);

  // If we're the running agent already, launchctl unload/load would send
  // ourselves SIGTERM. Skip it — the plist file is updated on disk and
  // launchd will pick it up at next login. isAutoStartEnabled() will still
  // return true because launchctl already has the agent loaded.
  if (isAgentSelfMacOS()) {
    return true;
  }

  // Register with launchd in the current session.
  try { execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" }); } catch (e) {}
  try { execSync(`launchctl load -w "${plistPath}"`, { stdio: "ignore" }); } catch (e) {
    // Even if load fails, the plist is on disk and will be picked up at next login.
  }
  return true;
}

function disableMacOS() {
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);

  // Don't kill ourselves: when the current process is the running agent,
  // `launchctl unload` would send SIGTERM and the user clicking
  // "Disable Auto-start" from the tray menu would lose their tray icon.
  if (!isAgentSelfMacOS()) {
    try { execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" }); } catch (e) {}
  }

  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
  }
  return true;
}

// ============ Windows ============

function enableWindows(cliPath) {
  const startupDir = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  const vbsPath = path.join(startupDir, `${APP_NAME}.vbs`);

  if (!fs.existsSync(startupDir)) return false;

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  // Run node + cli.js directly, hidden window.
  const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${nodePath}"" ""${routerScript}"" --tray --skip-update", 0, False
`;
  fs.writeFileSync(vbsPath, vbsContent);
  return true;
}

function disableWindows() {
  const startupDir = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  const vbsPath = path.join(startupDir, `${APP_NAME}.vbs`);
  if (fs.existsSync(vbsPath)) {
    try { fs.unlinkSync(vbsPath); } catch { /* best effort */ }
  }
  return true;
}

// ============ Linux ============

function enableLinux(cliPath) {
  const autostartDir = path.join(os.homedir(), ".config", "autostart");
  const desktopPath = path.join(autostartDir, `${APP_NAME}.desktop`);

  if (!fs.existsSync(autostartDir)) {
    try { fs.mkdirSync(autostartDir, { recursive: true }); }
    catch (e) { return false; }
  }

  const nodePath = process.execPath;
  const routerScript = getCliJsPath(cliPath);
  if (!routerScript) return false;

  const desktopContent = `[Desktop Entry]
Type=Application
Name=kRouter
Comment=kRouter API Proxy
Exec=${nodePath} ${routerScript} --tray --skip-update
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
  fs.writeFileSync(desktopPath, desktopContent);
  return true;
}

function disableLinux() {
  const autostartDir = path.join(os.homedir(), ".config", "autostart");
  const desktopPath = path.join(autostartDir, `${APP_NAME}.desktop`);
  if (fs.existsSync(desktopPath)) {
    try { fs.unlinkSync(desktopPath); } catch { /* best effort */ }
  }
  return true;
}

module.exports = {
  enableAutoStart,
  disableAutoStart,
  isAutoStartEnabled,
  sweepDanglingAutostartEntries
};
