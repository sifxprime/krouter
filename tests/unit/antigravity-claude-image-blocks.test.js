/**
 * 0.5.169 — an image sent to a Claude model on Antigravity must reach the model.
 *
 * wrapInCloudCodeEnvelopeForClaude converts Claude blocks into Gemini parts with an
 * explicit branch list: text, tool_use, tool_result, plus a string fallback. An image
 * block matched none of them and was dropped. The request then returned HTTP 200 and the
 * model answered as though nothing had been attached — billed, logged as a success, and
 * indistinguishable from a normal reply unless you knew what the picture contained.
 *
 * Reproduced on a live install with a 96x96 solid-red PNG and "What colour is this image?":
 *   cc/claude-opus-5           -> "Red"
 *   kr/claude-sonnet-4.5       -> "Red"
 *   ag/claude-sonnet-5-5-high  -> "I can't answer that because no image came through."
 * and after the fix all four tested models, over both the OpenAI and the Anthropic
 * protocol, answered "Red".
 *
 * The assertion is on the translated envelope rather than on a live call: the point is
 * that the bytes are present in what we send, which is exactly what was missing.
 */
import { describe, it, expect } from "vitest";
import {
  claudeMediaBlockToGeminiPart,
  isClaudeMediaBlock,
} from "../../open-sse/translator/helpers/geminiHelper.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const imageBlock = () => ({
  type: "image",
  source: { type: "base64", media_type: "image/png", data: PNG },
});

describe("a Claude media block is recognised", () => {
  it.each(["image", "document", "audio", "video"])("%s with a source is media", (type) => {
    expect(isClaudeMediaBlock({ type, source: { type: "base64", data: "x" } })).toBe(true);
  });

  it.each([
    ["text", { type: "text", text: "hi" }],
    ["tool_use", { type: "tool_use", id: "t", name: "f", input: {} }],
    ["tool_result", { type: "tool_result", tool_use_id: "t", content: "ok" }],
    ["image with no source", { type: "image" }],
    ["null", null],
    ["undefined", undefined],
  ])("%s is not media", (_n, block) => {
    expect(isClaudeMediaBlock(block)).toBe(false);
  });
});

describe("base64 media becomes inlineData with its bytes intact", () => {
  it("carries the data through unchanged", () => {
    const part = claudeMediaBlockToGeminiPart(imageBlock());
    expect(part).toEqual({ inlineData: { mime_type: "image/png", data: PNG } });
  });

  it("uses Anthropic's media_type", () => {
    const b = imageBlock();
    b.source.media_type = "image/jpeg";
    expect(claudeMediaBlockToGeminiPart(b).inlineData.mime_type).toBe("image/jpeg");
  });

  it("accepts mimeType, which some clients send instead", () => {
    const part = claudeMediaBlockToGeminiPart({
      type: "image",
      source: { type: "base64", mimeType: "image/webp", data: PNG },
    });
    expect(part.inlineData.mime_type).toBe("image/webp");
  });

  it("carries a PDF document through", () => {
    const part = claudeMediaBlockToGeminiPart({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
    });
    expect(part).toEqual({ inlineData: { mime_type: "application/pdf", data: "JVBERi0=" } });
  });
});

describe("url media becomes fileData", () => {
  it("maps a url source to fileData", () => {
    const part = claudeMediaBlockToGeminiPart({
      type: "image",
      source: { type: "url", url: "https://example.com/a.png", media_type: "image/png" },
    });
    expect(part).toEqual({ fileData: { fileUri: "https://example.com/a.png", mimeType: "image/png" } });
  });

  it("falls back to a CONCRETE mime for an image url with no type, never the wildcard", () => {
    // Deliberately not "image/*": Antigravity rejects a wildcard image mime with a 400
    // (the upstream fix for that is a known gap, see the audit's image/* finding), and
    // convertOpenAIContentToParts still sends one on its own http-url path. A concrete
    // type may be a guess, but it is a guess the backend accepts.
    const part = claudeMediaBlockToGeminiPart({
      type: "image",
      source: { type: "url", url: "https://example.com/a" },
    });
    expect(part.fileData.mimeType).toBe("image/png");
    expect(part.fileData.mimeType).not.toContain("*");
  });

  it("a non-image media url with no type still gets a type rather than undefined", () => {
    const part = claudeMediaBlockToGeminiPart({
      type: "audio",
      source: { type: "url", url: "https://example.com/a.wav" },
    });
    expect(typeof part.fileData.mimeType).toBe("string");
    expect(part.fileData.mimeType.length).toBeGreaterThan(0);
  });
});

describe("it never emits a junk part", () => {
  it.each([
    ["a source with neither data nor url", { type: "image", source: { type: "base64" } }],
    ["a non-media block", { type: "text", text: "hi" }],
    ["null", null],
  ])("%s yields null", (_n, block) => {
    expect(claudeMediaBlockToGeminiPart(block)).toBeNull();
  });
});

describe("the Antigravity Claude translator uses it", () => {
  it("the image branch is wired into the block loop", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("open-sse/translator/request/openai-to-gemini.js", "utf8");
    expect(src).toContain("isClaudeMediaBlock(block)");
    expect(src).toContain("claudeMediaBlockToGeminiPart(block)");
    // It must be checked BEFORE tool_use/tool_result, or an image never reaches it.
    expect(src.indexOf("isClaudeMediaBlock(block)")).toBeLessThan(
      src.indexOf('block.type === "tool_result"'),
    );
  });
});
