const fs = require("fs");
const crypto = require("crypto");
const { exec } = require("child_process");
const { execWithPassword, isSudoAvailable } = require("../dns/dnsConfig.js");
const { runElevatedPowerShell, quotePs } = require("../winElevated.js");
const { log, err } = require("../logger");

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const LINUX_CERT_PATHS = [
  // Debian / Ubuntu
  { dir: "/usr/local/share/ca-certificates", cmd: "update-ca-certificates" },
  // Arch Linux / CachyOS / Manjaro
  { dir: "/etc/ca-certificates/trust-source/anchors", cmd: "update-ca-trust" },
  // Fedora / RHEL / CentOS
  { dir: "/etc/pki/ca-trust/source/anchors", cmd: "update-ca-trust" },
  // openSUSE
  { dir: "/etc/pki/trust/anchors", cmd: "update-ca-certificates" }
];

function getLinuxCertConfig() {
  for (const config of LINUX_CERT_PATHS) {
    if (fs.existsSync(config.dir)) {
      return config;
    }
  }
  // Fallback to Debian default if none exist
  return LINUX_CERT_PATHS[0];
}
const ROOT_CA_CN = "9Router MITM Root CA";

// Get SHA1 fingerprint from cert file using Node.js crypto
function getCertFingerprint(certPath) {
  const pem = fs.readFileSync(certPath, "utf-8");
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""), "base64");
  return crypto.createHash("sha1").update(der).digest("hex").toUpperCase().match(/.{2}/g).join(":");
}

/**
 * Check if certificate is already installed in system store
 */
async function checkCertInstalled(certPath) {
  if (IS_WIN) return checkCertInstalledWindows(certPath);
  if (IS_MAC) return checkCertInstalledMac(certPath);
  return checkCertInstalledLinux();
}

function checkCertInstalledMac(certPath) {
  return new Promise((resolve) => {
    try {
      const fingerprint = getCertFingerprint(certPath).replace(/:/g, "");
      // Verify exact cert bytes match — same CN with different fingerprint = stale cert
      exec(`security find-certificate -a -c "${ROOT_CA_CN}" -Z /Library/Keychains/System.keychain 2>/dev/null`, { windowsHide: true }, (error, stdout) => {
        if (error || !stdout) return resolve(false);
        const match = new RegExp(`SHA-1 hash:\\s*${fingerprint}`, "i").test(stdout);
        if (!match) return resolve(false);
        // Cert exists with matching fingerprint — confirm trust policy
        exec(`security verify-cert -c "${certPath}" -p ssl -k /Library/Keychains/System.keychain 2>/dev/null`, { windowsHide: true }, (err2) => {
          resolve(!err2);
        });
      });
    } catch {
      resolve(false);
    }
  });
}

