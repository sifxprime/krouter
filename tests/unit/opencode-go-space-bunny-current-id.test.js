/**
 * OpenCode Go renamed Space Bunny when it stopped being a free promotion
 * (anomalyco/opencode f03046d9f5, "feat(go): list paid Space Bunny", 2026-10-06).
 * The live roster at https://opencode.ai/zen/go/v1/models now lists "space-bunny",
 * and the old id is rejected before the key is even checked:
 *   401 {"type":"ModelError","message":"Model space-bunny-free is not supported"}
 * The docs' endpoint table puts it on /chat/completions (@ai-sdk/openai-compatible).
 */
import { describe, expect, it } from "vitest";

import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { openCodeGoTransport } from "../../open-sse/executors/opencode-go.js";

const ids = () => PROVIDER_MODELS["opencode-go"].map((m) => m.id);

describe("OpenCode Go Space Bunny", () => {
  it("lists the current space-bunny id", () => {
    const entry = PROVIDER_MODELS["opencode-go"].find((m) => m.id === "space-bunny");
    expect(entry).toBeTruthy();
    expect(entry.name).toBe("Space Bunny");
  });

  it("no longer offers the retired space-bunny-free id", () => {
    expect(ids()).not.toContain("space-bunny-free");
  });

  it("sends space-bunny to /chat/completions", () => {
    expect(openCodeGoTransport("space-bunny", { apiKey: "k" })).toBe("chat");
  });
});
