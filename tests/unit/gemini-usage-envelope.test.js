import { describe, it, expect } from "vitest";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";

// upstream 59d858b6 — Antigravity/gemini-cli wrap the payload in { response: {...} }.
describe("0.5.140 Gemini usage extraction (both envelope shapes)", () => {
  const meta = { promptTokenCount: 1200, candidatesTokenCount: 50, cachedContentTokenCount: 900, thoughtsTokenCount: 30 };

  it("reads a bare usageMetadata payload", () => {
    expect(extractUsageFromResponse({ usageMetadata: meta })).toEqual({
      prompt_tokens: 1200, completion_tokens: 50, cached_tokens: 900, reasoning_tokens: 30,
    });
  });

  it("reads the WRAPPED { response: { usageMetadata } } payload (Antigravity)", () => {
    expect(extractUsageFromResponse({ response: { usageMetadata: meta } })).toEqual({
      prompt_tokens: 1200, completion_tokens: 50, cached_tokens: 900, reasoning_tokens: 30,
    });
  });

  it("keeps cached_tokens on the wrapped shape (the residual gap this closes)", () => {
    const u = extractUsageFromResponse({ response: { usageMetadata: meta } });
    expect(u.cached_tokens).toBe(900); // previously dropped -> cached prompts billed as fresh
  });

  it("missing counters default to 0, not undefined", () => {
    expect(extractUsageFromResponse({ usageMetadata: {} })).toEqual({
      prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0, reasoning_tokens: 0,
    });
  });
});
