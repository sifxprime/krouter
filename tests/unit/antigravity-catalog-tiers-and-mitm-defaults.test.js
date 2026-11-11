// 0.5.166 — the ag catalog was still the 2026-08 lineup.
//
// Google removed the Gemini 3.5 Flash tiers, gemini-3-flash-agent and the
// gemini-3-flash command model on 2026-10-08 (upstream 24034f69, "remove
// deprecated gemini-3.5 and gemini-3-flash models"), and added the 3.6/3.7/3.8
// Flash tier ladders, gemini-3.1-pro-high, the Claude Sonnet/Opus 5.5 tiers and
// gemini-4-argon-high (783e271c, 86694ed8, 70f15aa5, a07ed95b, 29fc880e).
// kRouter's MITM default slot — the mandatory one, the model the IDE sends out of
// the box — pointed at the retired gemini-3.5-flash-low, so a fresh Antigravity
// MITM setup routed its primary turn to a 404.
//
// Each tier also needs its wire model: upstream encodes it as
// `upstreamModelId: "<wire>(level)"` and splits the level off in its loader.
// kRouter has no such parser, so the catalog stores the bare wire id in
// `upstreamModelId` and the level in `thinkingLevel`.
//
// 0.5.169 — two corrections, both from measurement rather than from upstream commits.
//
// This file used to claim the level was "read by the Antigravity executor through
// getModelThinkingLevel". It was not: that helper was called from nowhere, and the 3.8
// entries carried no upstreamModelId at all, so the whole family went to Google verbatim
// and every one 404'd. The assertions below passed throughout, because they checked the
// catalog's data against itself and never that anything consumed it. The executor now
// reads both (open-sse/executors/antigravity.js), so the claim is finally true.
//
// A live v1internal:fetchAvailableModels for a real account also contradicts two beliefs
// harvested from upstream commits:
//   - the 3.8 family is ONE tiered id, `gemini-3.8-flash-tiered`, not one wire id per
//     tier. Direct to Google: model=gemini-3.8-flash-tiered -> 200,
//     model=gemini-3.8-flash-high -> 404 NOT_FOUND.
//   - `gemini-3-flash` is NOT retired. It is served at remainingFraction 1.0 and is this
//     account's commandModelIds entry; a chat through kRouter returns 200.
import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { PROVIDER_MODELS, getModelUpstreamId, getModelThinkingLevel } from "../../open-sse/config/providerModels.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";
import { getPricingForModel } from "../../src/shared/constants/pricing.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const require = createRequire(import.meta.url);
const { MODEL_SYNONYMS, MODEL_PATTERNS } = require("../../src/mitm/config.js");

const ag = PROVIDER_MODELS.ag;
const ids = ag.map((m) => m.id);

