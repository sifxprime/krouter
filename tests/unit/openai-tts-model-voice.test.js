/**
 * OpenAI TTS: how the `model` string and the request-body `voice` become the
 * upstream { model, voice } sent to POST /v1/audio/speech.
 *
 * Model ids and voices per https://developers.openai.com/api/docs/guides/text-to-speech
 * and https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const authMocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
}));

vi.mock("@/sse/services/auth.js", () => authMocks);
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
  getComboByName: vi.fn(async () => null),
  getModelAliases: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
}));
vi.mock("@/sse/utils/logger.js", () => ({ request: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import { handleTts } from "@/sse/handlers/tts.js";

const originalFetch = global.fetch;
const credentials = { apiKey: "test-key" };

const audioResponse = () =>
  new Response(new Uint8Array(256), { status: 200, headers: { "Content-Type": "audio/mpeg" } });

// Upstream { model, voice } of the last OpenAI call
const sentToOpenAI = () => {
  const [url, init] = global.fetch.mock.calls.at(-1);
  expect(url).toBe("https://api.openai.com/v1/audio/speech");
  const { model, voice } = JSON.parse(init.body);
  return { model, voice };
};

const synth = async (model, voice) => {
  const result = await handleTtsCore({ provider: "openai", model, input: "Hello", credentials, voice });
  expect(result.success).toBe(true);
  return sentToOpenAI();
};

beforeEach(() => {
  global.fetch = vi.fn(async () => audioResponse());
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("OpenAI TTS model string", () => {
  it.each([
    "tts-1",
    "tts-1-hd",
    "gpt-4o-mini-tts",
    "gpt-4o-mini-tts-2025-12-15",
    "gpt-5-mini-tts",
  ])("treats bare speech model id %s as the model with the default voice", async (id) => {
    expect(await synth(id)).toEqual({ model: id, voice: "alloy" });
  });

  it("keeps a bare non-model value as the voice on gpt-4o-mini-tts", async () => {
    expect(await synth("nova")).toEqual({ model: "gpt-4o-mini-tts", voice: "nova" });
  });

  it("keeps model/voice working", async () => {
    expect(await synth("tts-1-hd/shimmer")).toEqual({ model: "tts-1-hd", voice: "shimmer" });
  });
});

describe("OpenAI TTS request-body voice", () => {
  it("uses the request voice when the model string names no voice", async () => {
    expect(await synth("tts-1", "coral")).toEqual({ model: "tts-1", voice: "coral" });
  });

  it("lets a voice named in the model string win over the request voice", async () => {
    expect(await synth("tts-1/alloy", "nova")).toEqual({ model: "tts-1", voice: "alloy" });
    expect(await synth("nova", "shimmer")).toEqual({ model: "gpt-4o-mini-tts", voice: "nova" });
  });

  it("passes a custom voice object through", async () => {
    expect(await synth("gpt-4o-mini-tts", { id: "voice_1234" })).toEqual({
      model: "gpt-4o-mini-tts",
      voice: { id: "voice_1234" },
    });
  });

  it("ignores an empty or malformed request voice", async () => {
    expect(await synth("tts-1", "  ")).toEqual({ model: "tts-1", voice: "alloy" });
    expect(await synth("tts-1", 42)).toEqual({ model: "tts-1", voice: "alloy" });
    expect(await synth("tts-1", { id: "" })).toEqual({ model: "tts-1", voice: "alloy" });
  });
});

describe("POST /v1/audio/speech forwards the OpenAI-style voice field", () => {
  it("reaches the OpenAI provider with the body voice", async () => {
    authMocks.getProviderCredentials.mockResolvedValueOnce({ ...credentials, connectionId: "c1", connectionName: "main" });
    const request = new Request("http://localhost/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/tts-1", voice: "coral", input: "Hello" }),
    });

    const res = await handleTts(request);

    expect(res.status).toBe(200);
    expect(sentToOpenAI()).toEqual({ model: "tts-1", voice: "coral" });
  });
});
