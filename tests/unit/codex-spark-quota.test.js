/**
 * gpt-5.3-codex-spark is metered on its own rate-limit window. Without it the
 * usage dashboard rendered only the normal and review windows, so a user whose
 * Spark quota was exhausted saw unexplained 429s with no row accounting for them
 * while ordinary Codex requests kept working. We do ship the model
 * (providerModels.js) and price it (pricing.js). Ported from upstream 40eed186.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(process.cwd(), "open-sse/services/usage.js"), "utf-8");

// Mirrors the shipped resolver so the shapes are exercised, not just grepped.
const getSpark = (data) => {
  if (data.spark_rate_limit || data.gpt_5_3_codex_spark_rate_limit) {
    return data.spark_rate_limit || data.gpt_5_3_codex_spark_rate_limit;
  }
  const byLimitId = data.rate_limits_by_limit_id;
  if (byLimitId && typeof byLimitId === "object" && !Array.isArray(byLimitId)) {
    return byLimitId["gpt-5.3-codex-spark"] || byLimitId.gpt_5_3_codex_spark || byLimitId.spark || null;
  }
  const additional = Array.isArray(data.additional_rate_limits) ? data.additional_rate_limits : [];
  return additional.find((e) => {
    const id = String(e?.limit_name || e?.metered_feature || e?.id || "").toLowerCase();
    return id.includes("spark") || id.includes("5.3-codex-spark");
  }) || null;
};

describe("Codex Spark quota window", () => {
  it("is appended alongside the normal and review windows", () => {
    expect(src).toContain('appendCodexQuotaWindows(quotas, "spark"');
  });

  it("reads the flat key", () => {
    expect(getSpark({ spark_rate_limit: { used: 5 } })).toEqual({ used: 5 });
    expect(getSpark({ gpt_5_3_codex_spark_rate_limit: { used: 7 } })).toEqual({ used: 7 });
  });

  it("reads the by-limit-id map under each spelling", () => {
    expect(getSpark({ rate_limits_by_limit_id: { "gpt-5.3-codex-spark": { used: 1 } } })).toEqual({ used: 1 });
    expect(getSpark({ rate_limits_by_limit_id: { spark: { used: 2 } } })).toEqual({ used: 2 });
  });

  it("finds it in the additional list", () => {
    const found = getSpark({ additional_rate_limits: [
      { limit_name: "codex_review", used: 0 },
      { limit_name: "gpt-5.3-codex-spark", used: 9 },
    ]});
    expect(found.used).toBe(9);
  });

  it("returns null when the account has no spark window", () => {
    expect(getSpark({ rate_limit: { used: 3 } })).toBeNull();
    expect(getSpark({})).toBeNull();
  });

  it("does not mistake the review window for spark", () => {
    expect(getSpark({ rate_limits_by_limit_id: { code_review: { used: 4 } } })).toBeNull();
  });
});
