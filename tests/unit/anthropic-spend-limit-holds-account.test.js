/**
 * Anthropic spend limits must take the account out of rotation until access
 * returns, not be retried like an ordinary rate limit.
 *
 * Shapes from https://platform.claude.com/docs/en/api/rate-limits#reaching-your-spend-cap
 * and #setting-your-own-spend-limit (checked 2026-10-06):
 *   - tier monthly spend cap: HTTP 429, error.type "rate_limit_error",
 *     error.details.error_code "enforced_spend_limit_reached", message names the
 *     date access returns, NO retry-after header. Usage pauses until 00:00 UTC on
 *     the 1st of next month.
 *   - a spend limit the user set: HTTP 400, error.type "invalid_request_error",
 *     message begins "You have reached your specified API usage limits" (or
 *     "...specified workspace API usage limits") and states when access resumes.
 *
 * Before 0.5.164 the cap fell through to the generic 429 rule (per-model backoff,
 * 2s..5min) and the user-set limit to the 30s transient default, so the dead
 * account was re-tried every few minutes for the rest of the month.
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
vi.mock("open-sse/services/quotaPreflight.js", () => ({
  isAccountAboveThreshold: vi.fn(() => false),
  warmQuotaCache: vi.fn(),
  invalidateQuotaCache: vi.fn(),
  recordQuotaCacheHit: vi.fn(),
}));
vi.mock("@/sse/utils/logger.js", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

import { anthropicSpendLimitHold, markAccountUnavailable } from "../../src/sse/services/auth.js";
import { checkFallbackError, isModelLockActive } from "../../open-sse/services/accountFallback.js";
import { parseUpstreamError, formatProviderError } from "../../open-sse/utils/error.js";
import { getExecutor } from "../../open-sse/executors/index.js";

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0); // 2026-10-06 12:00 UTC
const NOV_1 = Date.UTC(2026, 10, 1);       // 1st of next month, 00:00 UTC

const capBody = (message) => JSON.stringify({
  type: "error",
  error: {
    type: "rate_limit_error",
    message,
    details: { error_code: "enforced_spend_limit_reached" },
  },
  request_id: "req_018EeWyXxfu5pfWkrYcMdjWG",
});
const CAP_MESSAGE = "You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization's API tier. You will regain access on 2026-11-01 at 00:00 UTC.";
const USER_LIMIT_BODY = JSON.stringify({
  type: "error",
  error: { type: "invalid_request_error", message: "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC." },
});
const WORKSPACE_LIMIT_BODY = JSON.stringify({
  type: "error",
  error: { type: "invalid_request_error", message: "You have reached your specified workspace API usage limits. You will regain access on 2026-11-01 at 00:00 UTC." },
});
const RATE_LIMIT_BODY = JSON.stringify({
  type: "error",
  error: { type: "rate_limit_error", message: "This request would exceed the rate limit for your organization of 50,000 input tokens per minute." },
});

// The exact errorText chat.js hands to markAccountUnavailable: chatCore runs the
// upstream body through parseUpstreamError(executor) + formatProviderError.
async function upstreamErrorText(status, body, provider = "anthropic") {
  const res = new Response(body, { status, headers: { "content-type": "application/json" } });
  const parsed = await parseUpstreamError(res, getExecutor(provider));
  return formatProviderError(new Error(parsed.message), provider, "claude-sonnet-5", parsed.statusCode);
}

describe("anthropicSpendLimitHold", () => {
  it("holds a tier spend-cap 429 until the date Anthropic names", async () => {
    const text = await upstreamErrorText(429, capBody(CAP_MESSAGE));
    const hold = anthropicSpendLimitHold(429, text, "anthropic", NOW);
    expect(hold.resetAtMs).toBe(NOV_1);
    expect(hold.reason).toContain("2026-11-01 00:00 UTC");
    expect(hold.reason.toLowerCase()).toContain("spend cap");
  });

  it("recognises the cap by error_code alone and falls back to the 1st of next month UTC", async () => {
    const text = await upstreamErrorText(429, capBody("Usage paused."));
    expect(anthropicSpendLimitHold(429, text, "anthropic", NOW).resetAtMs).toBe(NOV_1);
  });

  it("does not trust an impossible or implausibly distant date", async () => {
    const impossible = await upstreamErrorText(429, capBody(CAP_MESSAGE.replace("2026-11-01", "2026-02-30")));
    expect(anthropicSpendLimitHold(429, impossible, "anthropic", NOW).resetAtMs).toBe(NOV_1);
    const badHour = await upstreamErrorText(429, capBody(CAP_MESSAGE.replace("00:00 UTC", "27:00 UTC")));
    expect(anthropicSpendLimitHold(429, badHour, "anthropic", NOW).resetAtMs).toBe(NOV_1);
    const distant = await upstreamErrorText(429, capBody(CAP_MESSAGE.replace("2026-11-01", "2027-06-01")));
    expect(anthropicSpendLimitHold(429, distant, "anthropic", NOW).resetAtMs).toBe(NOV_1);
  });

  it("rolls the fallback reset over the year end", async () => {
    const text = await upstreamErrorText(429, capBody("Usage paused."));
    expect(anthropicSpendLimitHold(429, text, "anthropic", Date.UTC(2026, 11, 20)).resetAtMs).toBe(Date.UTC(2027, 0, 1));
  });

  it("is not a hold when the named date has already passed", async () => {
    const text = await upstreamErrorText(429, capBody(CAP_MESSAGE.replace("2026-11-01", "2026-10-01")));
    expect(anthropicSpendLimitHold(429, text, "anthropic", NOW)).toBeNull();
  });

  it("holds a user-set spend limit 400, org and workspace wording", async () => {
    for (const body of [USER_LIMIT_BODY, WORKSPACE_LIMIT_BODY]) {
      const hold = anthropicSpendLimitHold(400, await upstreamErrorText(400, body), "anthropic", NOW);
      expect(hold.resetAtMs).toBe(NOV_1);
      expect(hold.reason).toContain("2026-11-01 00:00 UTC");
    }
  });

  it("leaves ordinary 429s and unrelated 400s alone", async () => {
    expect(anthropicSpendLimitHold(429, await upstreamErrorText(429, RATE_LIMIT_BODY), "anthropic", NOW)).toBeNull();
    expect(anthropicSpendLimitHold(400, "[400]: messages: text content blocks must be non-empty", "anthropic", NOW)).toBeNull();
    // Cap wording on the wrong status is not the cap.
    expect(anthropicSpendLimitHold(400, await upstreamErrorText(429, capBody(CAP_MESSAGE)), "anthropic", NOW)).toBeNull();
    expect(anthropicSpendLimitHold(429, await upstreamErrorText(400, USER_LIMIT_BODY), "anthropic", NOW)).toBeNull();
    // A Claude Code workspace limit is documented as a 429 WITH retry-after: it
    // keeps the ordinary header-timed path.
    expect(anthropicSpendLimitHold(429, await upstreamErrorText(429, WORKSPACE_LIMIT_BODY), "anthropic", NOW)).toBeNull();
  });

  it("applies only to Anthropic-family providers", async () => {
    const text = await upstreamErrorText(429, capBody(CAP_MESSAGE));
    for (const p of ["anthropic", "claude", "cc", "anthropic-compatible-abc123"]) {
      expect(anthropicSpendLimitHold(429, text, p, NOW)?.resetAtMs).toBe(NOV_1);
    }
    for (const p of ["openai", "openrouter", "github", null]) {
      expect(anthropicSpendLimitHold(429, text, p, NOW)).toBeNull();
    }
  });

  it("does not change how checkFallbackError classifies an ordinary 429", () => {
    expect(checkFallbackError(429, "[429]: rate limited", 0)).toEqual({ shouldFallback: true, cooldownMs: 2000, newBackoffLevel: 1 });
  });
});

describe("markAccountUnavailable with Anthropic spend limits", () => {
  beforeEach(() => {
    db.rows = {};
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("locks the whole account until the reset and falls back immediately on the spend cap", async () => {
    const text = await upstreamErrorText(429, capBody(CAP_MESSAGE));
    const outcome = await markAccountUnavailable("conn-cap", 429, text, "anthropic", "claude-sonnet-5");

    expect(outcome.shouldFallback).toBe(true);
    expect(outcome.cooldownMs).toBe(NOV_1 - NOW);
    const row = db.rows["conn-cap"];
    expect(row.modelLock___all).toBe(new Date(NOV_1).toISOString());
    expect(row["modelLock_claude-sonnet-5"]).toBeUndefined();
    // Every model on the account is out, not just the one that was asked for.
    expect(isModelLockActive(row, "claude-opus-5-5")).toBe(true);
    expect(row.backoffLevel).toBe(0);
    expect(row.testStatus).toBe("unavailable");
    expect(row.isPermanentlyBanned).toBeUndefined();
    expect(row.banCount).toBeUndefined();
    expect(row.lastError).toContain("2026-11-01 00:00 UTC");
  });

  it("ignores a seconds-away anthropic-ratelimit reset header on the spend cap", async () => {
    const text = await upstreamErrorText(429, capBody(CAP_MESSAGE));
    const outcome = await markAccountUnavailable("conn-hdr", 429, text, "anthropic", "claude-sonnet-5", NOW + 5000);

    expect(outcome).toMatchObject({ shouldFallback: true, cooldownMs: NOV_1 - NOW });
    expect(db.rows["conn-hdr"].modelLock___all).toBe(new Date(NOV_1).toISOString());
  });

  it("locks the whole account until the reset on a user-set spend limit and still falls back", async () => {
    const text = await upstreamErrorText(400, USER_LIMIT_BODY);
    const outcome = await markAccountUnavailable("conn-user", 400, text, "anthropic", "claude-sonnet-5");

    expect(outcome.shouldFallback).toBe(true);
    expect(db.rows["conn-user"].modelLock___all).toBe(new Date(NOV_1).toISOString());
    expect(db.rows["conn-user"].lastError).toContain("2026-11-01 00:00 UTC");
  });

  it("keeps an ordinary 429 on the per-model exponential backoff", async () => {
    const text = await upstreamErrorText(429, RATE_LIMIT_BODY);
    const outcome = await markAccountUnavailable("conn-rl", 429, text, "anthropic", "claude-sonnet-5");

    expect(outcome).toMatchObject({ shouldFallback: true, cooldownMs: 2000 });
    const row = db.rows["conn-rl"];
    expect(row["modelLock_claude-sonnet-5"]).toBe(new Date(NOW + 2000).toISOString());
    expect(row.modelLock___all).toBeUndefined();
    expect(row.backoffLevel).toBe(1);
    expect(row.lastError).toBe(text.slice(0, 100));
  });
});
