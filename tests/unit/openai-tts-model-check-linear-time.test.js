/**
 * OpenAI TTS: recognising a bare speech model id must not backtrack on long
 * input. The model string comes straight from the request body, so a ~100 KB
 * value must resolve (as a voice) in a few milliseconds, not block the event loop.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import openaiTts from "../../open-sse/handlers/ttsProviders/openai.js";

const originalFetch = global.fetch;
const credentials = { apiKey: "test-key" };
const MAX_ELAPSED_MS = 500;

beforeEach(() => {
  global.fetch = vi.fn(async () =>
    new Response(new Uint8Array(16), { status: 200, headers: { "Content-Type": "audio/mpeg" } }),
  );
});

afterEach(() => {
  global.fetch = originalFetch;
});

const sentToOpenAI = () => {
  const { model, voice } = JSON.parse(global.fetch.mock.calls.at(-1)[1].body);
  return { model, voice };
};

describe("OpenAI TTS model id check", () => {
  it("resolves a ~100 KB adversarial model string quickly, as a voice", async () => {
    const adversarial = "gpt-" + "-tts".repeat(25_000) + "!";

    const started = performance.now();
    await openaiTts.synthesize("Hello", adversarial, credentials);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(MAX_ELAPSED_MS);
    expect(sentToOpenAI()).toEqual({ model: "gpt-4o-mini-tts", voice: adversarial });
  });

  it("still recognises a dated speech model snapshot", async () => {
    await openaiTts.synthesize("Hello", "gpt-4o-mini-tts-2025-12-15", credentials);
    expect(sentToOpenAI()).toEqual({ model: "gpt-4o-mini-tts-2025-12-15", voice: "alloy" });
  });
});
