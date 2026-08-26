import { describe, it, expect } from "vitest";
import { geminiFinishReasonToOpenAI } from "../../open-sse/utils/geminiFinishReason.js";
import { convertFinishReason } from "../../open-sse/translator/response/openai-to-claude.js";

/**
 * Both the streaming and non-streaming Gemini paths lower-cased Gemini's finishReason
 * and passed it off as an OpenAI value. Gemini says MAX_TOKENS where OpenAI says
 * "length", so this produced "max_tokens" -- not an OpenAI finish_reason at all.
 * convertFinishReason did not recognise it, fell through to its default, and a Claude
 * client was told a truncated answer had finished cleanly with end_turn.
 *
 * The non-streaming path was fixed first and the streaming path kept the bug, which is
 * why the mapping now lives in one module both import.
 */
describe("gemini finish reason mapping", () => {
  it("maps truncation to the OpenAI value, not a lower-cased Gemini one", () => {
    expect(geminiFinishReasonToOpenAI("MAX_TOKENS")).toBe("length");
    expect(geminiFinishReasonToOpenAI("MAX_TOKENS")).not.toBe("max_tokens");
  });

  it("survives the second hop into Claude's vocabulary", () => {
    // This is the composition that actually reached the user.
    expect(convertFinishReason(geminiFinishReasonToOpenAI("MAX_TOKENS"))).toBe("max_tokens");
    expect(convertFinishReason(geminiFinishReasonToOpenAI("STOP"))).toBe("end_turn");
  });

  it("maps the content-policy stops to content_filter", () => {
    for (const r of ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"]) {
      expect(geminiFinishReasonToOpenAI(r)).toBe("content_filter");
    }
  });

  it("treats a normal stop as a normal stop, case-insensitively", () => {
    expect(geminiFinishReasonToOpenAI("STOP")).toBe("stop");
    expect(geminiFinishReasonToOpenAI("stop")).toBe("stop");
  });

  it("falls back to stop for anything Google adds later, and for nothing at all", () => {
    expect(geminiFinishReasonToOpenAI("SOMETHING_NEW")).toBe("stop");
    expect(geminiFinishReasonToOpenAI(null)).toBe("stop");
    expect(geminiFinishReasonToOpenAI(undefined)).toBe("stop");
    expect(geminiFinishReasonToOpenAI("")).toBe("stop");
  });

  it("is used by both the streaming and non-streaming paths", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of [
      "open-sse/translator/response/gemini-to-openai.js",
      "open-sse/handlers/chatCore/nonStreamingHandler.js",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} must use the shared mapping`).toContain("geminiFinishReasonToOpenAI");
      expect(src, `${f} must not lower-case the raw reason`).not.toMatch(/finishReason\s*\|\|\s*"STOP"\)\.toLowerCase\(\)/);
    }
  });
});
