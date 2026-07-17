import { describe, it, expect } from "vitest";
import { getImageAdapter, isImageProvider } from "../../open-sse/handlers/imageProviders/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

// 0.5.107 (upstream 5306bd90) — Antigravity native image generation.
describe("Antigravity image generation wiring", () => {
  it("antigravity is registered as an image provider", () => {
    expect(isImageProvider("antigravity")).toBe(true);
    expect(getImageAdapter("antigravity")).toBeTruthy();
  });

  it("the adapter delegates to the executor (not manual URL building)", () => {
    const a = getImageAdapter("antigravity");
    expect(a.useExecutor).toBe(true);
    expect(typeof a.executeViaExecutor).toBe("function");
    // Stubs still present so it satisfies the imageGenerationCore interface.
    expect(typeof a.buildUrl).toBe("function");
    expect(typeof a.buildHeaders).toBe("function");
    expect(typeof a.normalize).toBe("function");
  });

  it("provider manifest declares the image service kind", () => {
    expect(AI_PROVIDERS.antigravity.serviceKinds).toContain("image");
    expect(AI_PROVIDERS.antigravity.serviceKinds).toContain("llm");
  });

  it("publishes only image models Google actually serves", () => {
    const ids = PROVIDER_MODELS.ag.map((m) => m.id);
    expect(ids).toContain("gemini-3.1-flash-image");
    // 0.5.108 — upstream lists gemini-3-pro-image but Google 404s it on every
    // account we tested; we deliberately don't publish it (see providerModels.js).
    expect(ids).not.toContain("gemini-3-pro-image");
    expect(PROVIDER_MODELS.ag.filter((m) => m.type === "image")).toHaveLength(1);
  });

  it("normalize() converts Gemini inlineData parts to OpenAI b64_json shape", () => {
    const a = getImageAdapter("antigravity");
    const out = a.normalize({
      candidates: [{ content: { parts: [
        { text: "here you go" },
        { inlineData: { mimeType: "image/png", data: "AAAB" } },
      ] } }],
    }, "a cat");
    expect(Array.isArray(out.data)).toBe(true);
    expect(out.data[0].b64_json).toBe("AAAB");
    expect(typeof out.created).toBe("number");
  });

  it("normalize() falls back to an empty entry when no image parts returned", () => {
    const a = getImageAdapter("antigravity");
    const out = a.normalize({ candidates: [{ content: { parts: [{ text: "refused" }] } }] }, "a cat");
    expect(out.data).toHaveLength(1);
    expect(out.data[0].b64_json).toBe("");
    expect(out.data[0].revised_prompt).toBe("a cat");
  });

  it("normalize() handles the nested response.candidates shape", () => {
    const a = getImageAdapter("antigravity");
    const out = a.normalize({
      response: { candidates: [{ content: { parts: [{ inlineData: { data: "XYZ" } }] } }] },
    }, "p");
    expect(out.data[0].b64_json).toBe("XYZ");
  });
});

describe("Antigravity executor — image model handling", () => {
  const ex = () => getExecutor("antigravity");
  const creds = { projectId: "proj-1", email: "u@gmail.com", connectionId: "c1" };

  it("forces NON-streaming generateContent for image models even when stream=true", () => {
    // Image gen must not stream — Google returns the image in one shot.
    expect(ex().buildUrl("gemini-3.1-flash-image", true)).toContain("generateContent");
    expect(ex().buildUrl("gemini-3.1-flash-image", true)).not.toContain("streamGenerateContent");
    expect(ex().buildUrl("gemini-3-pro-image", true)).not.toContain("streamGenerateContent");
  });

  it("still streams for normal chat models (no regression)", () => {
    expect(ex().buildUrl("gemini-3-flash-agent", true)).toContain("streamGenerateContent");
    expect(ex().buildUrl("gemini-3-flash-agent", false)).toContain("generateContent");
  });

  it("builds the image_gen envelope for image models", () => {
    const out = ex().transformRequest(
      "gemini-3.1-flash-image",
      { request: { contents: [{ role: "user", parts: [{ text: "a red cube" }] }] } },
      false,
      creds,
    );
    expect(out.requestType).toBe("image_gen");
    expect(out.model).toBe("gemini-3.1-flash-image");
    expect(out.project).toBe("proj-1");
    expect(out.request.generationConfig.imageConfig).toEqual({ aspectRatio: "1:1" });
    expect(out.request.contents).toEqual([{ role: "user", parts: [{ text: "a red cube" }] }]);
    // Image gen must NOT carry chat machinery.
    expect(out.request.tools).toBeUndefined();
    expect(out.request.systemInstruction).toBeUndefined();
    expect(out.request.safetySettings).toBeUndefined();
  });

  it("parses aspect ratio from a WxH model suffix and strips it from the model id", () => {
    const out = ex().transformRequest(
      "gemini-3.1-flash-image-16x9",
      { request: { contents: [{ role: "user", parts: [{ text: "p" }] }] } },
      false, creds,
    );
    expect(out.request.generationConfig.imageConfig.aspectRatio).toBe("16:9");
    expect(out.model).toBe("gemini-3.1-flash-image"); // suffix stripped
  });

  it("reduces a pixel resolution suffix to its aspect ratio", () => {
    const out = ex().transformRequest(
      "gemini-3-pro-image-1024x768",
      { request: { contents: [{ role: "user", parts: [{ text: "p" }] }] } },
      false, creds,
    );
    expect(out.request.generationConfig.imageConfig.aspectRatio).toBe("4:3"); // 1024:768 reduced
    expect(out.model).toBe("gemini-3-pro-image");
  });

  it("drops non-text parts (inlineData/thought) from image-gen contents", () => {
    const out = ex().transformRequest(
      "gemini-3-pro-image",
      { request: { contents: [{ role: "user", parts: [
        { text: "keep me" },
        { inlineData: { data: "junk" } },
        { thought: true },
      ] }] } },
      false, creds,
    );
    expect(out.request.contents[0].parts).toEqual([{ text: "keep me" }]);
  });

  it("normal chat models still use the agent envelope (no regression)", () => {
    const out = ex().transformRequest(
      "gemini-3-flash-agent",
      { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } },
      false, creds,
    );
    expect(out.requestType).toBe("agent");
    expect(out.request.generationConfig.imageConfig).toBeUndefined();
  });
});
