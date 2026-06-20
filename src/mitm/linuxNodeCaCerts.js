// Linux-only helper to set / unset NODE_EXTRA_CA_CERTS so Node + Electron apps
// trust the kRouter MITM root CA.
//
// Why: Node.js + Electron read their OWN bundled Mozilla CA store, not the OS
// trust store. Even after we install kRouter's root CA via
// update-ca-certificates, these apps still reject our self-signed cert with
//   x509: certificate signed by unknown authority
// or
//   self signed certificate in certificate chain
//
// macOS solves this with `launchctl setenv` (per user session). Windows uses
// `setx`. Linux has no single mechanism — env vars need to land in two
// different surfaces because they're read by two different launchers:
//
//   1. Shell rc files (~/.profile / ~/.bashrc / ~/.zshrc)
//      Sourced by interactive + login shells. Covers Antigravity launched
//      from a terminal: `antigravity` or `code --new-window`.
//
//   2. systemd-user environment (~/.config/environment.d/95-krouter.conf)
//      Loaded by `systemd --user` at session start, then inherited by every
//      child process. Covers Antigravity launched from the GNOME / KDE
//      Activities menu, a .desktop file, or a desktop shortcut — those go
//      through systemd-user, NOT a shell, so they never see ~/.profile.
//      Plus ~/.pam_environment as a fallback for older non-systemd setups.
//
// Without #2, GUI-launched Antigravity on Ubuntu rejects TLS even after we
// auto-write the shell rc files. User has to either run from a terminal or
// fall back to `NODE_TLS_REJECT_UNAUTHORIZED=0` which disables ALL cert
// verification (insecure).
//
// Effective after: new shell session for #1, next user login OR
// `systemctl --user daemon-reload` for #2. We surface this in MITM start log.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { log } = require("./logger");

const BLOCK_START = "# >>> krouter NODE_EXTRA_CA_CERTS >>>";
const BLOCK_END = "# <<< krouter NODE_EXTRA_CA_CERTS <<<";

const SHELL_RC_FILES = [
  ".profile",        // POSIX login shell
  ".bash_profile",   // bash login shell on some distros
  ".bashrc",         // bash interactive — covers terminal-launched IDE
  ".zshrc",          // zsh interactive
];

// systemd-user environment.d filename. 95- prefix sorts late so kRouter
// overrides earlier defaults (00-99 priority convention).
const SYSTEMD_ENV_FILE_REL = ".config/environment.d/95-krouter.conf";

// Legacy PAM environment file. Read by pam_env.so on login. Deprecated in
// modern Ubuntu (replaced by systemd-user environment.d) but still works on
// older distros, server installs without systemd-user, and some niche WMs.
const PAM_ENV_FILE_REL = ".pam_environment";

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function buildShellBlock(certPath) {
  return `${BLOCK_START}
# Auto-managed by kRouter — DO NOT EDIT. Set/unset via the kRouter MITM panel.
# Tells Node.js + Electron apps to trust the kRouter MITM root CA.
export NODE_EXTRA_CA_CERTS="${certPath}"
${BLOCK_END}`;
}

// systemd-user environment.d/*.conf — KEY=VALUE per line, no shell syntax.
// No comments inside the value line because systemd parses literally.
function buildSystemdEnvFile(certPath) {
  return `# Auto-managed by kRouter — DO NOT EDIT.
# Loaded by systemd --user at session start so GUI-launched apps
# (Antigravity, Claude Desktop, VS Code from menu) trust kRouter MITM cert.
NODE_EXTRA_CA_CERTS=${certPath}
`;
}

// ~/.pam_environment — KEY=VALUE or KEY DEFAULT=value per line. We use the
// simple form. PAM strips surrounding quotes so paths with spaces would need
// quoting; cert path is in ~/.krouter/mitm/ which has no spaces.
function buildPamBlock(certPath) {
  return `${BLOCK_START}
NODE_EXTRA_CA_CERTS DEFAULT=${certPath}
${BLOCK_END}`;
}

// Strip BEGIN/END marker block from text, preserving everything else.
function stripBlock(contents) {
  if (!contents.includes(BLOCK_START)) return { contents, changed: false };
  const re = new RegExp(`\\n?${escapeRe(BLOCK_START)}[\\s\\S]*?${escapeRe(BLOCK_END)}\\n?`, "g");
  const next = contents.replace(re, "");
  return { contents: next, changed: next !== contents };
}

