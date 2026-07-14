import { describe, it, expect } from "vitest";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// 0.5.103 — Regression: the 3 providers added in v0.5.98 (featherless, venice,
// perplexity-agent) were present in the UI manifest + liveFetch but had NO
// backend chat-routing config. A user could add a key + see the model catalog,
// but chat requests had no baseUrl to route to and failed. Featherless was worse:
// its alias "fl" was not in the alias map, so "fl/<model>" resolved to "fl"
// which isn't a config key at all.
describe("v0.5.98 provider chat-routing chain", () => {
  const cases = [
    { alias: "fl", id: "featherless", host: "api.featherless.ai" },
    { alias: "venice", id: "venice", host: "api.venice.ai" },
    { alias: "perplexity-agent", id: "perplexity-agent", host: "api.perplexity.ai" },
  ];

  for (const { alias, id, host } of cases) {
    it(`${alias} resolves alias → id → backend baseUrl`, () => {
      const resolved = resolveProviderAlias(alias);
      expect(resolved).toBe(id);
      const cfg = PROVIDERS[resolved];
      expect(cfg, `PROVIDERS['${id}'] must exist`).toBeTruthy();
      expect(cfg.baseUrl).toContain(host);
      expect(cfg.format).toBeTruthy();
    });

    it(`${id} is present in the UI manifest with an image`, () => {
      const p = AI_PROVIDERS[id];
      expect(p).toBeTruthy();
      expect(p.image).toMatch(/\/providers\/.+\.png$/);
    });
  }

  it("perplexity-agent uses the Responses API format", () => {
    expect(PROVIDERS["perplexity-agent"].format).toBe("openai-responses");
  });
});
