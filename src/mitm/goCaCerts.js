"use strict";

// Make Go-based CLIs trust the kRouter MITM root CA.
//
// WHY THIS EXISTS, SEPARATELY FROM linuxNodeCaCerts.js
//
// Node and Electron read NODE_EXTRA_CA_CERTS, which ADDS a certificate to the
// platform store. kRouter already writes that, which is why Claude Desktop and
// Kiro work. Go reads SSL_CERT_FILE instead, and SSL_CERT_FILE **replaces** the
// system trust store rather than adding to it.
//
// That difference is the whole bug. Antigravity's agent (`agy`) is a Go binary.
// On a machine where anything had already exported SSL_CERT_FILE -- a Python
// certifi bundle from ~/.zshrc is the common case -- agy trusted only that
// bundle, which has no kRouter CA, and rejected the MITM certificate on every
// call. The System keychain DID trust kRouter the whole time; the variable hid
// it. It looked exactly like certificate pinning, and was recorded in this
// codebase as such for months.
//
// Two consequences shape this module:
//
//   1. What we point SSL_CERT_FILE at must be a SUPERSET of the system roots,
//      never the kRouter CA alone. Writing just the CA would make every Go tool
//      on the machine distrust the rest of the internet.
//   2. If something else already set SSL_CERT_FILE, we must merge that bundle
//      rather than replace it, or we silently narrow trust the user chose.
//
// Windows is not handled here and does not need to be: Go reads SSL_CERT_FILE
// only on Unix (crypto/x509 root_unix.go). On Windows it uses the system
// certificate store, which kRouter already populates with `certutil -addstore
// Root`, so Go tools there trust the MITM with no environment work at all.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const BLOCK_START = "# >>> krouter SSL_CERT_FILE >>>";
const BLOCK_END = "# <<< krouter SSL_CERT_FILE <<<";

// Same surfaces as the Node wiring, so both land in the same places.
const SHELL_RC_FILES = [".profile", ".bash_profile", ".bashrc", ".zshrc"];

// Where distributions keep the system CA bundle, best first.
const LINUX_CA_BUNDLES = [
  "/etc/ssl/certs/ca-certificates.crt",   // Debian/Ubuntu
  "/etc/pki/tls/certs/ca-bundle.crt",     // RHEL/Fedora
  "/etc/ssl/ca-bundle.pem",               // SUSE
  "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
  "/etc/ssl/cert.pem",                    // Alpine, and macOS's OpenSSL copy
];

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function countCerts(text) {
  return (String(text).match(/BEGIN CERTIFICATE/g) || []).length;
}

/** The system's own trust material, as PEM text. Null when we cannot find it. */
function readSystemRoots() {
  if (process.platform === "darwin") {
    try {
      const pem = execSync(
        "security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain",
        { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024, timeout: 20000 }
      );
      return countCerts(pem) > 0 ? pem : null;
    } catch {
      // Fall through to the file list: macOS ships /etc/ssl/cert.pem too.
    }
  }
  for (const file of LINUX_CA_BUNDLES) {
    try {
      const pem = fs.readFileSync(file, "utf-8");
      if (countCerts(pem) > 0) return pem;
    } catch { /* next */ }
  }
  return null;
}

/**
 * Write <mitmDir>/ssl-cert-file.pem = system roots + kRouter CA.
 *
 * Refuses rather than writing something that would narrow trust: if the system
 * roots cannot be read, or the result looks implausibly small, no file is
 * written and nothing is pointed at it.
 */
function buildGoCaBundle(rootCAPath, mitmDir, readRoots = readSystemRoots) {
  if (!fs.existsSync(rootCAPath)) return { ok: false, reason: "no-root-ca" };
  const ca = fs.readFileSync(rootCAPath, "utf-8");
  if (countCerts(ca) < 1) return { ok: false, reason: "root-ca-not-pem" };

  const roots = readRoots();
  if (!roots) return { ok: false, reason: "system-roots-unreadable" };

  // A real root store is dozens to hundreds of certs. Anything tiny means we
  // read the wrong file, and pointing SSL_CERT_FILE at it would break TLS for
  // every Go tool on the machine.
  const total = countCerts(roots) + countCerts(ca);
  if (total < 20) return { ok: false, reason: `implausible-bundle-${total}` };

  const bundlePath = path.join(mitmDir, "ssl-cert-file.pem");
  fs.writeFileSync(bundlePath, `${roots.trimEnd()}\n${ca.trimEnd()}\n`);
  return { ok: true, bundlePath, certCount: total };
}