function writeShellRc(filePath, fileName, newBlock) {
  const existed = fs.existsSync(filePath);
  const current = existed ? fs.readFileSync(filePath, "utf8") : "";
  const { contents: cleaned } = stripBlock(current);

  // Skip rc files that don't exist UNLESS this is .profile — that one we
  // create from scratch so login-shell-launched DEs pick up the env var.
  if (!existed && fileName !== ".profile") return null;

  const sep = cleaned.length > 0 && !cleaned.endsWith("\n") ? "\n\n" : (cleaned.endsWith("\n\n") ? "" : "\n");
  const next = `${cleaned}${sep}${newBlock}\n`;

  if (next === current) return null; // no-op
  fs.writeFileSync(filePath, next, "utf8");
  return filePath;
}

function writeSystemdEnvFile(filePath, certPath) {
  const content = buildSystemdEnvFile(certPath);
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf8");
    if (existing === content) return null;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function writePamEnv(filePath, newBlock) {
  const existed = fs.existsSync(filePath);
  const current = existed ? fs.readFileSync(filePath, "utf8") : "";
  const { contents: cleaned } = stripBlock(current);
  const sep = cleaned.length > 0 && !cleaned.endsWith("\n") ? "\n" : "";
  const next = `${cleaned}${sep}${newBlock}\n`;
  if (next === current) return null;
  fs.writeFileSync(filePath, next, "utf8");
  return filePath;
}

/**
 * Write NODE_EXTRA_CA_CERTS=<certPath> across all Linux env surfaces:
 *   - shell rc files (terminal-launched apps)
 *   - systemd-user environment.d (GUI-launched apps via .desktop / menu)
 *   - ~/.pam_environment (older non-systemd distros, fallback)
 *
 * Idempotent. Returns list of files created OR modified for logging.
 */
function setLinuxNodeExtraCaCerts(certPath) {
  if (process.platform !== "linux") return [];
  if (!certPath || typeof certPath !== "string") return [];

  const home = os.homedir();
  const shellBlock = buildShellBlock(certPath);
  const pamBlock = buildPamBlock(certPath);
  const written = [];

  // Shell rc files
  for (const file of SHELL_RC_FILES) {
    try {
      const result = writeShellRc(path.join(home, file), file, shellBlock);
      if (result) written.push(result);
    } catch (e) {
      log(`[linux-node-ca] Could not write ${file}: ${e.message}`);
    }
  }

  // systemd-user environment (GUI launcher coverage)
  try {
    const result = writeSystemdEnvFile(path.join(home, SYSTEMD_ENV_FILE_REL), certPath);
    if (result) written.push(result);
  } catch (e) {
    log(`[linux-node-ca] Could not write ${SYSTEMD_ENV_FILE_REL}: ${e.message}`);
  }

  // PAM environment (older / non-systemd fallback)
  try {
    const result = writePamEnv(path.join(home, PAM_ENV_FILE_REL), pamBlock);
    if (result) written.push(result);
  } catch (e) {
    log(`[linux-node-ca] Could not write ${PAM_ENV_FILE_REL}: ${e.message}`);
  }

  return written;
}

/**
 * Strip the kRouter env var from all surfaces. Returns files touched.
 */
function unsetLinuxNodeExtraCaCerts() {
  if (process.platform !== "linux") return [];

  const home = os.homedir();
  const removed = [];

  // Shell rc files — strip the marker block
  for (const file of SHELL_RC_FILES) {
    const filePath = path.join(home, file);
    if (!fs.existsSync(filePath)) continue;
    try {
      const current = fs.readFileSync(filePath, "utf8");
      const { contents: stripped, changed } = stripBlock(current);
      if (!changed) continue;
      fs.writeFileSync(filePath, stripped, "utf8");
      removed.push(filePath);
    } catch (e) {
      log(`[linux-node-ca] Could not strip ${file}: ${e.message}`);
    }
  }

  // systemd-user environment — delete the entire file (we own it)
  const systemdPath = path.join(home, SYSTEMD_ENV_FILE_REL);
  if (fs.existsSync(systemdPath)) {
    try {
      fs.unlinkSync(systemdPath);
      removed.push(systemdPath);
    } catch (e) {
      log(`[linux-node-ca] Could not delete ${SYSTEMD_ENV_FILE_REL}: ${e.message}`);
    }
  }

  // PAM environment — strip marker block
  const pamPath = path.join(home, PAM_ENV_FILE_REL);
  if (fs.existsSync(pamPath)) {
    try {
      const current = fs.readFileSync(pamPath, "utf8");
      const { contents: stripped, changed } = stripBlock(current);
      if (changed) {
        if (stripped.trim() === "") fs.unlinkSync(pamPath);
        else fs.writeFileSync(pamPath, stripped, "utf8");
        removed.push(pamPath);
      }
    } catch (e) {
      log(`[linux-node-ca] Could not strip ${PAM_ENV_FILE_REL}: ${e.message}`);
    }
  }

  return removed;
}

module.exports = { setLinuxNodeExtraCaCerts, unsetLinuxNodeExtraCaCerts };
