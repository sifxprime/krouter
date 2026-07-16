import { describe, it, expect } from "vitest";
import {
  getQuotaVisibilityKey,
  filterQuotasByVisibility,
  getHiddenQuotaRows,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils";

// 0.5.106 — quota visibility: users hide individual quota rows per provider.
describe("quota visibility helpers", () => {
  const quotas = [
    { name: "session", used: 10, total: 100 },
    { name: "weekly", used: 5, total: 100 },
    { name: "review_session", modelKey: "review", used: 0, total: 100 },
  ];

  it("getQuotaVisibilityKey prefers modelKey then name", () => {
    expect(getQuotaVisibilityKey({ modelKey: "review", name: "review_session" })).toBe("review");
    expect(getQuotaVisibilityKey({ name: "weekly" })).toBe("weekly");
    expect(getQuotaVisibilityKey(null)).toBe("");
  });

  it("returns all quotas when nothing hidden", () => {
    expect(filterQuotasByVisibility("codex", quotas, {})).toHaveLength(3);
    expect(getHiddenQuotaRows("codex", quotas, {})).toHaveLength(0);
  });

  it("filters out a hidden row and surfaces it in getHiddenQuotaRows", () => {
    const vis = { codex: { hidden: ["review"] } };
    const visible = filterQuotasByVisibility("codex", quotas, vis);
    const hidden = getHiddenQuotaRows("codex", quotas, vis);
    expect(visible.map((q) => q.name)).toEqual(["session", "weekly"]);
    expect(hidden.map((q) => q.name)).toEqual(["review_session"]);
  });

  it("visibility is scoped per provider — hiding on codex doesn't affect claude", () => {
    const vis = { codex: { hidden: ["session"] } };
    // Claude has its own quotas; codex's hidden list must not touch them.
    const claudeQuotas = [{ name: "session" }, { name: "weekly" }];
    expect(filterQuotasByVisibility("claude", claudeQuotas, vis)).toHaveLength(2);
    expect(filterQuotasByVisibility("codex", quotas, vis).map((q) => q.name)).toEqual(["weekly", "review_session"]);
  });

  it("handles empty / malformed inputs safely", () => {
    expect(filterQuotasByVisibility("x", [], {})).toEqual([]);
    expect(filterQuotasByVisibility("x", null, {})).toEqual([]);
    expect(getHiddenQuotaRows("x", quotas, { x: { hidden: "notarray" } })).toEqual([]);
  });
});
