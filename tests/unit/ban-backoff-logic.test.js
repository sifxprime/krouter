import { describe, it, expect } from "vitest";

// Isolated re-implementation of the exponential backoff math from
// src/sse/services/auth.js so we can lock the formula into a test without
// pulling the whole route + DB layer into vitest.
function nextCooldown(baseCooldownMs, priorBanCount) {
  const newBanCount = (priorBanCount || 0) + 1;
  const multipliers = [1, 2, 4, 7, 14];
  const mult = multipliers[Math.min(newBanCount - 1, multipliers.length - 1)];
  return { newBanCount, cooldownMs: baseCooldownMs * mult, chronicallyBanned: newBanCount >= 3 };
}

describe("ban-backoff logic (extracted from auth.js)", () => {
  const H24 = 24 * 60 * 60 * 1000;

  it("first ban is 24h flat (multiplier 1x)", () => {
    const r = nextCooldown(H24, 0);
    expect(r.newBanCount).toBe(1);
    expect(r.cooldownMs).toBe(H24);
    expect(r.chronicallyBanned).toBe(false);
  });

  it("second consecutive ban doubles to 48h (2x)", () => {
    const r = nextCooldown(H24, 1);
    expect(r.newBanCount).toBe(2);
    expect(r.cooldownMs).toBe(H24 * 2);
    expect(r.chronicallyBanned).toBe(false);
  });

  it("third ban goes to 96h AND flags chronic", () => {
    const r = nextCooldown(H24, 2);
    expect(r.newBanCount).toBe(3);
    expect(r.cooldownMs).toBe(H24 * 4);
    expect(r.chronicallyBanned).toBe(true);
  });

  it("fourth ban → 7d, still chronic", () => {
    const r = nextCooldown(H24, 3);
    expect(r.cooldownMs).toBe(H24 * 7);
    expect(r.chronicallyBanned).toBe(true);
  });

  it("beyond the multiplier table, caps at 14x", () => {
    const r = nextCooldown(H24, 99);
    expect(r.cooldownMs).toBe(H24 * 14);
    expect(r.chronicallyBanned).toBe(true);
  });
});
