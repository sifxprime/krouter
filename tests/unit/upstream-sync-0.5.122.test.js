import { describe, it, expect } from "vitest";
import { githubMonthlyResetMs } from "../../src/sse/services/auth.js";

describe("0.5.122 3292dfc1 — GitHub monthly premium-request hold", () => {
  const MONTHLY = "You've reached your additional usage limit for your plan. Please upgrade.";

  it("github + 402 + monthly text → 00:00 UTC on the 1st of next month", () => {
    const ms = githubMonthlyResetMs(402, MONTHLY, "github");
    expect(ms).toBeGreaterThan(Date.now());
    const d = new Date(ms);
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    // it's a FUTURE month (this month or next depending on today), never the past
    expect(ms - Date.now()).toBeLessThanOrEqual(32 * 24 * 60 * 60 * 1000);
  });

  it("github + 402 + a DIFFERENT error → null (stays model-scoped)", () => {
    expect(githubMonthlyResetMs(402, "Bad request: model not found", "github")).toBeNull();
  });

  it("github + 429 (not 402) + monthly text → null", () => {
    expect(githubMonthlyResetMs(429, MONTHLY, "github")).toBeNull();
  });

  it("non-github provider + 402 + monthly text → null", () => {
    expect(githubMonthlyResetMs(402, MONTHLY, "openai")).toBeNull();
    expect(githubMonthlyResetMs(402, MONTHLY, "antigravity")).toBeNull();
  });

  it("handles missing/odd input safely", () => {
    expect(githubMonthlyResetMs(402, null, "github")).toBeNull();
    expect(githubMonthlyResetMs("402", MONTHLY, "github")).toBeGreaterThan(Date.now()); // numeric-string status
  });
});
