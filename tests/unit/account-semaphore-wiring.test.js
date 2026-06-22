// Integration tests for the chatCore semaphore wiring (0.5.28).
// Verifies the semaphore actually gates parallel acquires through the same
// helper that chatCore uses. We don't import chatCore directly (it has
// heavy DB / proxy dependencies) — we test the gating contract.
import { describe, expect, it, beforeEach } from "vitest";
import {
  acquire,
  buildAccountSemaphoreKey,
  getSemaphoreStats,
  clearAllSemaphores,
} from "../../open-sse/services/accountSemaphore.js";

describe("accountSemaphore wiring contract", () => {
  beforeEach(() => clearAllSemaphores());

  it("buildAccountSemaphoreKey produces the same key chatCore uses", () => {
    // chatCore.js does: buildAccountSemaphoreKey(provider, connectionId || "noauth")
    const k1 = buildAccountSemaphoreKey("antigravity", "abc-123");
    const k2 = buildAccountSemaphoreKey("antigravity", "noauth");
    expect(k1).toBe("antigravity:abc-123");
    expect(k2).toBe("antigravity:noauth");
  });

  it("gates 3 parallel acquires at maxConcurrency=2 — 2 immediate, 1 queued", async () => {
    const key = buildAccountSemaphoreKey("antigravity", "test-1");
    const opts = { maxConcurrency: 2, timeoutMs: 5000 };
    const r1 = await acquire(key, opts);
    const r2 = await acquire(key, opts);
    const r3Promise = acquire(key, opts);
    await new Promise(r => setTimeout(r, 20));
    expect(getSemaphoreStats(key)).toMatchObject({ running: 2, queued: 1 });
    r1();
    await r3Promise; // should now resolve
    expect(getSemaphoreStats(key).running).toBeGreaterThan(0);
    r2();
    const final = getSemaphoreStats(key);
    if (final) (await r3Promise)();
  });

  it("bypasses gating for unlisted providers (maxConcurrency=0)", async () => {
    const key = buildAccountSemaphoreKey("openai", "test-2");
    const r1 = await acquire(key, { maxConcurrency: 0 });
    const r2 = await acquire(key, { maxConcurrency: 0 });
    const r3 = await acquire(key, { maxConcurrency: 0 });
    // No gate created; releases are no-ops
    expect(getSemaphoreStats(key)).toBeNull();
    r1(); r2(); r3();
  });
});
