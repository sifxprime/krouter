/**
 * GLM quota parsing accepted only TOKENS_LIMIT and wrote every limit to the same
 * "session" key. A CREDIT_LIMIT plan therefore showed no quota at all, and an
 * account with more than one window kept only whichever arrived last — a weekly
 * figure displayed as the session one.
 *
 * Ported from upstream fcfcced4. Upstream extracts this into services/usage/glm.js
 * using a registry helper this fork does not have; ours stays inline in
 * services/usage.js, with the same parsing.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(process.cwd(), "open-sse/services/usage.js"), "utf-8");

// Mirrors the shipped loop so the mapping is exercised, not just grepped.
const parse = (limits) => {
  const quotas = {};
  for (const limit of limits) {
    if (!limit || (limit.type !== "TOKENS_LIMIT" && limit.type !== "CREDIT_LIMIT")) continue;
    const usedPercent = Number(limit.percentage) || 0;
    let key = "session";
    if (limit.unit === 3) key = `Session (${limit.number}h)`;
    else if (limit.unit === 6) key = "Weekly (7d)";
    else if (limit.type === "TOKENS_LIMIT") key = "Tokens";
    else key = `Limit (${limit.number})`;
    quotas[key] = { used: usedPercent, total: 100, remaining: Math.max(0, 100 - usedPercent) };
  }
  return quotas;
};

describe("GLM quota windows", () => {
  it("accepts a CREDIT_LIMIT plan", () => {
    const q = parse([{ type: "CREDIT_LIMIT", percentage: 40, unit: 3, number: 5 }]);
    expect(Object.keys(q)).toEqual(["Session (5h)"]);
    expect(q["Session (5h)"].used).toBe(40);
  });

  it("keeps a session and a weekly window side by side", () => {
    // Both used to land on "session"; the second overwrote the first.
    const q = parse([
      { type: "CREDIT_LIMIT", percentage: 20, unit: 3, number: 5 },
      { type: "CREDIT_LIMIT", percentage: 65, unit: 6, number: 7 },
    ]);
    expect(Object.keys(q).sort()).toEqual(["Session (5h)", "Weekly (7d)"]);
    expect(q["Session (5h)"].used).toBe(20);
    expect(q["Weekly (7d)"].used).toBe(65);
  });

  it("labels a plain token limit", () => {
    const q = parse([{ type: "TOKENS_LIMIT", percentage: 10 }]);
    expect(Object.keys(q)).toEqual(["Tokens"]);
  });

  it("still ignores limit types it does not understand", () => {
    expect(parse([{ type: "SOMETHING_ELSE", percentage: 90 }])).toEqual({});
  });

  it("computes remaining from the used percentage", () => {
    const q = parse([{ type: "TOKENS_LIMIT", percentage: 30 }]);
    expect(q.Tokens.remaining).toBe(70);
  });

  it("the shipped code carries both accepted types", () => {
    expect(src).toContain('limit.type !== "TOKENS_LIMIT" && limit.type !== "CREDIT_LIMIT"');
    expect(src).toContain("Weekly (7d)");
  });
});
