/**
 * OpenRouter's free-model DAILY cap must park the model until the UTC-day reset,
 * not be treated as a per-minute (TPM) limit.
 *
 * Shapes (checked 2026-10-07):
 *   - https://openrouter.ai/docs/api/reference/limits : free (":free") variants
 *     allow 20 req/min and 50 req/day (1000/day after 10 credits), counted per
 *     account per "current UTC day"; a platform-limit 429 carries X-RateLimit-Limit,
 *     -Remaining and -Reset headers.
 *   - Real 429 bodies captured in public logs: message "Rate limit exceeded:
 *     free-models-per-day. Add 10 credits to unlock 1000 free model requests per
 *     day", metadata.limit_source "openrouter_free_tier_daily", and
 *     metadata.headers["X-RateLimit-Reset"] as epoch MILLISECONDS at 00:00 UTC.
 *     The per-minute cap says "free-models-per-min" / "openrouter_free_tier_per_minute".
 *
 * Before 0.5.164 the daily cap hit the TPM downgrade (OpenRouter has no quota
 * fetcher, so the "daily quota healthy" check fails open): the model was locked
 * ~90 s, re-tried every 90 s until midnight, and lastError claimed "daily quota
 * healthy".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// In-memory stand-in for the SQLite connection row, so markAccountUnavailable
// runs its real lock computation without touching disk.
const db = vi.hoisted(() => ({ rows: {} }));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  validateApiKey: vi.fn(async () => true),
  updateProviderConnection: vi.fn(async () => null),
  getSettings: vi.fn(async () => ({})),
  updateProviderConnectionAtomic: vi.fn(async (id, compute) => {
    const existing = db.rows[id] || { id };
    const patch = compute(existing);
    if (!patch) return null;
    db.rows[id] = { ...existing, ...patch };
    return db.rows[id];
  }),
}));
vi.mock("@/shared/services/healthCache.js", () => ({
  getCachedConnections: vi.fn(async () => []),
  lockAccountInMemory: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));
// OpenRouter has no usage fetcher, so the real quota cache is empty and
// isAccountAboveThreshold fails open (true) for every OpenRouter account.
vi.mock("open-sse/services/quotaPreflight.js", () => ({
  isAccountAboveThreshold: vi.fn(() => true),
  warmQuotaCache: vi.fn(),
  invalidateQuotaCache: vi.fn(),
  recordQuotaCacheHit: vi.fn(),
}));
vi.mock("@/sse/utils/logger.js", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

import { openrouterFreeDailyCapHold, markAccountUnavailable } from "../../src/sse/services/auth.js";
import { isModelLockActive } from "../../open-sse/services/accountFallback.js";
import { parseUpstreamError, formatProviderError } from "../../open-sse/utils/error.js";
import { getExecutor } from "../../open-sse/executors/index.js";

const NOW = Date.UTC(2026, 9, 7, 15, 30, 0);  // 2026-10-07 15:30 UTC
const MIDNIGHT = Date.UTC(2026, 9, 8);        // next 00:00 UTC
const FREE_MODEL = "deepseek/deepseek-r1-0528:free";
const PAID_MODEL = "openai/gpt-5.5";

const dailyBody = (reset = String(MIDNIGHT)) => JSON.stringify({
  error: {
    message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
    code: 429,
    metadata: {
      headers: { "X-RateLimit-Limit": "50", "X-RateLimit-Remaining": "0", ...(reset ? { "X-RateLimit-Reset": reset } : {}) },
      limit_source: "openrouter_free_tier_daily",
      remedy_hint: "Wait for the daily reset (see X-RateLimit-Reset), or purchase credits to raise your free-model daily limit.",
      provider_name: null,
    },
  },
  user_id: "user_test",
});
const PER_MINUTE_BODY = JSON.stringify({
  error: {
    message: "Rate limit exceeded: free-models-per-min. ",
    code: 429,
    metadata: {
      headers: { "X-RateLimit-Limit": "20", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(NOW + 30_000) },
      limit_source: "openrouter_free_tier_per_minute",
      remedy_hint: "Slow down requests to free models, or retry after the per-minute window resets.",
      provider_name: null,
    },
  },
  user_id: "user_test",
});
const UPSTREAM_BODY = JSON.stringify({
  error: {
    message: "Provider returned error",
    code: 429,
    metadata: {
      raw: `${FREE_MODEL} is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations`,
      provider_name: "Chutes",
    },
  },
});

// The exact errorText + resetsAtMs chat.js hands to markAccountUnavailable:
// chatCore runs the upstream response through parseUpstreamError(executor) +
// formatProviderError and forwards the header-derived resetsAtMs.
async function upstreamError(status, body, headers = {}) {
  const res = new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
  const parsed = await parseUpstreamError(res, getExecutor("openrouter"));
  return {
    text: formatProviderError(new Error(parsed.message), "openrouter", FREE_MODEL, parsed.statusCode),
    resetsAtMs: parsed.resetsAtMs ?? null,
  };
}

describe("openrouterFreeDailyCapHold", () => {
  it("holds the free-models-per-day 429 until the X-RateLimit-Reset it carries", async () => {
    const reset = MIDNIGHT + 5_000;
    const { text } = await upstreamError(429, dailyBody(String(reset)));
    const hold = openrouterFreeDailyCapHold(429, text, "openrouter", NOW);
    expect(hold.resetAtMs).toBe(reset);
    expect(hold.reason).toContain("free-model daily");
    expect(hold.reason).toContain("2026-10-08 00:00 UTC");
  });

  it("accepts a reset given in epoch seconds", async () => {
    const { text } = await upstreamError(429, dailyBody(String(MIDNIGHT / 1000)));
    expect(openrouterFreeDailyCapHold(429, text, "openrouter", NOW).resetAtMs).toBe(MIDNIGHT);
  });

  it("falls back to the next 00:00 UTC when the reset is missing or implausibly far", async () => {
    for (const reset of ["", String(NOW + 3 * 24 * 60 * 60 * 1000)]) {
      const { text } = await upstreamError(429, dailyBody(reset));
      expect(openrouterFreeDailyCapHold(429, text, "openrouter", NOW).resetAtMs).toBe(MIDNIGHT);
    }
  });

  it("retries in a minute, not a day, when the named reset has already passed", async () => {
    // A past reset means the UTC day already rolled over (our clock is a little ahead of OpenRouter's).
    const { text } = await upstreamError(429, dailyBody(String(NOW - 2_000)));
    expect(openrouterFreeDailyCapHold(429, text, "openrouter", NOW).resetAtMs).toBe(NOW + 60_000);
  });

  it("does not tell an account that already has credits to add credits", async () => {
    // Accounts with 10+ credits get "free-models-per-day-high-balance" and a 1000/day limit; nothing raises it.
    const high = dailyBody().replace("free-models-per-day. Add 10 credits to unlock 1000 free model requests per day", "free-models-per-day-high-balance.").replace('"X-RateLimit-Limit":"50"', '"X-RateLimit-Limit":"1000"');
    const { text } = await upstreamError(429, high);
    const hold = openrouterFreeDailyCapHold(429, text, "openrouter", NOW);
    expect(hold.resetAtMs).toBe(MIDNIGHT);
    expect(hold.reason).not.toMatch(/add credits/i);
    const low = openrouterFreeDailyCapHold(429, (await upstreamError(429, dailyBody())).text, "openrouter", NOW);
    expect(low.reason).toMatch(/10 credits/);
  });

  it("rolls the fallback reset over the month and year end", async () => {
    const { text } = await upstreamError(429, dailyBody(""));
    expect(openrouterFreeDailyCapHold(429, text, "openrouter", Date.UTC(2026, 11, 31, 23, 59)).resetAtMs).toBe(Date.UTC(2027, 0, 1));
  });

  it("leaves the per-minute cap, upstream provider 429s and other statuses alone", async () => {
    expect(openrouterFreeDailyCapHold(429, (await upstreamError(429, PER_MINUTE_BODY)).text, "openrouter", NOW)).toBeNull();
    expect(openrouterFreeDailyCapHold(429, (await upstreamError(429, UPSTREAM_BODY)).text, "openrouter", NOW)).toBeNull();
    expect(openrouterFreeDailyCapHold(400, (await upstreamError(429, dailyBody())).text, "openrouter", NOW)).toBeNull();
  });

  it("applies only to the openrouter provider", async () => {
    const { text } = await upstreamError(429, dailyBody());
    for (const p of ["openai", "anthropic", "kilocode", null]) {
      expect(openrouterFreeDailyCapHold(429, text, p, NOW)).toBeNull();
    }
  });
});

describe("markAccountUnavailable with the OpenRouter free-model daily cap", () => {
  beforeEach(() => {
    db.rows = {};
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("locks only that model on that account until the reset and falls back immediately", async () => {
    const { text, resetsAtMs } = await upstreamError(429, dailyBody());
    const outcome = await markAccountUnavailable("conn-or", 429, text, "openrouter", FREE_MODEL, resetsAtMs);

    expect(outcome.shouldFallback).toBe(true);
    expect(outcome.cooldownMs).toBe(MIDNIGHT - NOW);
    const row = db.rows["conn-or"];
    expect(row[`modelLock_${FREE_MODEL}`]).toBe(new Date(MIDNIGHT).toISOString());
    // Paid models on the same key still work.
    expect(row.modelLock___all).toBeUndefined();
    expect(isModelLockActive(row, PAID_MODEL)).toBe(false);
    expect(row.backoffLevel).toBe(0);
    expect(row.lastError).toContain("free-model daily");
    expect(row.lastError).not.toContain("daily quota healthy");
  });

  it("is not thrown off by the X-RateLimit-Reset HTTP header in milliseconds", async () => {
    // retryHeaders reads a 13-digit x-ratelimit-reset as a seconds DURATION, so the
    // header-derived resetsAtMs is absurd; the hold must still end at the real reset.
    const { text, resetsAtMs } = await upstreamError(429, dailyBody(), { "X-RateLimit-Reset": String(MIDNIGHT) });
    const outcome = await markAccountUnavailable("conn-hdr", 429, text, "openrouter", FREE_MODEL, resetsAtMs);

    expect(outcome).toMatchObject({ shouldFallback: true, cooldownMs: MIDNIGHT - NOW });
    expect(db.rows["conn-hdr"][`modelLock_${FREE_MODEL}`]).toBe(new Date(MIDNIGHT).toISOString());
  });

  it("never turns the daily cap into a whole-account hold when no model is known", async () => {
    // A model-less caller would lock modelLock___all; a day-long account lock
    // would take paid models down with it.
    const { text } = await upstreamError(429, dailyBody());
    const outcome = await markAccountUnavailable("conn-nomodel", 429, text, "openrouter", null);

    expect(outcome.cooldownMs).toBeLessThan(5 * 60 * 1000);
  });

  it("keeps the per-minute free cap on the short TPM cooldown", async () => {
    const { text } = await upstreamError(429, PER_MINUTE_BODY);
    const outcome = await markAccountUnavailable("conn-min", 429, text, "openrouter", FREE_MODEL);

    expect(outcome).toMatchObject({ shouldFallback: true, cooldownMs: 90_000 });
    expect(db.rows["conn-min"][`modelLock_${FREE_MODEL}`]).toBe(new Date(NOW + 90_000).toISOString());
  });

  it("keeps an upstream provider 429 on its current handling", async () => {
    const { text } = await upstreamError(429, UPSTREAM_BODY);
    const outcome = await markAccountUnavailable("conn-up", 429, text, "openrouter", FREE_MODEL);

    expect(outcome).toMatchObject({ shouldFallback: true, cooldownMs: 90_000 });
    expect(db.rows["conn-up"].modelLock___all).toBeUndefined();
  });
});
