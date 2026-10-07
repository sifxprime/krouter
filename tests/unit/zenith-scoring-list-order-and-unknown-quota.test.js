import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { selectAccount, zenithScore, zenithPriorityBonus } from "../../open-sse/services/accountSelector.js";
import { recordOutcome } from "../../src/shared/services/connectionHealth.js";
import { _setQuotaCacheEntry, clearQuotaCache, remainingPctForAccount } from "../../open-sse/services/quotaPreflight.js";

/**
 * Two Zenith scoring bugs found while reviewing the 0.5.164 Settings text:
 * - zenithScore expected `null` for "no quota data" but scoreModelForCombo
 *   returns 0 (on purpose, for combo ordering), so every account without quota
 *   data (most API-key accounts) had its health scaled down to a tenth.
 * - The priority bonus was `priority * 10`, but priority 1 is the TOP of the
 *   dashboard list, so the bottom account got the biggest bonus. With health
 *   scaled to a tenth, that bonus decided the pick: Zenith preferred the last
 *   account in the list.
 * Rows are shaped like auth.js passes them: provider + priority, 1 = top.
 */
const PROV = "zq-prov";
const MODEL = "zq-model";
const conn = (id, priority) => ({ id, provider: PROV, priority });

describe("Zenith treats missing quota data as unknown, not as 0% left", () => {
  afterEach(() => clearQuotaCache());

  it("reports unknown quota as null and known quota as its percentage", () => {
    _setQuotaCacheEntry(PROV, "zq-known", { [MODEL]: { remainingPercentage: 42 } });
    expect(remainingPctForAccount(PROV, "zq-known", MODEL)).toBe(42);
    expect(remainingPctForAccount(PROV, "zq-none", MODEL)).toBeNull();
    expect(remainingPctForAccount(PROV, "zq-known", "other-model")).toBeNull();
  });

  it("scores an account with no quota data like one with plenty left", () => {
    // Never-used ids share the same neutral health.
    _setQuotaCacheEntry(PROV, "zq-plenty", { [MODEL]: { remainingPercentage: 90 } });
    expect(zenithScore(conn("zq-unknown", 3), MODEL)).toBe(zenithScore(conn("zq-plenty", 3), MODEL));
  });

  it("still scales down an account that is nearly out of quota", () => {
    _setQuotaCacheEntry(PROV, "zq-low", { [MODEL]: { remainingPercentage: 5 } });
    expect(zenithScore(conn("zq-low", 3), MODEL)).toBeLessThan(zenithScore(conn("zq-fresh", 3), MODEL) / 2);
  });
});

describe("Zenith's list-position bonus favours the top of the list", () => {
  afterEach(() => clearQuotaCache());

  it("gives the top of the list the largest bonus, and stays small", () => {
    expect(zenithPriorityBonus(1)).toBeGreaterThan(zenithPriorityBonus(2));
    expect(zenithPriorityBonus(2)).toBeGreaterThan(zenithPriorityBonus(3));
    expect(zenithPriorityBonus(50)).toBe(0);
    expect(zenithPriorityBonus(undefined)).toBe(0);
    // A tie-breaker on a 0-1000 health scale, never a decider.
    expect(zenithPriorityBonus(1)).toBeLessThanOrEqual(50);
  });

  it("picks the top account when accounts are otherwise equal", () => {
    const list = [conn("zq-tie-1", 1), conn("zq-tie-2", 2), conn("zq-tie-3", 3)];
    expect(selectAccount(list, "fill-first", {}, MODEL).account.id).toBe("zq-tie-1");
  });

  it("picks the clearly healthier account wherever it sits, with no quota data", () => {
    // Both upper accounts are failing; a never-used account would score a neutral, near-perfect health.
    for (let i = 0; i < 10; i++) recordOutcome("zq-sick-top", false, 0);
    for (let i = 0; i < 10; i++) recordOutcome("zq-sick-mid", false, 0);
    recordOutcome("zq-well-bottom", true, 200);
    const list = [conn("zq-sick-top", 1), conn("zq-sick-mid", 2), conn("zq-well-bottom", 3)];
    expect(selectAccount(list, "fill-first", {}, MODEL).account.id).toBe("zq-well-bottom");
  });

  it("does not hand the pick to the bottom account over a healthier top one", () => {
    recordOutcome("zq-good-top", true, 300);
    for (let i = 0; i < 3; i++) recordOutcome("zq-bad-bottom", false, 0);
    const list = [conn("zq-good-top", 1), conn("zq-bad-bottom", 6)];
    expect(selectAccount(list, "fill-first", {}, MODEL).account.id).toBe("zq-good-top");
  });
});

describe("the dashboard's Zenith view shows the numbers the router uses", () => {
  it("uses the shared bonus and quota lookup instead of its own copy", () => {
    const src = readFileSync("src/app/api/providers/zenith/route.js", "utf-8");
    expect(src).toContain("zenithPriorityBonus(");
    expect(src).toContain("remainingPctForAccount(");
    expect(src).not.toMatch(/priority \* 10/);
  });
});
