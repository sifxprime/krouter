import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { buildProviderHeaders, buildProviderUrl } from "../../open-sse/services/provider.js";

describe("Gemini API-key compatibility", () => {
  it("uses the v1beta generateContent URL and documented API-key header", () => {
    expect(buildProviderUrl("gemini", "gemini-2.5-flash", false)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(buildProviderHeaders("gemini", { apiKey: "test-key" }, false)).toMatchObject({
      "x-goog-api-key": "test-key",
      "Content-Type": "application/json",
    });
  });

  it("removes router-only model and stream fields from native Gemini bodies", () => {
    const executor = new DefaultExecutor("gemini");
    const body = {
      model: "gemini-2.5-flash",
      stream: false,
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      generationConfig: { maxOutputTokens: 32 },
    };

    const transformed = executor.transformRequest("gemini-2.5-flash", body);

    expect(transformed).toEqual({
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      generationConfig: { maxOutputTokens: 32 },
    });
  });
});
