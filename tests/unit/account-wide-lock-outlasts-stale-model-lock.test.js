/**
 * An account-wide lock (modelLock___all) must hold every model on the account
 * even when that model still carries its own, older modelLock_<model> key.
 *
 * isModelLockActive used to read `connection[modelKey] || connection[MODEL_LOCK_ALL]`:
 * whenever the model's own key existed it won, so an EXPIRED per-model key hid an
 * active account-wide lock. Expired keys are only cleared by clearAccountError on
 * a success, which a capped account never gets. Sequence that broke the 0.5.164
 * Anthropic spend-cap hold for the account's busiest model:
 *   1. ordinary 429 on claude-sonnet-5 -> modelLock_claude-sonnet-5 = now + 2s
 *   2. 10s later the next sonnet request hits the monthly spend cap
 *      -> modelLock___all = 1st of next month (sonnet key left behind, expired)
 *   3. isModelLockActive(row, "claude-sonnet-5") -> false, so the picker kept
 *      choosing the capped account for sonnet on every request all month.
 * GitHub's monthly premium-request hold (402) had the same gap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// In-memory stand-in for the SQLite connection row, so markAccountUnavailable
// runs its real lock computation (merging into the existing row) without disk.
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

import { markAccountUnavailable } from "../../src/sse/services/auth.js";
import { isModelLockActive, MODEL_LOCK_ALL } from "../../open-sse/services/accountFallback.js";

// The picker's real predicate (the module is mocked above only for auth.js).
const { isConnectionSelectable } = await vi.importActual("../../src/shared/services/healthCache.js");

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0); // 2026-10-06 12:00 UTC
const NOV_1 = Date.UTC(2026, 10, 1);       // 1st of next month, 00:00 UTC
const iso = (ms) => new Date(ms).toISOString();

const RATE_LIMIT_TEXT = "[429]: This request would exceed the rate limit for your organization of 50,000 input tokens per minute.";
const SPEND_CAP_TEXT = "[429]: You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization's API tier. You will regain access on 2026-11-01 at 00:00 UTC. enforced_spend_limit_reached";
const GITHUB_MONTHLY_TEXT = "[402]: You've reached your additional usage limit for your plan.";

beforeEach(() => {
  db.rows = {};
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("isModelLockActive with both a model key and the account-wide key", () => {
  it("an active account-wide lock wins over the model's own expired lock", () => {
    const row = { "modelLock_claude-sonnet-5": iso(NOW - 8000), [MODEL_LOCK_ALL]: iso(NOV_1) };
    expect(isModelLockActive(row, "claude-sonnet-5")).toBe(true);
  });

  it("an active account-wide lock outlasts the model's own shorter lock", () => {
    const row = { "modelLock_claude-sonnet-5": iso(NOW + 2000), [MODEL_LOCK_ALL]: iso(NOV_1) };
    vi.setSystemTime(NOW + 60_000);
    expect(isModelLockActive(row, "claude-sonnet-5")).toBe(true);
  });

  it("a model's own lock still holds after an earlier account-wide lock expires", () => {
    const row = { "modelLock_claude-sonnet-5": iso(NOW + 60_000), [MODEL_LOCK_ALL]: iso(NOW - 1000) };
    expect(isModelLockActive(row, "claude-sonnet-5")).toBe(true);
    expect(isModelLockActive(row, "claude-opus-5-5")).toBe(false);
  });

  it("is unlocked once both have expired, and with no locks at all", () => {
    const row = { "modelLock_claude-sonnet-5": iso(NOW - 2000), [MODEL_LOCK_ALL]: iso(NOW - 1000) };
    expect(isModelLockActive(row, "claude-sonnet-5")).toBe(false);
    expect(isModelLockActive({}, "claude-sonnet-5")).toBe(false);
    expect(isModelLockActive({ [MODEL_LOCK_ALL]: null }, null)).toBe(false);
  });
});

describe("a monthly hold after an earlier per-model cooldown", () => {
  it("keeps the capped Anthropic account out for the model that was cooling down", async () => {
    await markAccountUnavailable("conn-a", 429, RATE_LIMIT_TEXT, "anthropic", "claude-sonnet-5");
    expect(db.rows["conn-a"]["modelLock_claude-sonnet-5"]).toBe(iso(NOW + 2000));

    vi.setSystemTime(NOW + 10_000); // past the 2s cooldown, no success in between
    await markAccountUnavailable("conn-a", 429, SPEND_CAP_TEXT, "anthropic", "claude-sonnet-5");

    const row = db.rows["conn-a"];
    expect(row[MODEL_LOCK_ALL]).toBe(iso(NOV_1));
    expect(isModelLockActive(row, "claude-sonnet-5")).toBe(true);
    expect(isModelLockActive(row, "claude-opus-5-5")).toBe(true);
    expect(isConnectionSelectable(row, { model: "claude-sonnet-5" })).toBe(false);
    // Test connection still bypasses the lock so a raised cap can be re-checked.
    expect(isConnectionSelectable(row, { model: "claude-sonnet-5", bypassModelLock: true })).toBe(true);
  });

  it("keeps the GitHub monthly hold for the model that was cooling down", async () => {
    await markAccountUnavailable("conn-g", 429, "[429]: rate limited", "github", "gpt-5");
    vi.setSystemTime(NOW + 10_000);
    await markAccountUnavailable("conn-g", 402, GITHUB_MONTHLY_TEXT, "github", "gpt-5");

    const row = db.rows["conn-g"];
    expect(row[MODEL_LOCK_ALL]).toBe(iso(NOV_1));
    expect(isConnectionSelectable(row, { model: "gpt-5" })).toBe(false);
  });
});