function checkCertInstalledWindows(certPath) {
  return new Promise((resolve) => {
    // Check by SHA1 fingerprint — detects stale cert with same CN but different key
    let fingerprint;
    try {
      fingerprint = getCertFingerprint(certPath).replace(/:/g, "");
    } catch {
      return resolve(false);
    }
    exec(`certutil -store Root ${fingerprint}`, { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Install SSL certificate to system trust store
 */
async function installCert(sudoPassword, certPath) {
  if (!fs.existsSync(certPath)) {
    throw new Error(`Certificate file not found: ${certPath}`);
  }

  const isInstalled = await checkCertInstalled(certPath);
  if (isInstalled) {
    log("🔐 Cert: already trusted ✅");
    return;
  }

  if (IS_WIN) {
    await installCertWindows(certPath);
  } else if (IS_MAC) {
    await installCertMac(sudoPassword, certPath);
  } else {
    await installCertLinux(sudoPassword, certPath);
  }
}

/**
 * Turn a failed privileged command into something the user can act on.
 *
 * Everything here used to collapse into the single string "Certificate install failed".
 * A mistyped sudo password produces stderr like:
 *
 *   Password:Sorry, try again.\nsudo: no password was provided\nsudo: 1 incorrect password attempt
 *
 * which the user saw as a broken certificate rather than a typo, with nothing in the
 * UI to suggest retyping the password. The real stderr is the only diagnostic there is.
 */
function describeSudoFailure(error) {
  const raw = (error && error.message) || "";
  if (/incorrect password attempt|Sorry, try again|no password was provided/i.test(raw)) {
    return "Incorrect sudo password — check the password and try again";
  }
  if (/canceled|cancelled/i.test(raw)) return "User canceled authorization";
  if (/not allowed to execute|not in the sudoers/i.test(raw)) {
    return "This account is not permitted to use sudo, so the certificate cannot be installed system-wide";
  }
  const detail = raw
    .replace(/Password:/gi, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-3)
    .join("; ");
  return detail ? `Certificate install failed: ${detail}` : "Certificate install failed";
}

async function installCertMac(sudoPassword, certPath) {
  // A certificate with this CN can already be present from an earlier run under a
  // different key -- checkCertInstalled compares fingerprints, so it correctly reports
  // "not trusted" in that case. delete-certificate removes one match per call, so a
  // single call can leave older copies behind; loop until there are none left.
  const deleteOld =
    `for _ in 1 2 3 4 5; do security delete-certificate -c "${ROOT_CA_CN}" ` +
    `/Library/Keychains/System.keychain >/dev/null 2>&1 || break; done`;
  const install = `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`;
  try {
    // `;` not `&&`: the install must run even when there was nothing to delete.
    await execWithPassword(`${deleteOld}; ${install}`, sudoPassword);
  } catch (error) {
    throw new Error(describeSudoFailure(error));
  }

  // add-trusted-cert can exit 0 without the certificate actually becoming trusted.
  // Confirm it rather than reporting a success that was never verified.
  if (!(await checkCertInstalled(certPath))) {
    throw new Error(
      `Certificate was installed but is still not trusted. Open Keychain Access, ` +
      `select the System keychain, and remove any older "${ROOT_CA_CN}" entry, then retry.`
    );
  }
  log("🔐 Cert: ✅ installed to system keychain");
}

async function installCertWindows(certPath) {
  // Auto-elevate via UAC popup if not admin (zero popup if already admin).
  // Delete any stale cert with same CN before adding to avoid duplicates.
  const script = `
    certutil -delstore Root ${quotePs(ROOT_CA_CN)} 2>$null | Out-Null
    $exit = & certutil -addstore Root ${quotePs(certPath)} 2>&1
    if ($LASTEXITCODE -ne 0) { throw "certutil exit $LASTEXITCODE" }
  `;
  try {
    await runElevatedPowerShell(script);
    log("🔐 Cert: ✅ installed to Windows Root store");
  } catch (e) {
    throw new Error(`Failed to install certificate: ${e.message}`);
  }
}

/**
 * Run a command, resolving with its error instead of throwing.
 *
 * Both callers below are allowed to fail benignly: `launchctl unsetenv` on a
 * variable that was never set is a no-op, and `reg delete` reports an absent
 * value as an error. Awaiting matters even so -- MITM start uninstalls an
 * expired CA and then reinstalls it a few hundred lines later, so a
 * fire-and-forget unset could land AFTER the re-set and leave the machine with
 * no trust at all.
 */
function execTolerant(command) {
  return new Promise((resolve) => {
    exec(command, { windowsHide: true }, (error) => resolve(error || null));
  });
}

/**
 * Clear NODE_EXTRA_CA_CERTS, the third machine-wide trust surface.
 *
 * Until 0.5.169 all three platforms unset this when MITM *stopped*, which was
 * the wrong moment: trust has to survive a stop or every IDE needs restarting,
 * so that release removed the unsets. It relocated the SSL_CERT_FILE block and
 * the per-IDE settings to this uninstall path -- but not these. macOS and
 * Windows lost their teardown outright, and unsetLinuxNodeExtraCaCerts() was
 * left exported with no call site anywhere in src/ or cli/. This is the
 * relocation that was missed.
 *
 * It is worth doing even though a dangling value cannot break trust. Node
 * ignores a NODE_EXTRA_CA_CERTS naming a missing file and falls back to its
 * bundled roots -- measured on Node 26: the handshake still succeeds and
 * tls.rootCertificates is intact -- but it prints
 *   Warning: Ignoring extra certs from `<path>`, load failed: ... No such file
 * on every secure context it creates. That is every Node and Electron process
 * on the machine, on every TLS call, for as long as the value survives: until
 * the next reboot on macOS, where `launchctl setenv` is session-scoped, and
 * indefinitely on Windows and Linux, which write HKCU\Environment and the shell
 * rc files respectively.
 *
 * Its caller gates this on MACHINE_TRUST_ALLOWED, along with the rest of teardown.
 * Unsetting a machine-wide value a second instance never wrote is the
 * destructive direction: it would strip the real installation's trust.
 */
async function clearNodeExtraCaCerts() {
  if (!IS_WIN && !IS_MAC) {
    const { unsetLinuxNodeExtraCaCerts } = require("../linuxNodeCaCerts");
    return unsetLinuxNodeExtraCaCerts();
  }

  // `reg delete`, not `setx NODE_EXTRA_CA_CERTS ""`: setx would leave an empty
  // value behind, which Node still reads. Neither command distinguishes "was
  // not set" from a real failure, so the caller logs and nothing fails.
  const [command, surface] = IS_MAC
    ? ["launchctl unsetenv NODE_EXTRA_CA_CERTS", "the launchd session"]
    : ["reg delete HKCU\\Environment /F /V NODE_EXTRA_CA_CERTS", "HKCU\\Environment"];

  const error = await execTolerant(command);
  if (error) {
    log(`🔐 Cert: NODE_EXTRA_CA_CERTS not cleared from ${surface} (it may never have been set): ${error.message.split("\n")[0]}`);
    return [];
  }
  return [surface];
}

/**
 * Uninstall SSL certificate from system store
 */
async function uninstallCert(sudoPassword, certPath) {
  // Only the trust-store removal needs the certificate to still be in the store.
  // Teardown of the environment and per-IDE surfaces used to sit behind this same
  // early return, so a machine whose certificate had gone by any other route --
  // uninstalled by hand, keychain cleaned, the file deleted -- kept every block
  // kRouter had written, with the one button that removes them refusing to run.
  const isInstalled = await checkCertInstalled(certPath);
  if (!isInstalled) {
    log("🔐 Cert: not found in system store - clearing the trust it wrote anyway");
  } else if (IS_WIN) {
    await uninstallCertWindows();
  } else if (IS_MAC) {
    await uninstallCertMac(sudoPassword, certPath);
  } else {
    await uninstallCertLinux(sudoPassword);
  }

  // The same gate covers teardown, and more sharply than the write side: every
  // surface below is machine-wide, and removing one a second instance never wrote
  // takes the REAL installation's trust with it. One gate for the lot -- and it is
  // the same flag, so an install that opted in to writing can also clean up.
  const { MACHINE_TRUST_ALLOWED, MACHINE_TRUST_REASON } = require("../paths.js");
  if (!MACHINE_TRUST_ALLOWED) {
    log(`🔐 Cert: machine-wide trust left alone - ${MACHINE_TRUST_REASON}`);
    return;
  }

  // The SSL_CERT_FILE block points Go tools at a bundle built around a cert that
  // no longer exists. Leaving it behind would pin every Go CLI on the machine to
  // a stale trust store -- worse than never having written it, because
  // SSL_CERT_FILE replaces the system store rather than adding to it.
  try {
    const { unsetGoSslCertFile } = require("../goCaCerts");
    const { written } = unsetGoSslCertFile();
    for (const f of written) log(`🔐 Cert: removed SSL_CERT_FILE block from ${f}`);
  } catch (e) {
    log(`🔐 Cert: could not remove SSL_CERT_FILE block: ${e.message}`);
  }

  // NODE_EXTRA_CA_CERTS names that same deleted certificate. Unlike SSL_CERT_FILE
  // it cannot narrow trust -- Node falls back to its bundled roots -- but every
  // Node and Electron process on the machine warns on every TLS call until it is
  // gone, and on Windows the value sits in the registry indefinitely.
  try {
    const cleared = await clearNodeExtraCaCerts();
    for (const c of cleared) log(`🔐 Cert: cleared NODE_EXTRA_CA_CERTS from ${c}`);
  } catch (e) {
    log(`🔐 Cert: could not clear NODE_EXTRA_CA_CERTS: ${e.message}`);
  }

  // 0.5.169 — the per-IDE trust settings point at a cert that no longer exists, so
  // they go with it. MITM stop deliberately leaves them alone; only this removes them.
  try {
    const { removeIdeCaTrust } = require("../ideCaTrust");
    const { removed, failed } = removeIdeCaTrust();
    for (const r of removed) log(`🔐 Cert: removed ${r}`);
    for (const x of failed) log(`🔐 Cert: ${x}`);
  } catch (e) {
    log(`🔐 Cert: failed to remove IDE trust settings: ${e.message}`);
  }
}

async function uninstallCertMac(sudoPassword, certPath) {
  const fingerprint = getCertFingerprint(certPath).replace(/:/g, "");
  const command = `security delete-certificate -Z "${fingerprint}" /Library/Keychains/System.keychain`;
  try {
    await execWithPassword(command, sudoPassword);
    log("🔐 Cert: ✅ uninstalled from system keychain");
  } catch (err) {
    throw new Error("Failed to uninstall certificate");
  }
}

async function uninstallCertWindows() {
  // Auto-elevate via UAC popup if not admin
  const script = `certutil -delstore Root ${quotePs(ROOT_CA_CN)}`;
  try {
    await runElevatedPowerShell(script);
    log("🔐 Cert: ✅ uninstalled from Windows Root store");
  } catch (e) {
    throw new Error(`Failed to uninstall certificate: ${e.message}`);
  }
}

function checkCertInstalledLinux() {
  const config = getLinuxCertConfig();
  const certFile = `${config.dir}/krouter-root-ca.crt`;
  const legacyCertFile = `${config.dir}/9router-root-ca.crt`;
  return Promise.resolve(fs.existsSync(certFile) || fs.existsSync(legacyCertFile));
}

async function updateNssDatabases(certPath, action = 'add') {
  const certName = "9Router MITM Root CA";
  
  const script = `
    if ! command -v certutil &> /dev/null; then
      exit 0
    fi
    
    DIRS="$HOME/.pki/nssdb $HOME/snap/chromium/current/.pki/nssdb"
    
    if [ -d "$HOME/.mozilla/firefox" ]; then
      for profile in "$HOME"/.mozilla/firefox/*/; do
        if [ -f "\${profile}cert9.db" ] || [ -f "\${profile}cert8.db" ]; then
          DIRS="$DIRS $profile"
        fi
      done
    fi

    if [ -d "$HOME/snap/firefox/common/.mozilla/firefox" ]; then
      for profile in "$HOME"/snap/firefox/common/.mozilla/firefox/*/; do
        if [ -f "\${profile}cert9.db" ] || [ -f "\${profile}cert8.db" ]; then
          DIRS="$DIRS $profile"
        fi
      done
    fi

    for db in $DIRS; do
      if [ -d "$db" ]; then
        if [ "${action}" = "add" ]; then
          certutil -d sql:"$db" -A -t "C,," -n "${certName}" -i "${certPath}" 2>/dev/null || \\
          certutil -d "$db" -A -t "C,," -n "${certName}" -i "${certPath}" 2>/dev/null || true
        else
          certutil -d sql:"$db" -D -n "${certName}" 2>/dev/null || \\
          certutil -d "$db" -D -n "${certName}" 2>/dev/null || true
        fi
      fi
    done
  `;
  
  return new Promise((resolve) => {
    exec(script, { shell: "/bin/bash" }, () => resolve());
  });
}

async function installCertLinux(sudoPassword, certPath) {
  if (!isSudoAvailable()) {
    log(`🔐 Cert: cannot install to system store without sudo — trust this file on clients: ${certPath}`);
    // Still try to update user NSS DBs even if no sudo!
    await updateNssDatabases(certPath, 'add');
    return;
  }
  
  const config = getLinuxCertConfig();
  const destFile = `${config.dir}/krouter-root-ca.crt`;

  // Copy to the discovered directory and execute the specific update command.
  // Also best-effort remove the legacy pre-rebrand cert file so the trust store stays clean.
  const legacyFile = `${config.dir}/9router-root-ca.crt`;
  const cmd = `rm -f "${legacyFile}"; cp "${certPath}" "${destFile}" && (${config.cmd} 2>/dev/null || true)`;
  
  try {
    await execWithPassword(cmd, sudoPassword);
    await updateNssDatabases(certPath, 'add');
    log(`🔐 Cert: ✅ installed to Linux trust store (${config.dir}) and user browser databases`);
  } catch (error) {
    throw new Error(`Certificate install failed: ${error.message}`);
  }
}

async function uninstallCertLinux(sudoPassword) {
  // Always try to uninstall from user DBs even without sudo
  await updateNssDatabases(null, 'delete');

  if (!isSudoAvailable()) {
    return;
  }
  
  const config = getLinuxCertConfig();
  const destFile = `${config.dir}/krouter-root-ca.crt`;
  const legacyFile = `${config.dir}/9router-root-ca.crt`;
  const cmd = `rm -f "${destFile}" "${legacyFile}" && (${config.cmd} 2>/dev/null || true)`;
  
  try {
    await execWithPassword(cmd, sudoPassword);
    log("🔐 Cert: ✅ uninstalled from Linux trust store and user browser databases");
  } catch (error) {
    throw new Error("Failed to uninstall certificate");
  }
}

module.exports = { installCert, uninstallCert, checkCertInstalled, describeSudoFailure };
