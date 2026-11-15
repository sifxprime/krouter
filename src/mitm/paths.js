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

  // Mirrors src/lib/dataDir.js. A Unix path on Windows means a Linux-targeted
  // .env or Docker config leaked into a Windows run; the app ignores it, so
  // honouring it here resolved it against the current drive root and put the
  // certificate on a different path from the database. Worse for MITM: the app
  // was then sitting on the DEFAULT data dir while IS_DEFAULT_DATA_DIR said
  // false, so machine-wide trust was skipped and the reason log read "DATA_DIR
  // is not the default install" about an install that was.
  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows - falling back to the default`);
    return appDir();
  }

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

// An escape hatch, because gating machine-wide trust on IS_DEFAULT_DATA_DIR alone
// conflates two situations a path cannot tell apart:
//
//   - a second instance pointed at a scratch dir, which must not touch the
//     machine's trust at all -- the incident above;
//   - a single, permanent install that simply keeps its data somewhere else
//     (DATA_DIR=/opt/krouter), where refusing to write means MITM cannot work:
//     `agy` rejects the certificate and the reason is several skip lines deep in
//     the start log.
//
// So the user says which it is. KROUTER_ALLOW_MACHINE_TRUST=1 declares "this
// install owns the machine's trust configuration". It governs teardown as well as
// setup -- whoever wires trust has to be able to unwire it, or the opt-in just
// moves the orphaned-block problem somewhere new.
//
// One refusal survives the opt-in: a data dir inside the OS temp directory. That
// is the exact shape of the original incident, no permanent install looks like
// it, and trust pointing into a directory that gets cleaned breaks later, far
// from the cause. Being explicit is not the same as being right.
const TRUTHY = new Set(["1", "true", "yes", "on"]);
const MACHINE_TRUST_OPT_IN = TRUTHY.has(
  String(process.env.KROUTER_ALLOW_MACHINE_TRUST ?? "").trim().toLowerCase(),
);

function resolveReal(dir) {
  try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
}

// Resolved on both sides: on macOS os.tmpdir() is /var/folders/... while /tmp is
// a symlink to /private/tmp, so a string compare misses half the cases.
//
// TMPDIR is deliberately not read here. os.tmpdir() already consults it (and
// TEMP/TMP on Windows), and reading it directly would oblige manager.js to
// forward it to the sudo-spawned child -- see SUDO_FORWARDED_ENV, where a
// variable the child reads but never receives is a switch that does nothing.
function isInsideTempDir(dir) {
  const target = resolveReal(dir);
  const roots = [os.tmpdir(), "/tmp", "/private/tmp", "/var/tmp"];
  return roots.filter(Boolean).some((root) => {
    const base = resolveReal(root);
    return target === base || target.startsWith(base + path.sep);
  });
}

const MACHINE_TRUST_ALLOWED =
  IS_DEFAULT_DATA_DIR || (MACHINE_TRUST_OPT_IN && !isInsideTempDir(DATA_DIR));

// Why it decided that, so a skipped write is one log line to diagnose rather than
// an afternoon in the keychain.
const MACHINE_TRUST_REASON = IS_DEFAULT_DATA_DIR
  ? "default data dir"
  : !MACHINE_TRUST_OPT_IN
    ? "DATA_DIR is not the default install - set KROUTER_ALLOW_MACHINE_TRUST=1 if this install owns the machine's trust"
    : isInsideTempDir(DATA_DIR)
      ? `KROUTER_ALLOW_MACHINE_TRUST is set, but DATA_DIR is inside the temp directory (${DATA_DIR}), which is never a permanent install`
      : "KROUTER_ALLOW_MACHINE_TRUST=1";

module.exports = {
  DATA_DIR,
  MITM_DIR,
  APP_NAME,
  IS_DEFAULT_DATA_DIR,
  MACHINE_TRUST_ALLOWED,
  MACHINE_TRUST_REASON,
};