/**
 * The shell block.
 *
 * It does the merge at shell start rather than at write time, because the
 * variable may be set by a LATER line in the same file -- which is exactly how
 * the original bug happened: ~/.zshrc exported a certifi bundle, and anything
 * we had set earlier would simply be overwritten. Running last and consuming
 * whatever is currently set is the only ordering that survives that.
 */
function buildShellBlock(bundlePath, caPath) {
  const merged = path.join(path.dirname(bundlePath), "ssl-cert-file.merged.pem");
  return `${BLOCK_START}
# Auto-managed by kRouter — DO NOT EDIT. Set/unset via the kRouter MITM panel.
# Go programs (Antigravity's agy, and other Go CLIs) read SSL_CERT_FILE, and it
# REPLACES the system trust store instead of adding to it. So this must always
# point at a bundle that contains the system roots AND the kRouter CA.
if [ -r "${caPath}" ]; then
  if [ -n "\${SSL_CERT_FILE:-}" ] && [ "\${SSL_CERT_FILE}" != "${bundlePath}" ] && [ "\${SSL_CERT_FILE}" != "${merged}" ]; then
    # Something else set it. Keep their roots and add ours, rather than
    # silently narrowing the trust they chose.
    if [ -r "\${SSL_CERT_FILE}" ] && { [ ! -s "${merged}" ] || [ "\${SSL_CERT_FILE}" -nt "${merged}" ] || [ "${caPath}" -nt "${merged}" ]; }; then
      cat "\${SSL_CERT_FILE}" "${caPath}" > "${merged}" 2>/dev/null
    fi
    [ -s "${merged}" ] && export SSL_CERT_FILE="${merged}"
  elif [ -s "${bundlePath}" ]; then
    export SSL_CERT_FILE="${bundlePath}"
  fi
fi
${BLOCK_END}`;
}

function stripBlock(contents) {
  if (!contents.includes(BLOCK_START)) return { contents, changed: false };
  const re = new RegExp(`\\n?${escapeRe(BLOCK_START)}[\\s\\S]*?${escapeRe(BLOCK_END)}\\n?`, "g");
  const next = contents.replace(re, "");
  return { contents: next, changed: next !== contents };
}

/** Append or replace our block in one rc file. Returns true when it changed. */
function writeShellRc(filePath, newBlock) {
  let existing = "";
  try { existing = fs.readFileSync(filePath, "utf-8"); } catch { /* new file */ }
  const { contents: withoutOurs } = stripBlock(existing);
  // Our block must come LAST, so it sees whatever earlier lines exported.
  const next = `${withoutOurs.replace(/\n*$/, "")}\n\n${newBlock}\n`;
  if (next === existing) return false;
  fs.writeFileSync(filePath, next);
  return true;
}

/**
 * Point SSL_CERT_FILE at a bundle kRouter is in, across the shell surfaces.
 * Returns the files actually changed.
 */
function setGoSslCertFile(rootCAPath, mitmDir, readRoots = readSystemRoots) {
  if (process.platform === "win32") return { written: [], skipped: "windows-uses-cert-store" };
  const built = buildGoCaBundle(rootCAPath, mitmDir, readRoots);
  if (!built.ok) return { written: [], skipped: built.reason };

  const block = buildShellBlock(built.bundlePath, rootCAPath);
  const home = os.homedir();
  const written = [];
  for (const file of SHELL_RC_FILES) {
    const full = path.join(home, file);
    // Only touch files that exist, except .profile which is the safe default
    // to create on a machine that has none of them.
    if (!fs.existsSync(full) && file !== ".profile") continue;
    try {
      if (writeShellRc(full, block)) written.push(full);
    } catch { /* unwritable rc; the others still cover the shell */ }
  }
  return { written, bundlePath: built.bundlePath, certCount: built.certCount };
}

/** Remove our block everywhere. The bundle file itself is left on disk. */
function unsetGoSslCertFile() {
  if (process.platform === "win32") return { written: [] };
  const home = os.homedir();
  const written = [];
  for (const file of SHELL_RC_FILES) {
    const full = path.join(home, file);
    if (!fs.existsSync(full)) continue;
    try {
      const existing = fs.readFileSync(full, "utf-8");
      const { contents, changed } = stripBlock(existing);
      if (changed) { fs.writeFileSync(full, contents); written.push(full); }
    } catch { /* unwritable */ }
  }
  return { written };
}

module.exports = {
  setGoSslCertFile,
  unsetGoSslCertFile,
  buildGoCaBundle,
  readSystemRoots,
  buildShellBlock,
  stripBlock,
  BLOCK_START,
  BLOCK_END,
  SHELL_RC_FILES,
};
