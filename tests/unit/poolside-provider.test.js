import { describe, it, expect } from "vitest";
import { resolveProviderAlias, parseModel } from "../../open-sse/services/model.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS, ALIAS_TO_ID } from "../../src/shared/constants/providers.js";

// 0.5.128 (upstream 31df0635) — Poolside freeTier provider, model ids carry a
// "poolside/" prefix, so the picker uses ps/poolside/<model>.
describe("0.5.128 Poolside provider wiring", () => {
  it("ps + poolside prefixes route to the poolside provider", () => {
    expect(resolveProviderAlias("ps")).toBe("poolside");
    expect(resolveProviderAlias("poolside")).toBe("poolside");
  });

  it("preserves the slash-in-model-id (ps/poolside/laguna-s-2.1 → model poolside/laguna-s-2.1)", () => {
    const p = parseModel("ps/poolside/laguna-s-2.1");
    expect(p.provider).toBe("poolside");
    expect(p.model).toBe("poolside/laguna-s-2.1");
  });

  it("has transport + is a freeTier UI provider, alias maps agree", () => {
    expect(PROVIDERS.poolside?.baseUrl).toBe("https://inference.poolside.ai/v1/chat/completions");
    expect(FREE_TIER_PROVIDERS.poolside?.alias).toBe("ps");
    expect(AI_PROVIDERS.poolside?.serviceKinds).toContain("llm");
    expect(ALIAS_TO_ID.ps).toBe("poolside");
  });
});
