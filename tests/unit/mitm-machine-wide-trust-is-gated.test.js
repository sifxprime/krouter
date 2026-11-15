/**
 * 0.5.170 — only the real installation may write machine-wide CA trust.
 *
 * Starting MITM writes two things that are not scoped to the instance writing them:
 *   - NODE_EXTRA_CA_CERTS, via `launchctl setenv` / `setx` / the Linux rc files, which
 *     applies to the whole login session and therefore to every Electron app;
 *   - antigravity.caCertificates in the IDE's settings.json.
 * Both are absolute paths INSIDE DATA_DIR.
 *
 * So a second instance started with DATA_DIR pointed at a scratch directory — exactly how
 * you would run a build under test next to a working install — silently repoints the whole
 * machine at a certificate under /tmp. Both happened on a real machine while testing
 * 0.5.169: NODE_EXTRA_CA_CERTS and antigravity.caCertificates were rewritten to
 *   /private/tmp/.../scratchpad/devdata/mitm/rootCA.crt
 * and the Antigravity Go agent then failed every request with
 *   tls: failed to verify certificate: x509: certificate signed by unknown authority
 * The file was there and byte-identical; the sandboxed agent simply could not read that
 * path. It looked exactly like a CA-install bug, and several hours went into the keychain
 * before the cause turned out to be the test instance.
 *
 * That list was incomplete, and this file's own assertions hid it. Two more
 * machine-wide writes were never behind the gate: `SSL_CERT_FILE`, which does not
 * add a root but REPLACES the store, so a scratch bundle hides every good root
 * from every Go program on the machine; and the Linux `NODE_EXTRA_CA_CERTS`
 * rc-file writer. The check for them was
 *
 *   const chain = manager.slice(manager.indexOf("NODE_EXTRA_CA_CERTS is left alone"));
 *   expect(chain).toContain("setLinuxNodeExtraCaCerts(");
 *
 * which only says the call appears somewhere AFTER the gate in the file -- true
 * whether it is gated or not. The comment beside it claimed "macOS, Windows and
 * Linux share one if/else chain; gating its head covers all three"; Linux was a
 * separate `if (IS_LINUX)` the whole time. The assertions below walk braces, via
 * tests/helpers/enclosing-guard.js, and that helper's own ability to tell the two
 * apart is asserted first -- a guard reader that always says "yes" is the bug
 * this file already shipped once.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { blankLiterals, isGuardedBy } from "../helpers/enclosing-guard.js";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const manager = readFileSync("src/mitm/manager.js", "utf8");

// Evaluate paths.js in a child so DATA_DIR can be varied; it is read at module load.
// Both variables are deleted first, so a developer who has either one exported
// does not quietly change what these tests measure.
const probePaths = (overrides = {}) => {
  const env = { ...process.env };
  delete env.DATA_DIR;
  delete env.KROUTER_ALLOW_MACHINE_TRUST;
  Object.assign(env, overrides);
  const out = execFileSync(
    process.execPath,
    [
      "-e",
      'const p = require("./src/mitm/paths.js");' +
        "process.stdout.write(JSON.stringify({" +
        " isDefault: p.IS_DEFAULT_DATA_DIR," +
        " allowed: p.MACHINE_TRUST_ALLOWED," +
        " reason: p.MACHINE_TRUST_REASON }))",
    ],
    { env, encoding: "utf8" },
  );
  return JSON.parse(out);
};

const isDefaultWith = (dataDir) =>
  probePaths(dataDir === undefined ? {} : { DATA_DIR: dataDir }).isDefault;

describe("IS_DEFAULT_DATA_DIR tells the two cases apart", () => {
  it("an ordinary install is the default", () => {
    expect(isDefaultWith(undefined)).toBe(true);
  });

  it("DATA_DIR set to the same directory is still the default", () => {
    // Setting it explicitly to ~/.krouter is not a second instance.
    expect(isDefaultWith(path.join(os.homedir(), ".krouter"))).toBe(true);
  });

  it("a scratch DATA_DIR is NOT the default", () => {
    expect(isDefaultWith(path.join(os.tmpdir(), "krouter-guard-test"))).toBe(false);
  });
});

describe("the guard reader can tell gated from ungated", () => {
  // Asserted before it is pointed at real source. Everything below is worth
  // exactly as much as this is.
  const GATED = 'if (!GATE) {\n  log("skip");\n} else if (IS_MAC) {\n  write();\n}\n';
  const UNGATED = 'if (!GATE) {\n  log("skip");\n}\n\nif (IS_LINUX) {\n  write();\n}\n';

  it("reads an else-if branch of a gated chain as gated", () => {
    expect(isGuardedBy(GATED, "write()", "GATE").guarded).toBe(true);
  });

  it("reads a separate if below the gate as ungated", () => {
    expect(isGuardedBy(UNGATED, "write()", "GATE").guarded).toBe(false);
  });

  it("the assertion this replaced could not tell them apart", () => {
    // Both put the call after the gate's text, which is all the old check asked.
    for (const src of [GATED, UNGATED]) {
      expect(src.slice(src.indexOf("skip"))).toContain("write()");
    }
  });

  it("blanking leaves manager.js's braces balanced", () => {
    // The reader counts braces. If comments, strings, templates or regex literals
    // desynchronise it, it starts calling ungated code gated -- so this is the
    // tripwire for the whole approach, not a detail. It earned its place while
    // this was written: the count drifted by 7, then by 1, because the `/'/g`
    // inside the template on manager.js line 30 was read as a quoted string.
    // It is a tripwire, not a proof of completeness -- it catches drift that
    // actually happens in this file, which is the case that matters.
    const code = blankLiterals(manager);
    let depth = 0;
    for (const c of code) {
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    expect(depth, "brace count drifted; the guard reader cannot be trusted").toBe(0);
  });
});

describe("every machine-wide write is behind the gate", () => {
  it.each([
    ["the per-IDE settings", "configureIdeCaTrust("],
    ["NODE_EXTRA_CA_CERTS on macOS", "launchctl setenv NODE_EXTRA_CA_CERTS"],
    ["NODE_EXTRA_CA_CERTS on Windows", "setx NODE_EXTRA_CA_CERTS"],
    ["NODE_EXTRA_CA_CERTS on Linux", "setLinuxNodeExtraCaCerts("],
    ["SSL_CERT_FILE for Go tools", "setGoSslCertFile("],
  ])("%s", (_label, call) => {
    const r = isGuardedBy(manager, call, "MACHINE_TRUST_ALLOWED");
    expect(r.found, `${call} is not in manager.js -- renamed?`).toBe(true);
    expect(
      r.guarded,
      `${call} is not inside a block gated on MACHINE_TRUST_ALLOWED.\n` +
        `enclosing conditions: ${JSON.stringify(r.conditions)}`,
    ).toBe(true);
  });
});

describe("a skipped write says so", () => {
  it.each([
    ["the per-IDE settings", "[ide-ca] Skipped"],
    ["NODE_EXTRA_CA_CERTS", "[node-ca] Skipped"],
    ["SSL_CERT_FILE", "[go-ca] Skipped"],
    ["the Linux rc files", "[linux-node-ca] Skipped"],
  ])("%s", (_label, line) => {
    // A dev instance that silently behaves differently is how the original
    // incident cost an afternoon in the keychain.
    expect(manager).toContain(line);
  });
});

describe("MACHINE_TRUST_ALLOWED: an opt-in for a permanent custom data dir", () => {
  // Gating on IS_DEFAULT_DATA_DIR alone cannot tell a scratch second instance from
  // a single install that simply keeps its data in /opt. Both were refused, so a
  // custom data dir meant MITM silently could not work at all: `agy` rejects the
  // certificate, and the reason is four skip lines deep in the start log. A path
  // cannot distinguish them, so the user declares it.
  const CUSTOM = path.join(process.cwd(), "node_modules/.cache/krouter-machine-trust-test");
  const TEMP = path.join(os.tmpdir(), "krouter-machine-trust-test");

  afterAll(() => {
    for (const dir of [CUSTOM, TEMP]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  it("the default install needs no opt-in", () => {
    expect(probePaths().allowed).toBe(true);
  });

  it("a custom data dir is refused without it", () => {
    const r = probePaths({ DATA_DIR: CUSTOM });
    expect(r.allowed).toBe(false);
    // The refusal has to name the way out, or it is the same dead end as before.
    expect(r.reason).toContain("KROUTER_ALLOW_MACHINE_TRUST=1");
  });

  it("a custom data dir is allowed with it", () => {
    const r = probePaths({ DATA_DIR: CUSTOM, KROUTER_ALLOW_MACHINE_TRUST: "1" });
    expect(r.allowed).toBe(true);
    expect(r.reason).toContain("KROUTER_ALLOW_MACHINE_TRUST=1");
  });

  it.each([["0"], ["banana"], [""], ["false"]])("the value %o does not opt in", (value) => {
    // An accidental or leftover assignment must not reconfigure the machine.
    expect(probePaths({ DATA_DIR: CUSTOM, KROUTER_ALLOW_MACHINE_TRUST: value }).allowed).toBe(false);
  });

  it.each([["yes"], ["true"], ["on"], ["1"], [" 1 "], ["TRUE"]])("the value %o does opt in", (value) => {
    expect(probePaths({ DATA_DIR: CUSTOM, KROUTER_ALLOW_MACHINE_TRUST: value }).allowed).toBe(true);
  });

  it("the temp directory is refused even with the opt-in", () => {
    // The one refusal the opt-in cannot override. This is the exact shape of the
    // 0.5.169 incident -- DATA_DIR under /private/tmp/.../scratchpad -- no permanent
    // install looks like it, and trust pointing into a directory that gets cleaned
    // breaks later, a long way from the cause. Being explicit is not being right.
    const r = probePaths({ DATA_DIR: TEMP, KROUTER_ALLOW_MACHINE_TRUST: "1" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("temp directory");
  });

  it("the opt-in governs teardown too, not just the write", () => {
    // Otherwise it just moves the orphaned-block problem: an install that may wire
    // machine-wide trust but may not remove it again.
    const certInstall = readFileSync("src/mitm/cert/install.js", "utf8");
    expect(certInstall).toContain("MACHINE_TRUST_ALLOWED");
    expect(certInstall, "teardown must not use a different flag").not.toContain("IS_DEFAULT_DATA_DIR");
  });

  it("says loudly when a non-default install does write machine-wide trust", () => {
    // The original incident was costly because nothing announced it.
    expect(manager).toContain("Writing machine-wide trust for a non-default DATA_DIR");
  });
});
