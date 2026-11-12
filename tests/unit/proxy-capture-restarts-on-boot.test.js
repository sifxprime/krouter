/**
 * Proxy capture has to come back after a restart, like the :443 transport does.
 *
 * It recorded nothing but a pid file, so nothing could restore it. The only
 * reason a long-lived proxy appeared to survive restarts is that it is spawned
 * detached and unref'd: it outlives the app and gets reparented to launchd. One
 * found running on a real machine had been up since a session months earlier,
 * with no setting anywhere saying it was meant to be. Kill it once — a reboot, a
 * crash, an unlucky pkill — and it was gone silently, while the :443 transport
 * came back because `mitmEnabled` had been recorded all along.
 *
 * These drive the real start/stop against a fake settings store, because the
 * thing that was missing is a write, and only a write proves it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempDir;
let mgr;
let settings;
const originalDataDir = process.env.DATA_DIR;
const originalProxyPort = process.env.MITM_PROXY_PORT;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-proxy-boot-"));
  process.env.DATA_DIR = tempDir;
  // A port nothing is on, so isPortAccepting() is a real negative rather than
  // picking up the proxy this machine may genuinely be running.
  process.env.MITM_PROXY_PORT = "20931";
  vi.resetModules();
  mgr = await import("@/mitm/manager");
  settings = {};
  mgr.initDbHooks(
    async () => ({ ...settings }),
    async (patch) => { Object.assign(settings, patch); }
  );
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalProxyPort === undefined) delete process.env.MITM_PROXY_PORT;
  else process.env.MITM_PROXY_PORT = originalProxyPort;
});

describe("proxy capture remembers that it was on", () => {
  it("records nothing when the start fails", async () => {
    // A proxy that could not start is not a state to restore on the next boot.
    // The path does not exist, so the spawn cannot come up.
    process.env.MITM_PROXY_PATH = path.join(tempDir, "does-not-exist.js");
    await expect(mgr.startProxyCapture("k")).rejects.toThrow();
    expect(settings.proxyCaptureEnabled, "a failed start must not be remembered").toBeUndefined();
    delete process.env.MITM_PROXY_PATH;
  });

  it("records the intent when it is turned off", async () => {
    // Nothing is listening on the test port, so this is the "already stopped"
    // path — and turning it off still has to be written down, or the next boot
    // helpfully starts something the user switched off.
    await mgr.stopProxyCapture();
    expect(settings.proxyCaptureEnabled).toBe(false);
  });

  it("reports not running on a port nothing is on", async () => {
    const status = await mgr.getProxyCaptureStatus();
    expect(status.running).toBe(false);
    expect(status.port).toBe(20931);
    expect(status.proxyUrl).toBe("http://127.0.0.1:20931");
  });
});

describe("the boot path", () => {
  const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("starts proxy capture from the bootstrap, beside the MITM one", () => {
    const init = read("src/shared/services/initializeApp.js");
    expect(init, "the bootstrap must call it").toMatch(/autoStartProxyCapture\(\);/);
    expect(init).toMatch(/async function autoStartProxyCapture\(/);

    // Independent of the privileged transport: proxy capture needs no password
    // and touches no system state, so it must not sit behind mitmEnabled.
    const body = init.slice(
      init.indexOf("async function autoStartProxyCapture("),
      init.indexOf("async function autoStartMitm(")
    );
    expect(body, "proxy capture must not be gated on mitmEnabled").not.toContain("mitmEnabled");
    expect(body, "it reads its own setting").toContain("proxyCaptureEnabled");
    expect(body, "and must not ask for a sudo password").not.toContain("loadEncryptedPassword");
  });

  it("adopts a proxy that predates the setting", () => {
    // Upgrade path. Someone running proxy capture today has no
    // proxyCaptureEnabled in settings; if that read as "off" their capture
    // would quietly stop coming back after this very change.
    const init = read("src/shared/services/initializeApp.js");
    const body = init.slice(
      init.indexOf("async function autoStartProxyCapture("),
      init.indexOf("async function autoStartMitm(")
    );
    expect(body).toContain("settings.proxyCaptureEnabled === undefined");
    expect(body, "an already-running proxy is proof the user enabled it").toMatch(/if \(!status\.running\) return;/);
  });
});

describe("a real start is remembered", () => {
  it("spawns, records true, then records false on stop", async () => {
    // The assertion the whole change exists for, driven through a real spawn
    // rather than a source grep. Uses the actual proxy entrypoint on a port
    // nothing else is on.
    process.env.MITM_PROXY_PATH = path.join(process.cwd(), "src/mitm/proxy.js");
    process.env.MITM_ROUTER_BASE = "http://127.0.0.1:20932"; // never contacted here
    try {
      const started = await mgr.startProxyCapture("test-key");
      expect(started.running, "the proxy must actually be accepting").toBe(true);
      expect(started.port).toBe(20931);
      expect(settings.proxyCaptureEnabled, "a successful start must be remembered").toBe(true);

      // Pressing an already-on toggle keeps it recorded rather than clearing it.
      settings.proxyCaptureEnabled = undefined;
      const again = await mgr.startProxyCapture("test-key");
      expect(again.alreadyRunning).toBe(true);
      expect(settings.proxyCaptureEnabled).toBe(true);
    } finally {
      const stopped = await mgr.stopProxyCapture();
      expect(stopped.running, "the test must not leak a proxy").toBe(false);
      expect(settings.proxyCaptureEnabled).toBe(false);
      delete process.env.MITM_PROXY_PATH;
      delete process.env.MITM_ROUTER_BASE;
    }
  }, 30000);
});
