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
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const manager = readFileSync("src/mitm/manager.js", "utf8");

// Evaluate paths.js in a child so DATA_DIR can be varied; it is read at module load.
const isDefaultWith = (dataDir) => {
  const env = { ...process.env };
  if (dataDir === undefined) delete env.DATA_DIR;
  else env.DATA_DIR = dataDir;
  const out = execFileSync(
    process.execPath,
    ["-e", 'process.stdout.write(String(require("./src/mitm/paths.js").IS_DEFAULT_DATA_DIR))'],
    { env, encoding: "utf8" },
  );
  return out.trim() === "true";
};

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

describe("both machine-wide writes are behind the gate", () => {
  it("the per-IDE settings write is gated", () => {
    const i = manager.indexOf("configureIdeCaTrust(");
    expect(i).toBeGreaterThan(-1);
    // The nearest preceding guard must be the DATA_DIR check.
    expect(manager.slice(0, i)).toMatch(/if \(!IS_DEFAULT_DATA_DIR\)[\s\S]*$/);
  });

  it("the NODE_EXTRA_CA_CERTS write is gated on every platform", () => {
    // macOS, Windows and Linux share one if/else chain; gating its head covers all three.
    const chain = manager.slice(manager.indexOf("NODE_EXTRA_CA_CERTS is left alone"));
    expect(chain).toContain("launchctl setenv NODE_EXTRA_CA_CERTS");
    expect(chain).toContain("setx NODE_EXTRA_CA_CERTS");
    expect(chain).toContain("setLinuxNodeExtraCaCerts(");
    // and nothing sets it before that gate
    const before = manager.slice(0, manager.indexOf("NODE_EXTRA_CA_CERTS is left alone"));
    expect(before).not.toContain("launchctl setenv NODE_EXTRA_CA_CERTS");
  });

  it("says why it skipped, so a dev instance is not silently different", () => {
    expect(manager).toContain("[ide-ca] Skipped");
    expect(manager).toContain("[node-ca] Skipped");
  });
});
