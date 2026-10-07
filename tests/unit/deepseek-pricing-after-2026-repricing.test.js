import { describe, it, expect } from "vitest";
import { MODEL_PRICING, getPricingForModel } from "../../src/shared/constants/pricing.js";

// DeepSeek moved to peak/off-peak pricing on 2026-08-16 16:00 UTC and cut Flash
// prices with V4.1-Flash on 2026-09-10 (https://api-docs.deepseek.com/updates).
// Current table: https://api-docs.deepseek.com/quick_start/pricing (read 2026-10-06).
// kRouter has one rate per model, so it records the peak (full) rate.
const FLASH = { input: 0.3, output: 1.2, cached: 0.006, reasoning: 1.2, cache_creation: 0.3 };
const PRO = { input: 1.32, output: 3.96, cached: 0.044, reasoning: 3.96, cache_creation: 1.32 };

describe("DeepSeek V4 pricing after the 2026 repricing", () => {
  it("prices deepseek-v4-pro at the current peak rate", () => {
    expect(MODEL_PRICING["deepseek-v4-pro"]).toEqual(PRO);
  });

  // DeepSeek retired V4 Flash; the legacy names are served by V4.1-Flash and
  // billed at the Flash price.
  it.each(["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"])(
    "prices %s at the current Flash peak rate",
    (model) => {
      expect(MODEL_PRICING[model]).toEqual(FLASH);
    },
  );

  // Usage cost is looked up by the catalog id (chatCore keeps it in sharedCtx),
  // not the upstreamModelId, so these V4 Pro aliases need their own rows or
  // they fall through to the stale deepseek-v* pattern.
  it.each(["deepseek-v4-pro", "deepseek-v4-pro-max", "deepseek-v4-pro-none"])(
    "bills the deepseek provider's %s at the V4 Pro peak rate",
    (model) => {
      expect(getPricingForModel("deepseek", model)).toEqual(PRO);
    },
  );

  it("resolves vendor-prefixed ids to the same rates", () => {
    expect(getPricingForModel("commandcode", "deepseek/deepseek-v4-pro")).toEqual(PRO);
    expect(getPricingForModel("commandcode", "deepseek/deepseek-v4-flash")).toEqual(FLASH);
  });
});
