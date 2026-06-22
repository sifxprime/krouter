// Regression test for 0.5.24 — when Google returns 429 WITHOUT retry-after info,
// the executor must do at most 1 quick retry (1s wait) instead of 3 exponential
// retries (2s + 4s + 8s = 14s). The old behavior wasted 22 seconds per
// quota-locked account hit; the new behavior wastes ~1 second.
import { describe, expect, it, vi, beforeEach } from "vitest";

const proxyFetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => proxyFetchMock(...args),
}));

const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");

function plain429() {
  // 429 with NO retry-after header AND NO body retryDelay info.
  // This is the "transient-looking but actually quota-locked" pattern that
  // was burning 22s on the old 3-retry exponential backoff.
  return new Response(JSON.stringify({
    error: { code: 429, message: "Rate limit exceeded" }
  }), { status: 429, headers: { "Content-Type": "application/json" } });
}

describe("AntigravityExecutor fast-fail retry (0.5.24)", () => {
  beforeEach(() => {
    proxyFetchMock.mockReset();
  });

  it("does at most 1 retry on 429 with no retry-after info per URL", async () => {
    proxyFetchMock.mockResolvedValue(plain429());
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const executor = new AntigravityExecutor();
    const start = Date.now();
    await executor.execute({
      model: "gemini-pro-agent",
      body: { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } },
      stream: false,
      credentials: {
        connectionId: "test", email: "test@example.com",
        accessToken: "fake", projectId: "p"
      },
      signal: undefined,
      log: { debug: () => {} },
    });
    const elapsed = Date.now() - start;

    // Per URL: 1 original attempt + 1 retry = 2 fetch calls.
    // For N fallback URLs, this is at most 2*N fetch calls.
    // The old behavior was 4*N (1 original + 3 retries per URL).
    const fallbackCount = executor.getFallbackCount();
    expect(proxyFetchMock.mock.calls.length).toBeLessThanOrEqual(2 * fallbackCount);

    // Critical: no exponential backoff delays (2000/4000/8000 ms).
    const exponentialDelays = setTimeoutSpy.mock.calls
      .map(call => call[1])
      .filter(ms => ms === 2000 || ms === 4000 || ms === 8000);
    expect(exponentialDelays).toHaveLength(0);

    // Critical: total elapsed time per URL should be ~1s (not 14s).
    // Across N URLs, max is ~1s * N + small overhead.
    expect(elapsed).toBeLessThan(1500 * fallbackCount + 2000);
  }, 30000);

  it("uses exactly 1 second wait on the single retry", async () => {
    proxyFetchMock.mockResolvedValue(plain429());
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const executor = new AntigravityExecutor();
    await executor.execute({
      model: "gemini-pro-agent",
      body: { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } },
      stream: false,
      credentials: { connectionId: "t", email: "t@e.com", accessToken: "f", projectId: "p" },
      signal: undefined,
      log: { debug: () => {} },
    });

    // We should see at least one 1000ms wait (the auto-retry delay).
    const oneSecondDelays = setTimeoutSpy.mock.calls
      .map(call => call[1])
      .filter(ms => ms === 1000);
    expect(oneSecondDelays.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});