describe("Antigravity (ag) catalog", () => {
  it("lists the Gemini 3.6 / 3.7 / 3.8 Flash tier ladders", () => {
    for (const family of ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"]) {
      for (const tier of ["high", "medium", "low"]) {
        expect(ids, `${family}-${tier} missing`).toContain(`${family}-${tier}`);
      }
    }
  });

  it("lists gemini-3.1-pro-high next to the legacy gemini-pro-agent id", () => {
    expect(ids).toContain("gemini-3.1-pro-high");
    expect(ids).toContain("gemini-pro-agent");
    expect(getModelUpstreamId("ag", "gemini-3.1-pro-high")).toBe("gemini-pro-agent");
  });

  it("lists the Claude Sonnet 5.5 and Opus 5.5 tiers", () => {
    for (const base of ["claude-sonnet-5-5", "claude-opus-5-5"]) {
      expect(ids, `${base} missing`).toContain(base);
      for (const tier of ["high", "medium", "low"]) {
        expect(ids, `${base}-${tier} missing`).toContain(`${base}-${tier}`);
      }
    }
  });

  it("lists gemini-4-argon-high", () => {
    expect(ids).toContain("gemini-4-argon-high");
  });

  it("drops the ids Google retired on 2026-10-08", () => {
    // 0.5.169 — gemini-3-flash left this list. It is not retired: a live roster for a real
    // account serves it at remainingFraction 1.0 and names it in commandModelIds, and a
    // chat through kRouter returns 200. Only the -agent variant went away.
    for (const id of ["gemini-3.5-flash-low", "gemini-3.5-flash-extra-low", "gemini-3.5-flash-high", "gemini-3-flash-agent"]) {
      expect(ids, `${id} was removed upstream`).not.toContain(id);
    }
  });

  it("publishes gemini-3-flash, which the live roster serves", () => {
    expect(ids).toContain("gemini-3-flash");
  });

  it("keeps the image model", () => {
    expect(ids).toContain("gemini-3.1-flash-image");
  });

  it("has no duplicate ids", () => {
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});

describe("tier wire ids and thinking levels", () => {
  // 3.8, 3.7 and 3.6 each collapse to a single "-tiered" wire model and differ only by
  // level. 3.8 was wrong here until 0.5.169 — see the header.
  it.each([
    ["gemini-3.8-flash-high", "gemini-3.8-flash-tiered", "high"],
    ["gemini-3.8-flash-medium", "gemini-3.8-flash-tiered", "medium"],
    ["gemini-3.8-flash-low", "gemini-3.8-flash-tiered", "low"],
    ["gemini-3.7-flash-high", "gemini-3.7-flash-tiered", "high"],
    ["gemini-3.7-flash-medium", "gemini-3.7-flash-tiered", "medium"],
    ["gemini-3.7-flash-low", "gemini-3.7-flash-tiered", "low"],
    ["gemini-3.6-flash-high", "gemini-3.6-flash-tiered", "high"],
    ["gemini-3.6-flash-medium", "gemini-3.6-flash-tiered", "medium"],
    ["gemini-3.6-flash-low", "gemini-3.6-flash-tiered", "low"],
    ["gemini-3.1-pro-low", "gemini-3.1-pro-low", "low"],
    ["gemini-4-argon-high", "gemini-4-argon-high", "high"],
    ["claude-sonnet-5-5-medium", "claude-sonnet-5-5-medium", "medium"],
    ["claude-opus-5-5-low", "claude-opus-5-5-low", "low"],
  ])("%s -> %s at level %s", (id, wire, level) => {
    expect(getModelUpstreamId("ag", id)).toBe(wire);
    expect(getModelThinkingLevel("ag", id)).toBe(level);
  });

  it("never puts the upstream '(level)' marker on the wire", () => {
    for (const m of ag) {
      expect(getModelUpstreamId("ag", m.id), `${m.id} wire id`).not.toContain("(");
    }
  });

  it("leaves the untiered models without a level", () => {
    for (const id of ["claude-sonnet-4-6", "claude-opus-4-6-thinking", "gpt-oss-120b-medium", "gemini-pro-agent"]) {
      expect(getModelThinkingLevel("ag", id)).toBeNull();
    }
  });
});

describe("Antigravity MITM slots", () => {
  const mitm = MITM_TOOLS.antigravity;

  it("makes the out-of-box Default slot a model Google still serves", () => {
    const mandatory = mitm.defaultModels.filter((m) => m.mandatory).map((m) => m.id);
    expect(mandatory).toEqual(["gemini-3.8-flash-medium"]);
    expect(ids).toContain("gemini-3.8-flash-medium");
  });

  it("offers only slots the ag catalog can serve", () => {
    const offered = mitm.defaultModels.map((m) => m.id);
    expect(offered.filter((id) => !ids.includes(id))).toEqual([]);
  });

  it("keeps modelAliases and the slot list in step", () => {
    expect([...mitm.modelAliases].sort()).toEqual([...new Set(mitm.defaultModels.map((m) => m.alias))].sort());
  });

  // Antigravity IDE builds in the field still send the old 3.5 ids. Upstream kept
  // them as synonyms pointing at the 3.8 ladder so those configs keep working.
  it("maps the retired 3.5 client ids onto live 3.8 tiers", () => {
    const syn = MODEL_SYNONYMS.antigravity;
    expect(syn["gemini-default"]).toBe("gemini-3.8-flash-medium");
    expect(syn["gemini-3.5-flash-high"]).toBe("gemini-3.8-flash-high");
    expect(syn["gemini-3.5-flash-medium"]).toBe("gemini-3.8-flash-medium");
    expect(syn["gemini-3.5-flash-low"]).toBe("gemini-3.8-flash-low");
    expect(syn["gemini-3.5-flash-extra-low"]).toBe("gemini-3.8-flash-low");
  });

  it("resolves every synonym and pattern to a catalog model", () => {
    for (const [from, to] of Object.entries(MODEL_SYNONYMS.antigravity)) {
      expect(ids, `synonym ${from} -> ${to} is not a catalog model`).toContain(to);
    }
    for (const { alias } of MODEL_PATTERNS.antigravity) {
      expect(ids, `pattern alias ${alias} is not a catalog model`).toContain(alias);
    }
  });

  it("gives Kiro a claude-sonnet-5 slot so its primary turn is mappable", () => {
    expect(MITM_TOOLS.kiro.defaultModels.map((m) => m.id)).toContain("claude-sonnet-5");
  });
});

describe("pricing and capabilities for the new ag ids", () => {
  it("prices the Flash tiers at Google's tiered rate, not the 2.5 Flash rate", () => {
    for (const id of ["gemini-3.8-flash-high", "gemini-3.7-flash-medium", "gemini-3.6-flash-low"]) {
      expect(getPricingForModel("ag", id), `${id} pricing`).toMatchObject({ input: 1.5, output: 7.5 });
    }
  });

  it("prices the Claude 5.5 tiers like their base model", () => {
    expect(getPricingForModel("ag", "claude-sonnet-5-5-high")).toMatchObject({ input: 2.0, output: 10.0 });
    expect(getPricingForModel("ag", "claude-opus-5-5-high")).toMatchObject({ input: 4.0, output: 20.0 });
  });

  it("prices every ag chat model", () => {
    const missing = ag.filter((m) => (m.type || "llm") === "llm" && !getPricingForModel("ag", m.id)).map((m) => m.id);
    expect(missing).toEqual([]);
  });

  // Argon answers thinkingLevel "minimal" and any thinkingBudget with 400, so it
  // must never be advertised as able to turn thinking off.
  it("marks Gemini 4 Argon as always-thinking with its real window", () => {
    const caps = getCapabilitiesForModel("ag", "gemini-4-argon-high");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("gemini-level");
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.maxOutput).toBe(65536);
  });

  it("marks the Claude 5.5 tiers as always-thinking", () => {
    for (const id of ["claude-sonnet-5-5-high", "claude-sonnet-5-5-medium", "claude-sonnet-5-5-low",
      "claude-opus-5-5-high", "claude-opus-5-5-medium", "claude-opus-5-5-low"]) {
      expect(getCapabilitiesForModel("ag", id).thinkingCanDisable, `${id}`).toBe(false);
    }
  });
});
