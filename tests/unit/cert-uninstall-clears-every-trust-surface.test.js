/**
 * Every machine-wide surface the MITM start path writes, the uninstall path clears.
 *
 * `unsetLinuxNodeExtraCaCerts()` sat in linuxNodeCaCerts.js, exported, fully
 * implemented, with no call site anywhere in src/ or cli/. Until 0.5.169 all three
 * platforms unset NODE_EXTRA_CA_CERTS when MITM *stopped*. That release correctly
 * removed the unsets from stop -- trust has to survive a stop, or every IDE needs
 * restarting -- and relocated the SSL_CERT_FILE block and the per-IDE settings to
 * uninstallCert. The NODE_EXTRA_CA_CERTS unsets were not relocated. macOS and
 * Windows lost their teardown outright; Linux kept a function nobody called.
 *
 * The result: uninstalling the root CA left three machine-wide surfaces naming a
 * certificate that no longer existed. Node falls back to its bundled roots, so
 * trust was not broken -- but every Node and Electron process on the machine then
 * printed, on every secure context it created,
 *
 *   Warning: Ignoring extra certs from `...`, load failed: ... No such file
 *
 * and on Windows the value sits in HKCU\Environment indefinitely.
 *
 * Nothing failed, which is the whole point. An orphaned cleanup function parses,
 * lints, exports, and passes every test in the suite. The only thing that catches
 * it is an assertion that each writer has a remover something actually calls --
 * which is what `no cleanup function is left without a caller` below does, so the
 * NEXT orphan fails here rather than shipping.
 *
 * These are source assertions for the same reason mitm-trust-lifecycle.test.js
 * uses them: the real uninstall path needs root and the System keychain, so running
 * it would displace a MITM the developer has working. The behaviour of the writers
 * and removers themselves is covered by go-ca-ssl-cert-file.test.js and
 * ide-ca-trust-no-restart-needed.test.js.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isGuardedByEarlyReturn } from "../helpers/enclosing-guard.js";

const certInstall = fs.readFileSync("src/mitm/cert/install.js", "utf8");
const manager = fs.readFileSync("src/mitm/manager.js", "utf8");

// Comments stripped, for the one assertion below that forbids a literal the
// surrounding comment has to be free to quote in order to explain itself.
const certInstallCode = certInstall
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

// The uninstall function, isolated, so a match elsewhere in the file cannot stand
// in for a call the uninstall path does not actually make.
const UNINSTALL_START = certInstall.search(/async function uninstallCert/);
const uninstallBody = (() => {
  if (UNINSTALL_START < 0) return "";
  const rest = certInstall.slice(UNINSTALL_START);
  // Ends at the next top-level `}` followed by a blank line and a new declaration.
  const end = rest.search(/\n}\n/);
  return end < 0 ? rest : rest.slice(0, end);
})();

/**
 * Top-level `function NAME(` declarations with the source range each one owns.
 * Ranges run to the next declaration, which is close enough: the only thing read
 * off them is which function a given reference sits inside.
 */
function topLevelFunctions(src) {
  const out = [];
  const re = /^(?:async )?function (\w+)\s*\(/gm;
  for (let m; (m = re.exec(src)); ) out.push({ name: m[1], start: m.index });
  for (let i = 0; i < out.length; i++) {
    out[i].end = i + 1 < out.length ? out[i + 1].start : src.length;
  }
  return out;
}

/**
 * Can `name` be reached from something this module exports?
 *
 * A plain text search is not enough, and that is not hypothetical: deleting the
 * call from uninstallCert leaves `unsetLinuxNodeExtraCaCerts` still mentioned in
 * install.js -- inside clearNodeExtraCaCerts, which nothing then calls. A grep
 * sees a call site. There isn't one. So walk outwards from each mention to the
 * function containing it, and keep walking until an export is reached or the
 * chain runs out.
 */
function reachableFromExports(src, name, seen = new Set()) {
  if (seen.has(name)) return false;
  seen.add(name);

  const exportsAt = src.lastIndexOf("module.exports");
  const word = new RegExp(`\\b${name}\\b`);
  if (exportsAt >= 0 && word.test(src.slice(exportsAt))) return true;

  const fns = topLevelFunctions(src);
  for (let m, re = new RegExp(`\\b${name}\\b`, "g"); (m = re.exec(src)); ) {
    if (exportsAt >= 0 && m.index >= exportsAt) continue; // the exports line itself
    const owner = fns.find((f) => m.index > f.start && m.index < f.end);
    if (!owner || owner.name === name) continue; // top level, or its own body
    if (reachableFromExports(src, owner.name, seen)) return true;
  }
  return false;
}

/** Every JS source file under src/, which is where a call site has to live. */
function sourceFiles(dir = "src", out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".next")) continue;
      sourceFiles(full, out);
    } else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("the uninstall path was located", () => {
  it("found uninstallCert, so the assertions below mean something", () => {
    expect(UNINSTALL_START).toBeGreaterThan(-1);
    // A body that failed to slice would make every toContain below vacuous.
    expect(uninstallBody).toContain("checkCertInstalled(certPath)");
    expect(uninstallBody.length).toBeGreaterThan(400);
  });
});

