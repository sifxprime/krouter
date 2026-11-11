/**
 * 0.5.175 — Proxy capture mode lifecycle, and three bugs it shipped with first.
 *
 * All three were found by running the real thing, and all three produced a
 * STATUS THAT LIED, which is the failure that matters here: 0.5.171 deleted
 * working DNS redirects because getMitmStatus() could not see a live MITM, and
 * 0.5.173 had to add a liveness probe to undo it. A capture mode whose status
 * disagrees with reality is worse than one that reports nothing.
 *
 *   1. Status trusted the child-process handle. A child that spawns and then
 *      fails to bind leaves a live, unkilled handle, so `running` was true with
 *      nothing listening. The PORT has to decide.
 *
 *   2. The readiness loop had no delay. A refused connect returns instantly, so
 *      all 40 attempts finished in microseconds and start() returned before the
 *      proxy had bound. Measured: "after start: running true, pid 11347",
 *      followed immediately by ECONNREFUSED on that port.
 *
 *   3. Stop checked the port immediately after kill(). Signals are asynchronous,
 *      so a process that was about to exit was reported as still running.
 *      Measured: "after stop: running true".
 *
 * A fourth was found the same way and is pinned in the proxy test rather than
 * here: the child was spawned with piped stdio, so once the parent exited the
 * read end closed and the child's next log write hit a dead pipe -- a proxy
 * still accepting connections and answering nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";

let tmpDir, savedDataDir, savedPort, manager, port;

/** An ephemeral port that is free right now. */
async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-proxylife-"));
  fs.mkdirSync(path.join(tmpDir, "mitm"), { recursive: true });
  savedDataDir = process.env.DATA_DIR;
  savedPort = process.env.MITM_PROXY_PORT;
  process.env.DATA_DIR = tmpDir; // read at paths.js load, so set before import

  port = await freePort();
  process.env.MITM_PROXY_PORT = String(port);

  const { generateCert } = await import("../../src/mitm/cert/generate.js");
  await generateCert();
  manager = await import("../../src/mitm/manager.js");
}, 30000);

afterAll(async () => {
  try { await manager?.stopProxyCapture(); } catch { /* ignore */ }
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  if (savedPort === undefined) delete process.env.MITM_PROXY_PORT;
  else process.env.MITM_PROXY_PORT = savedPort;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("status is decided by the port, not by a process handle", () => {
  it("reports not running when nothing is listening", async () => {
    const s = await manager.getProxyCaptureStatus();
    expect(s.running).toBe(false);
    expect(s.pid).toBeNull();
    // The caller needs the address to hand the user; nothing can set it for an
    // app that is already running.
    expect(s.proxyUrl).toBe(`http://127.0.0.1:${port}`);
  });

  it("credits a listener it did not spawn, so a proxy outliving the app counts", async () => {
    const squatter = net.createServer();
    await new Promise((r) => squatter.listen(port, "127.0.0.1", r));
    try {
      expect((await manager.getProxyCaptureStatus()).running).toBe(true);
    } finally {
      await new Promise((r) => squatter.close(r));
    }
  });
});

describe("start and stop", () => {
  it("start resolves only once the port actually accepts", async () => {
    const started = await manager.startProxyCapture("");
    expect(started.running).toBe(true);
    expect(started.port).toBe(port);
    expect(started.pid).toBeGreaterThan(0);

    // Bug 2: start used to return before the proxy had bound, so a connect
    // right here was refused.
    await new Promise((resolve, reject) => {
      const c = net.connect(port, "127.0.0.1", () => { c.destroy(); resolve(); });
      c.on("error", reject);
    });
  }, 30000);

  it("needs no elevation: an ordinary port, and no privileged state touched", async () => {
    expect(port).not.toBe(443);
    // The DNS transport's entire cost is this file; the proxy must not touch it.
    const hosts = fs.existsSync("/etc/hosts") ? fs.statSync("/etc/hosts").mtimeMs : null;
    const s = await manager.getProxyCaptureStatus();
    expect(s.running).toBe(true);
    if (hosts !== null) expect(fs.statSync("/etc/hosts").mtimeMs).toBe(hosts);
  });

  it("start is idempotent rather than spawning a second listener", async () => {
    const again = await manager.startProxyCapture("");
    expect(again.running).toBe(true);
    expect(again.alreadyRunning).toBe(true);
  }, 20000);

  it("stop waits for the port to close before reporting", async () => {
    const stopped = await manager.stopProxyCapture();
    // Bug 3: this used to come back `running: true` because kill() is async.
    expect(stopped.running).toBe(false);
    expect(stopped.pid).toBeNull();

    await expect(new Promise((resolve, reject) => {
      const c = net.connect(port, "127.0.0.1", () => { c.destroy(); resolve(); });
      c.on("error", reject);
    })).rejects.toThrow();
  }, 30000);

  it("leaves nothing behind -- no system state to heal, unlike the DNS mode", async () => {
    expect(fs.existsSync(path.join(tmpDir, "mitm", ".proxy.pid"))).toBe(false);
  });
});

describe("tools declare which capture modes they support", () => {
  it("claude supports proxy; antigravity does not and says so", async () => {
    const src = fs.readFileSync(
      path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..",
        "src", "shared", "constants", "cliTools.js"), "utf-8");
    const seg = src.slice(src.indexOf("export const MITM_TOOLS"));
    const modes = {};
    for (const m of seg.matchAll(/^ {2}([a-z]+): \{[\s\S]*?captureModes: \[([^\]]*)\]/gm)) {
      modes[m[1]] = m[2];
    }
    expect(modes.claude).toContain('"proxy"');
    // agy reads no proxy variable, so it would never even send the CONNECT.
    expect(modes.antigravity).not.toContain('"proxy"');
    expect(modes.antigravity).toContain('"dns"');
  });
});
