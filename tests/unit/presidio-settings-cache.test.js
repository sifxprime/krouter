import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createRedactionMiddleware,
  invalidateRedactionSettingsCache,
} from "@/middleware/redaction/middleware.js";

/**
 * PR #1 review: the middleware called getSettings() on every request. That is an
 * uncached SQLite read sitting in front of all six LLM routes -- putting the
 * database back on the hot path the in-memory HealthCache exists to keep it off.
 *
 * It also returned 500 whenever that read threw, including for users who never
 * enabled Presidio: breaking their traffic to protect data they never asked us
 * to protect. Fail-closed now applies only once redaction has actually been on.
 */

const { getSettings } = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({ getSettings }));

const req = () =>
  new Request("http://localhost:20128/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  });

const pass = async (r) => new Response(JSON.stringify({ ok: true }), { status: 200 });

describe("redaction settings caching", () => {
  beforeEach(() => {
    invalidateRedactionSettingsCache();
    getSettings.mockReset();
    vi.unstubAllGlobals();
  });

  it("does not hit the settings store on every request", async () => {
    getSettings.mockResolvedValue({ presidioEnabled: false, presidioPiiRedaction: false });
    const mw = createRedactionMiddleware();

    for (let i = 0; i < 5; i++) await mw(req(), pass);

    // Five requests, one read -- the rest served from the cached decision.
    expect(getSettings).toHaveBeenCalledTimes(1);
  });

  it("passes through when the toggles are off", async () => {
    getSettings.mockResolvedValue({ presidioEnabled: false, presidioPiiRedaction: false });
    const mw = createRedactionMiddleware();
    const res = await mw(req(), pass);
    expect(res.status).toBe(200);
  });

  it("does NOT 500 a user who never enabled redaction when the settings read fails", async () => {
    getSettings.mockRejectedValue(new Error("database is locked"));
    const mw = createRedactionMiddleware();

    const res = await mw(req(), pass);

    // Previously this returned 500 for everyone. It must not.
    expect(res.status).toBe(200);
  });

  it("still fails closed once redaction has actually been enabled", async () => {
    // First read succeeds with redaction ON, so the cache learns it is on.
    getSettings.mockResolvedValueOnce({ presidioEnabled: true, presidioPiiRedaction: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ redacted_texts: ["hi"] }),
    }));
    const mw = createRedactionMiddleware();
    expect((await mw(req(), pass)).status).toBe(200);

    // Now the store breaks. A user who IS relying on redaction must be protected.
    invalidateRedactionSettingsCache();
    // Re-prime the "was on" state, then fail the next read.
    getSettings.mockResolvedValueOnce({ presidioEnabled: true, presidioPiiRedaction: true });
    await mw(req(), pass);
    getSettings.mockRejectedValue(new Error("database is locked"));
    await new Promise((r) => setTimeout(r, 0));

    // Force the TTL to have elapsed by invalidating only the timestamp path:
    // a fresh read is attempted and throws while _redactionOn === true.
    const res = await (async () => {
      // advance past the TTL
      vi.useFakeTimers();
      vi.advanceTimersByTime(11_000);
      const out = await mw(req(), pass);
      vi.useRealTimers();
      return out;
    })();

    expect(res.status).toBe(500);
  });
});