describe("uninstallCert tears down all three machine-wide surfaces", () => {
  it.each([
    ["the Go SSL_CERT_FILE block", "unsetGoSslCertFile"],
    ["the per-IDE trust settings", "removeIdeCaTrust"],
    ["NODE_EXTRA_CA_CERTS", "clearNodeExtraCaCerts"],
  ])("clears %s", (_label, token) => {
    expect(uninstallBody).toContain(token);
  });

  it("covers NODE_EXTRA_CA_CERTS on every platform, not just the one it was written on", () => {
    // The orphan was Linux-only. macOS and Windows had nothing at all, which is
    // why "the function exists" was never the same as "the surface gets cleared".
    expect(certInstall, "Linux rc files / systemd / PAM").toContain("unsetLinuxNodeExtraCaCerts");
    expect(certInstall, "macOS launchd session").toContain("launchctl unsetenv NODE_EXTRA_CA_CERTS");
    expect(certInstall, "Windows HKCU\\Environment").toMatch(/reg delete[^\n]*NODE_EXTRA_CA_CERTS/);
  });

  it("does not use `setx ... \"\"` on Windows, which leaves an empty value Node still reads", () => {
    expect(certInstallCode).not.toMatch(/setx\s+NODE_EXTRA_CA_CERTS\s+""/);
    // and the real removal is still there once comments are gone
    expect(certInstallCode).toMatch(/reg delete[^\n]*NODE_EXTRA_CA_CERTS/);
  });

  it("keeps each teardown in its own try, so one failure cannot abort the rest", () => {
    for (const token of ["unsetGoSslCertFile", "clearNodeExtraCaCerts", "removeIdeCaTrust"]) {
      const i = uninstallBody.indexOf(token);
      const before = uninstallBody.slice(0, i);
      // Inside a try block means the nearest preceding `try {` has not yet been
      // closed by a `catch`.
      expect(before.lastIndexOf("try {"), `${token} is not inside a try block`).toBeGreaterThan(
        before.lastIndexOf("catch ("),
      );
    }
  });
});

describe("no cleanup function is left without a caller", () => {
  // The generalised form of the bug. Any remover exported by a module that writes
  // machine-wide trust must be called from somewhere in src/ other than the file
  // that defines it -- otherwise it is decoration.
  const MODULES = [
    "src/mitm/linuxNodeCaCerts.js",
    "src/mitm/goCaCerts.js",
    "src/mitm/ideCaTrust.js",
  ];
  const files = sourceFiles();

  it("found the source tree to search", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(MODULES)("%s", (modulePath) => {
    const exports = Object.keys(require(path.resolve(modulePath)));
    const removers = exports.filter((n) => /^(unset|remove)/.test(n));
    expect(removers.length, `${modulePath} exports no remover -- did it get renamed?`).toBeGreaterThan(0);

    const orphans = removers.filter((name) =>
      !files.some((f) => {
        if (f === modulePath) return false; // its own definition is not a call site
        const src = fs.readFileSync(f, "utf8");
        return new RegExp(`\\b${name}\\b`).test(src) && reachableFromExports(src, name);
      }),
    );
    expect(
      orphans,
      `exported but unreachable -- cleanup that can never run:\n  ${orphans.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("the teardown sits at the right point in the lifecycle", () => {
  it("lives in the uninstall path, not in the manager", () => {
    // 0.5.169's regression was doing this on stop. mitm-trust-lifecycle.test.js
    // pins the stop body; this pins the file, so it cannot drift back by import.
    expect(manager).not.toContain("clearNodeExtraCaCerts");
    expect(manager).not.toContain("launchctl unsetenv");
  });

  it.each([
    ["the Go SSL_CERT_FILE block", "unsetGoSslCertFile"],
    ["NODE_EXTRA_CA_CERTS", "clearNodeExtraCaCerts()"],
    ["the per-IDE trust settings", "removeIdeCaTrust"],
  ])("%s is behind the DATA_DIR gate", (_label, call) => {
    // Removing a machine-wide value a second instance never wrote takes the REAL
    // installation's trust with it, so every surface here sits behind the same gate
    // as the write -- the same flag, so an install that opted in to writing can
    // also clean up. One early return covers them all; asserted by control flow
    // rather than text order, because text order is what let the ungated writes in
    // manager.js read as gated for two releases.
    const r = isGuardedByEarlyReturn(certInstall, "uninstallCert", call, "MACHINE_TRUST_ALLOWED");
    expect(r.found, `${call} is not in uninstallCert`).toBe(true);
    expect(r.guarded, `${call} runs even on a scratch DATA_DIR`).toBe(true);
  });
});

describe("teardown is not skipped when the certificate is already gone", () => {
  it.each([
    ["the Go SSL_CERT_FILE block", "unsetGoSslCertFile"],
    ["NODE_EXTRA_CA_CERTS", "clearNodeExtraCaCerts()"],
    ["the per-IDE trust settings", "removeIdeCaTrust"],
  ])("%s runs even when the cert was not in the store", (_label, call) => {
    // `if (!isInstalled) return;` used to sit above all of this, so a machine whose
    // certificate had gone by any other route -- removed by hand, keychain cleaned,
    // the file deleted -- kept every block kRouter had written, and the one button
    // that removes them did nothing. Only the trust-store removal may depend on it.
    const r = isGuardedByEarlyReturn(certInstall, "uninstallCert", call, "isInstalled");
    expect(r.guarded, "an early return on !isInstalled skips teardown again").toBe(false);
  });

  it("the uninstall route still reaches it when the cert file is missing", () => {
    // The route had its own `!fs.existsSync(certPath)` early return, which made the
    // fix above unreachable from the only button a user has.
    const route = fs.readFileSync("src/app/api/mitm/cert/route.js", "utf8");
    const branch = route.slice(route.indexOf('action === "uninstall"'), route.indexOf('action === "cleanupLegacy"'));
    expect(branch).toContain("await uninstallCert(");
    const before = branch.slice(0, branch.indexOf("await uninstallCert("));
    expect(before, "a missing cert file must not end the request early").not.toContain("return NextResponse.json");
  });
});
