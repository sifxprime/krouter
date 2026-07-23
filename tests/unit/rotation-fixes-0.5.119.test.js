import { describe, it, expect } from "vitest";
import { MAX_QUOTA_RESET_COOLDOWN_MS, MAX_RATE_LIMIT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";
import { isConnectionSelectable } from "../../src/shared/services/healthCache.js";
import { getRetiredModelError } from "../../open-sse/config/retiredModels.js";
import { buildModelLockUpdate } from "../../open-sse/services/accountFallback.js";
import { getEffectiveFallbackStrategy } from "../../open-sse/config/providerStrategy.js";
import { deriveUnavailableResult } from "../../src/sse/services/auth.js";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

describe("0.5.119 A3 — park daily-exhausted accounts until real reset", () => {
  it("quota-reset cap is 6h (was 30m rate-limit cap)", () => {
    expect(MAX_QUOTA_RESET_COOLDOWN_MS).toBe(6 * HOUR);
    expect(MAX_QUOTA_RESET_COOLDOWN_MS).toBeGreaterThan(MAX_RATE_LIMIT_COOLDOWN_MS);
  });

  it('a 104h "Resets in" is parked 6h, not 30 min', () => {
    const resetsInMs = 104 * HOUR; // Antigravity "Resets in 104h25m37s"
    const cooldown = Math.min(resetsInMs, MAX_QUOTA_RESET_COOLDOWN_MS);
    expect(cooldown).toBe(6 * HOUR);
    expect(cooldown).not.toBe(30 * MIN); // the old, broken behavior
  });

  it("a genuine sub-6h reset is honored exactly (not inflated)", () => {
    const resetsInMs = 45 * MIN;
    expect(Math.min(resetsInMs, MAX_QUOTA_RESET_COOLDOWN_MS)).toBe(45 * MIN);
  });
});

describe("0.5.119 A2 — permanently-banned accounts stay out of rotation", () => {
  const model = "claude-sonnet-4-6";
  const fresh = { id: "fresh", provider: "antigravity" };
  const banned = { id: "banned", provider: "antigravity", isPermanentlyBanned: true };
  const locked = {
    id: "locked",
    provider: "antigravity",
    ...buildModelLockUpdate(model, HOUR), // active modelLock_claude-sonnet-4-6
  };

  it("keeps a fresh account", () => {
    expect(isConnectionSelectable(fresh, { model })).toBe(true);
  });

  it("drops a permanently-banned account during normal routing", () => {
    expect(isConnectionSelectable(banned, { model })).toBe(false);
  });

  it("still probes a banned account when bypassing locks (Test connection)", () => {
    expect(isConnectionSelectable(banned, { model, bypassModelLock: true })).toBe(true);
  });

  it("drops an actively model-locked account", () => {
    expect(isConnectionSelectable(locked, { model })).toBe(false);
  });

  it("respects the exclude set", () => {
    expect(
      isConnectionSelectable(fresh, { model, excludeConnectionIds: new Set(["fresh"]) })
    ).toBe(false);
  });
});

describe("0.5.119 B — clear error for retired OpenCode free models", () => {
  it("names the live replacement for qwen3.6-plus-free", () => {
    const msg = getRetiredModelError("qwen3.6-plus-free");
    expect(msg).toContain("retired");
    expect(msg).toContain("qwen3.6-plus");
    expect(msg).toContain("opencode-go");
  });

  it("matches a provider-prefixed id too", () => {
    expect(getRetiredModelError("oc/qwen3.6-plus-free")).toContain("qwen3.6-plus");
  });

  it("handles a retired model with no direct replacement", () => {
    const msg = getRetiredModelError("big-pickle");
    expect(msg).toContain("retired");
    expect(msg).toContain("No direct replacement");
  });

  it("returns null for a live model (no false positives)", () => {
    expect(getRetiredModelError("claude-sonnet-4-6")).toBeNull();
    expect(getRetiredModelError("qwen3.6-plus")).toBeNull(); // the live paid one
    expect(getRetiredModelError("")).toBeNull();
    expect(getRetiredModelError(null)).toBeNull();
  });
});

describe("0.5.119 — antigravity round-robin default strategy", () => {
  it("antigravity defaults to round-robin with no settings", () => {
    expect(getEffectiveFallbackStrategy({}, "antigravity")).toBe("round-robin");
    expect(getEffectiveFallbackStrategy(null, "antigravity")).toBe("round-robin");
  });

  it("antigravity round-robin default beats a global fill-first", () => {
    expect(getEffectiveFallbackStrategy({ fallbackStrategy: "fill-first" }, "antigravity")).toBe("round-robin");
  });

  it("an explicit per-provider override still wins", () => {
    const settings = { providerStrategies: { antigravity: { fallbackStrategy: "fill-first" } } };
    expect(getEffectiveFallbackStrategy(settings, "antigravity")).toBe("fill-first");
  });

  it("other providers keep fill-first / honour the global", () => {
    expect(getEffectiveFallbackStrategy({}, "kiro")).toBe("fill-first");
    expect(getEffectiveFallbackStrategy({ fallbackStrategy: "round-robin" }, "kiro")).toBe("round-robin");
  });
});

describe("0.5.119 — informative all-unavailable result (no bare 503)", () => {
  const provider = "antigravity";
  const model = "claude-sonnet-4-6";

  it("all rate-limited → allRateLimited with a retry-after", () => {
    const conns = [
      { id: "a", ...buildModelLockUpdate(model, HOUR), lastError: "429 quota", errorCode: 429 },
      { id: "b", ...buildModelLockUpdate(model, 2 * HOUR) },
    ];
    const r = deriveUnavailableResult(conns, provider, model);
    expect(r?.allRateLimited).toBe(true);
    expect(r.retryAfter).toBeTruthy();
    expect(r.retryAfterHuman).toContain("reset after");
    expect(r.lastErrorCode).toBe(429);
  });

  it("all banned (none locked) → re-verify hint, 403", () => {
    const conns = [
      { id: "a", isPermanentlyBanned: true },
      { id: "b", isPermanentlyBanned: true },
    ];
    const r = deriveUnavailableResult(conns, provider, model);
    expect(r?.allRateLimited).toBe(true);
    expect(r.retryAfter).toBeNull();
    expect(r.lastErrorCode).toBe(403);
    expect(r.lastError).toContain("re-verification");
  });

  it("empty list → null (genuine no-accounts case)", () => {
    expect(deriveUnavailableResult([], provider, model)).toBeNull();
    expect(deriveUnavailableResult(null, provider, model)).toBeNull();
  });

  it("a lock takes precedence over a ban when both present", () => {
    const conns = [
      { id: "a", ...buildModelLockUpdate(model, HOUR), errorCode: 429 },
      { id: "b", isPermanentlyBanned: true },
    ];
    const r = deriveUnavailableResult(conns, provider, model);
    expect(r.retryAfter).toBeTruthy(); // rate-limit path wins → retryable
    expect(r.lastErrorCode).toBe(429);
  });
});
