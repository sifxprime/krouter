/**
 * OpenCode Go serves its Qwen models on /messages (Anthropic format), like MiniMax.
 * Every revision of the Go docs' endpoint table since 2026-05-23
 * (anomalyco/opencode 6b03be5468) lists each Qwen model under
 * https://opencode.ai/zen/go/v1/messages with @ai-sdk/anthropic (today 3.8 Max, 3.8 Flash
 * and 3.7 Plus; older ids until they were dropped), and models.dev moved 3.7 Plus and
 * 3.8 Max to @ai-sdk/anthropic on 2026-10-04 (#8745). A request with a real Go key to
 * /chat/completions answers 400 ModelProtocolUnsupported for Qwen 3.7 Max, the
 * same failure as #23 (weselben-orion/GoModel#1, #2). kRouter sent them all to
 * /chat/completions.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROVIDER_MODELS, getDefaultTransport } from "../../open-sse/config/providerModels.js";
import {
  OpenCodeGoExecutor,
  openCodeGoTargetFormat,
  openCodeGoTransport,
} from "../../open-sse/executors/opencode-go.js";

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, proxyAwareFetch: vi.fn() };
});

const BASE = "https://opencode.ai/zen/go/v1";
const creds = (overrides) => ({
  apiKey: "k",
  connectionId: "c",
  ...(overrides ? { modelTransports: overrides } : {}),
});
const qwenIds = PROVIDER_MODELS["opencode-go"].map((m) => m.id).filter((id) => id.startsWith("qwen"));

describe("OpenCode Go Qwen models", () => {
  it("the catalog still lists Qwen models", () => {
    expect(qwenIds).toEqual(expect.arrayContaining(["qwen3.8-max", "qwen3.8-flash", "qwen3.7-plus"]));
  });

  it.each(qwenIds)("%s goes to /messages with x-api-key and a Claude body", (id) => {
    const exec = new OpenCodeGoExecutor();
    const url = exec.buildUrl(id, true, 0, creds());
    const headers = exec.buildHeaders(creds(), true, url, id);
    expect(getDefaultTransport("opencode-go", id)).toBe("messages");
    expect(url).toBe(`${BASE}/messages`);
    expect(headers["x-api-key"]).toBe("k");
    expect(headers.Authorization).toBeUndefined();
    expect(exec.resolveTargetFormat(id, creds())).toBe("claude");
  });

  it("a per-model Protocol override can still send Qwen to /chat/completions", () => {
    const c = creds({ "qwen3.8-max": "chat" });
    expect(openCodeGoTransport("qwen3.8-max", c)).toBe("chat");
    expect(openCodeGoTargetFormat("qwen3.8-max", c)).toBe("openai");
    expect(new OpenCodeGoExecutor().buildUrl("qwen3.8-max", true, 0, c)).toBe(`${BASE}/chat/completions`);
  });
});

// The whole pipeline, as MiniMax already runs it: an OpenAI client's request is sent
// as a Claude body and the Claude reply comes back to it as a chat completion.
describe("OpenCode Go Qwen through handleChatCore", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "krouter-ocg-qwen-"));
  let handleChatCore;
  let proxyAwareFetch;
  const sse = (events) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  const CLAUDE_SSE = sse([
    ["message_start", { type: "message_start", message: { id: "msg_q1", type: "message", role: "assistant", model: "qwen3.8-max", content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello there" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }],
    ["message_stop", { type: "message_stop" }],
  ]);
  const CLAUDE_JSON = JSON.stringify({ id: "msg_q1", type: "message", role: "assistant", model: "qwen3.8-max",
    content: [{ type: "text", text: "Hello there" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 2 } });

  beforeAll(async () => {
    process.env.DATA_DIR = dataDir;
    await import("../translator/registerAll.js");
    ({ proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js"));
    ({ handleChatCore } = await import("../../open-sse/handlers/chatCore.js"));
  });
  afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockImplementation((url, init) => {
      const streaming = JSON.parse(init.body).stream === true;
      return Promise.resolve(new Response(streaming ? CLAUDE_SSE : CLAUDE_JSON, {
        status: 200, headers: { "Content-Type": streaming ? "text/event-stream" : "application/json" },
      }));
    });
  });

  const run = (stream) => handleChatCore({
    body: { model: "ocg/qwen3.8-max", stream, max_tokens: 64, messages: [{ role: "user", content: "Say hello" }] },
    modelInfo: { provider: "opencode-go", model: "qwen3.8-max" },
    credentials: { apiKey: "test-key", connectionId: "conn-test" },
    connectionId: "conn-test",
  });
  const upstream = () => ({ url: proxyAwareFetch.mock.calls[0][0], init: proxyAwareFetch.mock.calls[0][1] });

  it("sends a Claude body to /messages", async () => {
    const result = await run(false);
    expect(result.success).toBe(true);
    const { url, init } = upstream();
    expect(url).toBe(`${BASE}/messages`);
    const body = JSON.parse(init.body);
    expect(body.messages[0].role).toBe("user");
    expect(body.max_tokens).toBe(64);
    // Only a translated Claude body has these: system as blocks, no system-role message.
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.messages.some((m) => m.role === "system")).toBe(false);
    expect(init.headers["x-api-key"]).toBe("test-key");
  });

  it("OpenAI client, non-streaming: a chat.completion with the text", async () => {
    const json = await (await run(false)).response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("Hello there");
  });

  it("OpenAI client, streaming: chat.completion.chunk SSE with the text", async () => {
    const text = await (await run(true)).response.text();
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("Hello there");
  });
});
