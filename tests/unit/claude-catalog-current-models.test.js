import { describe, it, expect } from "vitest";
import { getModelsByProviderId, getDefaultModel } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../src/shared/constants/pricing.js";

// Source: https://platform.claude.com/docs/en/about-claude/models/overview and
// https://platform.claude.com/docs/en/about-claude/model-deprecations (read 2026-10-06).
const CURRENT = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-haiku-4-5-20251001"];
const LEGACY_STILL_SERVED = [
  "claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-7",
  "claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-5-20251101", "claude-sonnet-4-5-20250929",
];
const RETIRED = ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-sonnet-20241022"];

describe.each([
  ["claude (cc)", "claude"],
  ["anthropic", "anthropic"],
])("%s provider lists Anthropic's current Claude models", (_label, providerId) => {
  const ids = () => getModelsByProviderId(providerId).map((m) => m.id);

  it("puts the current lineup first, Opus 5.5 as the default", () => {
    expect(ids().slice(0, CURRENT.length)).toEqual(CURRENT);
    expect(getDefaultModel(providerId === "claude" ? "cc" : providerId)).toBe("claude-opus-5-5");
  });

  it("keeps every still-served legacy id after the current ones", () => {
    const list = ids();
    for (const id of LEGACY_STILL_SERVED) {
      expect(list).toContain(id);
      expect(list.indexOf(id)).toBeGreaterThanOrEqual(CURRENT.length);
    }
  });

  it("does not offer models Anthropic has retired", () => {
    for (const id of RETIRED) expect(ids()).not.toContain(id);
  });

  it("has no duplicate ids", () => {
    const list = ids();
    expect(new Set(list).size).toBe(list.length);
  });
});

describe("Claude 5.x capabilities match Anthropic's published limits", () => {
  it.each([
    // Thinking "disabled" is a 400 on Opus 5.5, Sonnet 5.5 and both Fables
    // (https://platform.claude.com/docs/en/build-with-claude/thinking).
    ["claude-opus-5-5", false],
    ["claude-sonnet-5-5", false],
    ["claude-fable-5-1", false],
    ["claude-fable-5", false],
    ["claude-opus-5", true],
    ["claude-sonnet-5", true],
  ])("%s resolves to adaptive thinking, 1M context, 128K output", (model, canDisable) => {
    expect(getCapabilitiesForModel("claude", model)).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "claude-adaptive",
      thinkingCanDisable: canDisable,
      contextWindow: 1000000,
      maxOutput: 128000,
    });
  });

  it.each(["claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6"])(
    "%s publishes the 1M context and 128K output Anthropic documents",
    (model) => {
      expect(getCapabilitiesForModel("anthropic", model)).toMatchObject({
        contextWindow: 1000000,
        maxOutput: 128000,
        thinkingFormat: "claude-adaptive",
      });
    },
  );
});

describe("Claude 5.x pricing matches Anthropic's price list", () => {
  // input / output / cache read / 5-minute cache write, $ per 1M tokens
  it.each([
    ["claude-opus-5-5", { input: 4, output: 20, cached: 0.2, reasoning: 20, cache_creation: 5 }],
    ["claude-sonnet-5-5", { input: 2, output: 10, cached: 0.2, reasoning: 10, cache_creation: 2.5 }],
    ["claude-fable-5-1", { input: 10, output: 50, cached: 0.25, reasoning: 50, cache_creation: 12.5 }],
    ["claude-fable-5", { input: 10, output: 50, cached: 1, reasoning: 50, cache_creation: 12.5 }],
    ["claude-sonnet-5", { input: 2, output: 10, cached: 0.2, reasoning: 10, cache_creation: 2.5 }],
    ["claude-opus-5", { input: 5, output: 25, cached: 0.5, reasoning: 25, cache_creation: 6.25 }],
  ])("%s", (model, expected) => {
    expect(getPricingForModel("claude", model)).toEqual(expected);
  });

  it("still prices retired ids so old usage rows keep a cost", () => {
    expect(getPricingForModel("anthropic", "claude-sonnet-4-20250514")).not.toBeNull();
  });
});
