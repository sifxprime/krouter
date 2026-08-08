import { describe, it, expect } from "vitest";
import { resolveProviderAlias, parseModel } from "../../open-sse/services/model.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { AI_PROVIDERS, APIKEY_PROVIDERS, ALIAS_TO_ID } from "../../src/shared/constants/providers.js";

// 0.5.127 (upstream b4808929) — TokenRouter wired into our two-alias-map catalog.
// Guards the "two maps must agree" rule (a mismatch silently 401/404s a provider).
describe("0.5.127 TokenRouter provider wiring", () => {
  it("both prefixes route to the tokenrouter provider", () => {
    expect(resolveProviderAlias("tr")).toBe("tokenrouter");
    expect(resolveProviderAlias("tokenrouter")).toBe("tokenrouter");
    expect(parseModel("tr/gpt-5").provider).toBe("tokenrouter");
    expect(parseModel("tokenrouter/claude-sonnet").provider).toBe("tokenrouter");
    expect(parseModel("tr/gpt-5").model).toBe("gpt-5");
  });

  it("has transport config (OpenAI-compatible chat baseUrl)", () => {
    expect(PROVIDERS.tokenrouter?.baseUrl).toBe("https://api.tokenrouter.com/v1/chat/completions");
    expect(PROVIDERS.tokenrouter?.format).toBe("openai");
  });

  it("is a recognized api-key provider in the UI catalog", () => {
    expect(APIKEY_PROVIDERS.tokenrouter?.alias).toBe("tr");
    expect(AI_PROVIDERS.tokenrouter?.id).toBe("tokenrouter");
    expect(AI_PROVIDERS.tokenrouter?.serviceKinds).toContain("llm");
  });

  it("the catalog + routing + shared alias maps all agree (no silent 401/404)", () => {
    expect(PROVIDER_ID_TO_ALIAS.tokenrouter).toBe("tokenrouter"); // passthrough (no static catalog)
    expect(ALIAS_TO_ID.tr).toBe("tokenrouter");
  });
});
