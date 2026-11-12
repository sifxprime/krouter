// Go CLIs read SSL_CERT_FILE, and it REPLACES the system trust store instead of
// adding to it. That asymmetry with NODE_EXTRA_CA_CERTS is why Antigravity's
// `agy` rejected the kRouter MITM cert on a machine whose shell exported a
// Python certifi bundle -- and why this codebase recorded "agy pins its CA" as
// a fact for months.
//
// The dangerous failure mode is not "the block is missing". It is writing a
// bundle that does NOT contain the system roots, which would make every Go tool
// on the machine distrust the rest of the internet. These tests pin that.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const go = require("../../src/mitm/goCaCerts.js");

const CA_PEM = `-----BEGIN CERTIFICATE-----\nMIIBkRouterFakeRootCA\n-----END CERTIFICATE-----\n`;
const ROOTS_PEM = Array.from({ length: 40 }, (_, i) =>
  `-----BEGIN CERTIFICATE-----\nMIIBfakeSystemRoot${i}\n-----END CERTIFICATE-----`).join("\n") + "\n";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-goca-")); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

describe("buildGoCaBundle", () => {
  it("writes system roots PLUS the kRouter CA, never the CA alone", () => {
    const caPath = path.join(dir, "rootCA.crt");
    fs.writeFileSync(caPath, CA_PEM);
    const rootsFile = path.join(dir, "fake-system-roots.pem");
    fs.writeFileSync(rootsFile, ROOTS_PEM);

    // The platform store is injected, so this asserts the merge rather than
    // whatever happens to be in the keychain of the machine running the suite.
    const res = go.buildGoCaBundle(caPath, dir, () => ROOTS_PEM);
    expect(res.ok, res.reason).toBe(true);
    const written = fs.readFileSync(res.bundlePath, "utf-8");
    const count = (written.match(/BEGIN CERTIFICATE/g) || []).length;
    expect(count, "bundle must carry the system roots too").toBe(41);
    expect(written).toContain("RouterFakeRootCA");
  });

  it("refuses to write a bundle without the system roots", () => {
    // This is the one that matters: pointing SSL_CERT_FILE at the kRouter CA
    // alone would make every Go tool on the machine distrust everything else.
    const caPath = path.join(dir, "rootCA.crt");
    fs.writeFileSync(caPath, CA_PEM);
    const res = go.buildGoCaBundle(caPath, dir, () => null);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("system-roots-unreadable");
    expect(fs.existsSync(path.join(dir, "ssl-cert-file.pem"))).toBe(false);
  });

  it("refuses a suspiciously small root store", () => {
    const caPath = path.join(dir, "rootCA.crt");
    fs.writeFileSync(caPath, CA_PEM);
    const res = go.buildGoCaBundle(caPath, dir, () => CA_PEM);  // 1 cert: wrong file
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/^implausible-bundle-/);
  });

  it("refuses when the root CA file is missing", () => {
    const res = go.buildGoCaBundle(path.join(dir, "nope.crt"), dir);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no-root-ca");
  });

  it("refuses when the CA file is not PEM", () => {
    const caPath = path.join(dir, "rootCA.crt");
    fs.writeFileSync(caPath, "this is not a certificate");
    const res = go.buildGoCaBundle(caPath, dir);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("root-ca-not-pem");
  });
});

describe("the shell block", () => {
  const bundle = "/home/u/.krouter/mitm/ssl-cert-file.pem";
  const ca = "/home/u/.krouter/mitm/rootCA.crt";

  it("merges an existing SSL_CERT_FILE instead of replacing it", () => {
    const block = go.buildShellBlock(bundle, ca);
    // The whole point: if the user already had one, keep their roots and add ours.
    expect(block).toContain('cat "${SSL_CERT_FILE}"');
    expect(block).toContain("ssl-cert-file.merged.pem");
  });

  it("points at the prebuilt bundle when nothing else set the variable", () => {
    expect(go.buildShellBlock(bundle, ca)).toContain(`export SSL_CERT_FILE="${bundle}"`);
  });

  it("does nothing when the CA file is gone", () => {
    // Guarding on the CA means an uninstalled kRouter cannot pin a stale store.
    expect(go.buildShellBlock(bundle, ca)).toContain(`if [ -r "${ca}" ]`);
  });

  it("round-trips: stripBlock removes exactly what buildShellBlock added", () => {
    const before = "export PATH=/usr/bin\n# user's own line\n";
    const block = go.buildShellBlock(bundle, ca);
    const withBlock = `${before}\n${block}\n`;
    const { contents, changed } = go.stripBlock(withBlock);
    expect(changed).toBe(true);
    expect(contents).toContain("# user's own line");
    expect(contents).not.toContain("SSL_CERT_FILE");
  });
});

describe("platform scope", () => {
  it("skips Windows, where Go uses the cert store certutil already fills", () => {
    const real = process.platform;
    try {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      const res = go.setGoSslCertFile("/any/rootCA.crt", dir);
      expect(res.written).toEqual([]);
      expect(res.skipped).toBe("windows-uses-cert-store");
    } finally {
      Object.defineProperty(process, "platform", { value: real, configurable: true });
    }
  });
});
