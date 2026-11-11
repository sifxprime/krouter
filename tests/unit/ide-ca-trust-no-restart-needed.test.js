/**
 * Turning MITM on must be enough: no IDE restart, no manual certificate step.
 *
 * The three tools we intercept use three different trust mechanisms, which is why
 * "the CA is installed" was never sufficient:
 *   Kiro           - OS trust store. Works already.
 *   Claude Desktop - Electron/Node, reads Node's own CA list -> NODE_EXTRA_CA_CERTS.
 *   Antigravity    - Go language server, reads neither -> antigravity.caCertificates.
 *
 * Observed on a real install: with DNS redirecting daily-cloudcode-pa.googleapis.com
 * to kRouter and the CA in the macOS keychain, Antigravity still failed sign-in with
 *   x509: certificate signed by unknown authority
 * because nothing had ever written antigravity.caCertificates.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { configureIdeCaTrust, removeIdeCaTrust } = await import("../../src/mitm/ideCaTrust.js");

let tmpHome, savedHome, certPath;
const userDir = () =>
  process.platform === "darwin"
    ? path.join(tmpHome, "Library", "Application Support", "Antigravity IDE", "User")
    : process.platform === "win32"
      ? path.join(tmpHome, "AppData", "Roaming", "Antigravity IDE", "User")
      : path.join(tmpHome, ".config", "Antigravity IDE", "User");
const settingsFile = () => path.join(userDir(), "settings.json");
const read = () => JSON.parse(fs.readFileSync(settingsFile(), "utf-8"));
const seed = (obj) => {
  fs.mkdirSync(userDir(), { recursive: true });
  fs.writeFileSync(settingsFile(), typeof obj === "string" ? obj : JSON.stringify(obj, null, 4));
};

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-ide-ca-"));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.APPDATA = path.join(tmpHome, "AppData", "Roaming");
  certPath = path.join(tmpHome, "rootCA.crt");
  fs.writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n");
});
afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("the test runs against a temp HOME", () => {
  it("does not use the real home directory", () => {
    expect(os.homedir()).toBe(tmpHome);
  });
});

describe("Antigravity is pointed at the kRouter CA", () => {
  it("writes the setting the Go client reads", () => {
    seed({ "workbench.colorTheme": "Default Light Modern" });
    const res = configureIdeCaTrust(certPath);
    expect(res.written.some((w) => w.includes("antigravity.caCertificates"))).toBe(true);
    expect(read()["antigravity.caCertificates"]).toEqual([certPath]);
  });

  it("keeps the user's other settings", () => {
    seed({ "workbench.colorTheme": "Default Light Modern", "explorer.confirmDelete": false });
    configureIdeCaTrust(certPath);
    const after = read();
    expect(after["workbench.colorTheme"]).toBe("Default Light Modern");
    expect(after["explorer.confirmDelete"]).toBe(false);
  });

  it("is idempotent - a second call rewrites nothing", () => {
    seed({});
    configureIdeCaTrust(certPath);
    const res = configureIdeCaTrust(certPath);
    expect(res.written).toEqual([]);
    expect(res.skipped.length).toBeGreaterThan(0);
  });

  it("replaces a stale path from an earlier install", () => {
    seed({ "antigravity.caCertificates": ["/old/gone/rootCA.crt"] });
    configureIdeCaTrust(certPath);
    expect(read()["antigravity.caCertificates"]).toEqual([certPath]);
  });
});

describe("it never damages a settings file", () => {
  it("leaves an unparseable settings.json alone", () => {
    seed("{ this is not json");
    const res = configureIdeCaTrust(certPath);
    expect(res.failed.length).toBeGreaterThan(0);
    expect(fs.readFileSync(settingsFile(), "utf-8")).toBe("{ this is not json");
  });

  it("handles a settings.json with comments and a trailing comma", () => {
    seed('{\n  // my theme\n  "workbench.colorTheme": "Dark",\n}');
    configureIdeCaTrust(certPath);
    const after = read();
    expect(after["antigravity.caCertificates"]).toEqual([certPath]);
    expect(after["workbench.colorTheme"]).toBe("Dark");
  });

  it("does nothing for an IDE that is not installed", () => {
    const res = configureIdeCaTrust(certPath);
    expect(res.written).toEqual([]);
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  it("does nothing when the cert does not exist", () => {
    seed({});
    const res = configureIdeCaTrust(path.join(tmpHome, "missing.crt"));
    expect(res.written).toEqual([]);
    expect(read()["antigravity.caCertificates"]).toBeUndefined();
  });
});

describe("removal happens on CA uninstall, not on MITM stop", () => {
  it("removes only our setting", () => {
    seed({ "workbench.colorTheme": "Dark" });
    configureIdeCaTrust(certPath);
    const res = removeIdeCaTrust();
    expect(res.removed.length).toBeGreaterThan(0);
    const after = read();
    expect(after["antigravity.caCertificates"]).toBeUndefined();
    expect(after["workbench.colorTheme"]).toBe("Dark");
  });

  it("is safe to call when nothing was written", () => {
    expect(() => removeIdeCaTrust()).not.toThrow();
  });
});
