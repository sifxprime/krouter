/**
 * An OpenAI Responses usage body ({input_tokens, output_tokens,
 * input_tokens_details:{cached_tokens}}) matches the Claude branch of
 * extractUsageFromResponse, which read neither field — so every /v1/responses and
 * codex request logged a zero cache read even when the provider reported a hit.
 *
 * Ported from upstream e7dd72a8.
 */
import { describe, expect, it } from "vitest";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";

describe("cache tokens survive usage extraction", () => {
  it("reads cached_tokens out of a Responses-shaped body", () => {
    const u = extractUsageFromResponse({
      usage: { input_tokens: 1200, output_tokens: 300, input_tokens_details: { cached_tokens: 1024 } },
    });
    expect(u.prompt_tokens).toBe(1200);
    expect(u.completion_tokens).toBe(300);
    expect(u.cached_tokens).toBe(1024);
  });

  it("prefers a top-level cached_tokens when the provider sends one", () => {
    const u = extractUsageFromResponse({
      usage: { input_tokens: 10, output_tokens: 2, cached_tokens: 7, input_tokens_details: { cached_tokens: 3 } },
    });
    expect(u.cached_tokens).toBe(7);
  });

  it("leaves a real Claude body's cache fields intact", () => {
    const u = extractUsageFromResponse({
      usage: {
        input_tokens: 50, output_tokens: 5,
        cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
      },
    });
    expect(u.cache_read_input_tokens).toBe(40);
    expect(u.cache_creation_input_tokens).toBe(10);
    expect(u.cached_tokens).toBeUndefined();
  });

  it("still reads the chat-completions shape", () => {
    const u = extractUsageFromResponse({
      usage: {
        prompt_tokens: 100, completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 64 },
        completion_tokens_details: { reasoning_tokens: 8 },
      },
    });
    expect(u.cached_tokens).toBe(64);
    expect(u.reasoning_tokens).toBe(8);
  });

  it("returns null for a body with no usage at all", () => {
    expect(extractUsageFromResponse({})).toBeNull;
    expect(extractUsageFromResponse(null)).toBeNull();
  });
});
