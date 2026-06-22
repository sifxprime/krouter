// Tests for accountSemaphore (0.5.28).
import { describe, expect, it, beforeEach } from "vitest";
import {
  acquire,
  markBlocked,
  buildAccountSemaphoreKey,
  getSemaphoreStats,
  clearAllSemaphores,
} from "../../open-sse/services/accountSemaphore.js";

describe("accountSemaphore", () => {
  beforeEach(() => clearAllSemaphores());

  it("buildAccountSemaphoreKey produces stable colon-joined key", () => {
    expect(buildAccountSemaphoreKey("antigravity", "abc")).toBe("antigravity:abc");
  });

  it("bypasses (returns immediately) when maxConcurrency is null or 0", async () => {
    const release1 = await acquire("k1", { maxConcurrency: 0 });
    const release2 = await acquire("k1", { maxConcurrency: null });
    expect(typeof release1).toBe("function");
    expect(typeof release2).toBe("function");
    release1();
    release2();
  });

  it("allows up to maxConcurrency parallel holders", async () => {
    const r1 = await acquire("kA", { maxConcurrency: 2 });
    const r2 = await acquire("kA", { maxConcurrency: 2 });
    const stats = getSemaphoreStats("kA");
    expect(stats.running).toBe(2);
    r1();
    r2();
  });

  it("queues additional acquires until a slot opens", async () => {
    const r1 = await acquire("kB", { maxConcurrency: 1 });
    const promiseR2 = acquire("kB", { maxConcurrency: 1, timeoutMs: 5000 });
    // r2 not yet resolved
    let r2Resolved = false;
    promiseR2.then(() => { r2Resolved = true; });
    await new Promise(r => setTimeout(r, 20));
    expect(r2Resolved).toBe(false);
    expect(getSemaphoreStats("kB").queued).toBe(1);

    r1(); // releasing should drain the queue
    const r2 = await promiseR2;
    expect(typeof r2).toBe("function");
    r2();
  });

  it("times out queued acquires after timeoutMs", async () => {
    const r1 = await acquire("kC", { maxConcurrency: 1 });
    await expect(acquire("kC", { maxConcurrency: 1, timeoutMs: 50 }))
      .rejects.toThrow(/Semaphore timeout/);
    r1();
  });

  it("rejects when queue reaches maxQueueSize", async () => {
    const r1 = await acquire("kD", { maxConcurrency: 1 });
    const r2 = acquire("kD", { maxConcurrency: 1, timeoutMs: 5000, maxQueueSize: 1 });
    await expect(acquire("kD", { maxConcurrency: 1, timeoutMs: 5000, maxQueueSize: 1 }))
      .rejects.toThrow(/queue full/);
    r1();
    (await r2)();
  });

  it("release is idempotent — safe to call multiple times", async () => {
    const r1 = await acquire("kE", { maxConcurrency: 1 });
    r1();
    r1();
    r1();
    // Calling release after fully released should not throw
    const r2 = await acquire("kE", { maxConcurrency: 1 });
    expect(typeof r2).toBe("function");
    r2();
  });

  it("markBlocked prevents new acquires until cooldown passes", async () => {
    markBlocked("kF", 100); // block for 100ms
    await expect(acquire("kF", { maxConcurrency: 1, timeoutMs: 50 }))
      .rejects.toThrow(/Semaphore timeout/);
    // After cooldown, acquire should succeed
    await new Promise(r => setTimeout(r, 120));
    const r = await acquire("kF", { maxConcurrency: 1, timeoutMs: 100 });
    expect(typeof r).toBe("function");
    r();
  });
});
