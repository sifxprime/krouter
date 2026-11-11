// Per-IDE CA trust, for tools whose runtime ignores the OS trust store.
//
// Installing the root CA in the system store is not enough, and NODE_EXTRA_CA_CERTS
// is not enough either, because the tools we intercept use three different runtimes:
//
//   Kiro            native/Chromium -> reads the OS trust store. Nothing to do.
//   Claude Desktop  Electron + Node -> reads Node's OWN bundled Mozilla CA list,
//                   so it needs NODE_EXTRA_CA_CERTS (set by the manager).
//   Antigravity     Go language server -> reads neither. It fails with
//                     x509: certificate signed by unknown authority
//                   and must be pointed at the cert through its own VS Code
//                   setting, "antigravity.caCertificates".
//
// Without this file, turning MITM on broke Antigravity sign-in outright: the DNS
// entry redirects daily-cloudcode-pa.googleapis.com to us, the Go client refuses
// our cert, and the IDE drops the user back to the login screen.
//
// The setting is written once and left in place. It is inert while MITM is off
// (nothing redirects to us, so the cert is never presented), and leaving it means
// an IDE started at any time already trusts us - no "start kRouter first, then
// your IDE" ordering for the user to get wrong. It is removed only when the root
// CA itself is uninstalled.

const fs = require("fs");
const path = require("path");
const os = require("os");

// VS Code-family IDEs that ship a Go (or otherwise non-OS-trust) client, and the
// setting each one reads. userDirs are tried in order; all that exist are written.
const IDE_CA_SETTINGS = [
  {
    id: "antigravity",
    name: "Antigravity IDE",
    setting: "antigravity.caCertificates",
    // The setting takes an array of PEM paths.
    value: (certPath) => [certPath],
    userDirs: () => {
      const home = os.homedir();
      if (process.platform === "darwin") {
        return [
          path.join(home, "Library", "Application Support", "Antigravity IDE", "User"),
          path.join(home, "Library", "Application Support", "Antigravity", "User"),
        ];
      }
      if (process.platform === "win32") {
        const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
        return [path.join(appData, "Antigravity IDE", "User"), path.join(appData, "Antigravity", "User")];
      }
      return [
        path.join(home, ".config", "Antigravity IDE", "User"),
        path.join(home, ".config", "Antigravity", "User"),
      ];
    },
  },
];

// VS Code writes settings.json with comments allowed; strip them before parsing so
// a user's commented config is not destroyed by a failed parse.
function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf-8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    try {
      return JSON.parse(stripped);
    } catch {
      return null; // unreadable - caller leaves the file alone
    }
  }
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Point every installed IDE that needs it at the kRouter root CA.
 * Idempotent: a file already holding the right value is not rewritten.
 * @param {string} certPath - absolute path to rootCA.crt
 * @returns {{written: string[], skipped: string[], failed: string[]}}
 */
function configureIdeCaTrust(certPath) {
  const out = { written: [], skipped: [], failed: [] };
  if (!certPath || !fs.existsSync(certPath)) return out;

  for (const ide of IDE_CA_SETTINGS) {
    for (const dir of ide.userDirs()) {
      // Only touch an IDE the user actually has: its User dir must already exist.
      if (!fs.existsSync(dir)) continue;
      const file = path.join(dir, "settings.json");
      const current = readSettings(file);
      if (current === null) {
        out.failed.push(`${ide.name}: settings.json is not parseable, left untouched`);
        continue;
      }
      const want = ide.value(certPath);
      if (sameValue(current[ide.setting], want)) {
        out.skipped.push(`${ide.name}: already trusts the kRouter CA`);
        continue;
      }
      try {
        const next = { ...current, [ide.setting]: want };
        fs.writeFileSync(file, `${JSON.stringify(next, null, 4)}\n`);
        out.written.push(`${ide.name}: ${ide.setting}`);
      } catch (e) {
        out.failed.push(`${ide.name}: ${e.message}`);
      }
    }
  }
  return out;
}

/**
 * Remove the settings we added. Called when the root CA is uninstalled, NOT when
 * MITM stops - see the header for why.
 * @returns {{removed: string[], failed: string[]}}
 */
function removeIdeCaTrust() {
  const out = { removed: [], failed: [] };
  for (const ide of IDE_CA_SETTINGS) {
    for (const dir of ide.userDirs()) {
      const file = path.join(dir, "settings.json");
      if (!fs.existsSync(file)) continue;
      const current = readSettings(file);
      if (current === null || !(ide.setting in current)) continue;
      try {
        const next = { ...current };
        delete next[ide.setting];
        fs.writeFileSync(file, `${JSON.stringify(next, null, 4)}\n`);
        out.removed.push(`${ide.name}: ${ide.setting}`);
      } catch (e) {
        out.failed.push(`${ide.name}: ${e.message}`);
      }
    }
  }
  return out;
}

module.exports = { configureIdeCaTrust, removeIdeCaTrust, IDE_CA_SETTINGS, __test__: { readSettings } };
