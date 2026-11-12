// "Hide to Tray" promised the terminal was safe to close and it was not.
//
// macOS kept the foreground process alive, so closing the terminal killed the
// server. Windows/Linux spawned the background child BEFORE releasing the port,
// so the child raced its own parent and landed in the EADDRINUSE restart loop.
//
// Both paths now stop first, wait for the port to actually free, start the
// background owner, and refuse to claim success until it answers. These tests
// pin that order, because getting it wrong looks fine locally -- the parent
// usually exits fast enough for the child's restart loop to recover.
import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import net from "node:net";

const require = createRequire(import.meta.url);
const { handOffToDetachedChild, portIsFree, waitFor } = require("../../cli/src/cli/tray/handoff.js");

function listenOn(port) {
  return new Promise((resolve) => {
    const srv = net.createServer(() => {});
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

describe("tray handoff ordering", () => {
  it("stops the foreground server before spawning the background one", async () => {
    const order = [];
    const port = await freePort();

    const result = await handOffToDetachedChild({
      port,
      cliPath: "/nonexistent/cli.js",
      spawn: () => { order.push("spawn"); return { pid: 4242, unref() {} }; },
      stopCurrent: async () => { order.push("stop"); },
      isKrouterOnPort: () => true,
    });

    expect(result.ok).toBe(true);
    expect(order, "the port must be free before the child starts binding").toEqual(["stop", "spawn"]);
  });

  it("refuses to report success when the background process never serves", async () => {
    const port = await freePort();
    const result = await handOffToDetachedChild({
      port,
      cliPath: "/nonexistent/cli.js",
      spawn: () => ({ pid: 1, unref() {} }),
      stopCurrent: async () => {},
      isKrouterOnPort: () => false,   // never comes up
      serveBudget: { tries: 3, delayMs: 10 },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("background-process-did-not-serve");
  });

  it("aborts rather than spawning when the port cannot be freed", async () => {
    const port = await freePort();
    const srv = await listenOn(port);      // something keeps holding it
    let spawned = false;
    try {
      const result = await handOffToDetachedChild({
        port,
        cliPath: "/nonexistent/cli.js",
        spawn: () => { spawned = true; return { pid: 1, unref() {} }; },
        stopCurrent: async () => {},       // pretends to stop, does not
        isKrouterOnPort: () => true,
        freeBudget: { tries: 3, delayMs: 10 },
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("port-still-held");
      expect(spawned, "must not spawn a child that is guaranteed to lose the port").toBe(false);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it("portIsFree reports honestly in both directions", async () => {
    const port = await freePort();
    expect(await portIsFree(port)).toBe(true);
    const srv = await listenOn(port);
    try {
      expect(await portIsFree(port)).toBe(false);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it("waitFor actually delays between attempts", async () => {
    // A poll loop with no delay burns every attempt before a service can start;
    // that bug shipped once already in proxy-capture mode.
    let calls = 0;
    const started = Date.now();
    const ok = await waitFor(() => { calls += 1; return Promise.resolve(false); }, { tries: 4, delayMs: 50 });
    expect(ok).toBe(false);
    expect(calls).toBe(4);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });
});
