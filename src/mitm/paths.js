const fs = require("fs");
const path = require("path");
const os = require("os");

const APP_NAME = "krouter";

function appDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return appDir();
  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback ~/.${APP_NAME}`);
      return appDir();
    }
    throw e;
  }
}

const DATA_DIR = getDataDir();
const MITM_DIR = path.join(DATA_DIR, "mitm");

// 0.5.170 — is this the installation a user actually runs, or a second instance
// pointed at its own DATA_DIR for development or testing?
//
// It matters because starting MITM writes MACHINE-WIDE trust: `launchctl setenv
// NODE_EXTRA_CA_CERTS`, and the per-IDE settings written by ideCaTrust.js. Both are
// absolute paths into DATA_DIR. A second instance run with DATA_DIR=/tmp/something
// therefore silently repoints every Electron app on the machine, and the Antigravity
// IDE, at a certificate under /tmp — which disappears when /tmp is cleaned, and which
// a sandboxed client may not be able to read even while it is there.
//
// Both happened on a real machine during 0.5.169 testing: NODE_EXTRA_CA_CERTS and
// antigravity.caCertificates were both rewritten to a scratch path, and Antigravity's
// Go agent then failed every request with
//   tls: failed to verify certificate: x509: certificate signed by unknown authority
// which looked exactly like a CA-install bug and was not one.
const IS_DEFAULT_DATA_DIR = path.resolve(DATA_DIR) === path.resolve(appDir());

module.exports = { DATA_DIR, MITM_DIR, APP_NAME, IS_DEFAULT_DATA_DIR };
