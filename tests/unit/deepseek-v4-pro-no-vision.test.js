import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// DeepSeek's Models & Pricing table lists Vision as "Not supported" for
// deepseek-v4-pro, and its Vision guide names only deepseek-flash as accepting
// images (https://api-docs.deepseek.com/quick_start/pricing,
// https://api-docs.deepseek.com/guides/vision, read 2026-10-06). A host that
// serves the same model cannot add vision to it, so no provider row may claim it.
describe("deepseek-v4-pro is text-only", () => {
  it.each(["codebuddy-cn", "deepseek", "commandcode", ""])("reports vision:false on provider %s", (provider) => {
    expect(getCapabilitiesForModel(provider, "deepseek-v4-pro").vision).toBe(false);
  });

  it("keeps the rest of the CodeBuddy metadata", () => {
    expect(getCapabilitiesForModel("codebuddy-cn", "deepseek-v4-pro")).toMatchObject({
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 50000,
    });
  });
});
