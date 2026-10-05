/**
 * End to end through handleChatCore for an OpenCode Go Responses-only model (#23).
 * The upstream is mocked with real Responses-API SSE; every client format, both
 * streaming and not, must get a correct reply in its OWN format. Non-streaming is
 * the case that has broken before (each provider needs its ->CLAUDE branch, and a
 * Responses client used to get a raw chat.completion back).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, proxyAwareFetch: vi.fn() };
});

const dataDir = mkdtempSync(join(tmpdir(), "krouter-ocg-pipeline-"));
let handleChatCore;
let proxyAwareFetch;

const sse = (events) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
const RESPONSES_SSE = sse([
  ["response.created", { type: "response.created", response: { id: "resp_up1", object: "response", status: "in_progress", model: "grok-4.6", output: [] } }],
  ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_up1", role: "assistant", content: [] } }],
  ["response.output_text.delta", { type: "response.output_text.delta", item_id: "msg_up1", output_index: 0, content_index: 0, delta: "Hello" }],
  ["response.output_text.delta", { type: "response.output_text.delta", item_id: "msg_up1", output_index: 0, content_index: 0, delta: " there" }],
  ["response.output_text.done", { type: "response.output_text.done", item_id: "msg_up1", output_index: 0, content_index: 0, text: "Hello there" }],
  ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_up1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Hello there", annotations: [] }] } }],
  ["response.completed", { type: "response.completed", response: { id: "resp_up1", object: "response", status: "completed", model: "grok-4.6",
    output: [{ type: "message", id: "msg_up1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Hello there", annotations: [] }] }],
    usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } } }],
]);

beforeAll(async () => {
  process.env.DATA_DIR = dataDir; // anything chatCore records goes here, not ~/.krouter
  await import("../translator/registerAll.js");
  ({ proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js"));
  ({ handleChatCore } = await import("../../open-sse/handlers/chatCore.js"));
});
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
beforeEach(() => {
  proxyAwareFetch.mockReset();
  proxyAwareFetch.mockImplementation(() => Promise.resolve(new Response(RESPONSES_SSE, {
    status: 200, headers: { "Content-Type": "text/event-stream" },
  })));
});

const run = (body, sourceFormatOverride) => handleChatCore({
  body,
  modelInfo: { provider: "opencode-go", model: "grok-4.6" },
  credentials: { apiKey: "test-key", connectionId: "conn-test" },
  connectionId: "conn-test",
  sourceFormatOverride,
});
const upstream = () => ({ url: proxyAwareFetch.mock.calls[0][0], body: JSON.parse(proxyAwareFetch.mock.calls[0][1].body) });
const messages = [{ role: "user", content: "Say hello" }];

describe("OpenCode Go Responses-only model through the whole pipeline", () => {
  it("sends a Responses body to /responses", async () => {
    const result = await run({ model: "ocg/grok-4.6", stream: false, max_tokens: 64, messages });
    expect(result.success).toBe(true);
    const { url, body } = upstream();
    expect(url).toBe("https://opencode.ai/zen/go/v1/responses");
    expect(Array.isArray(body.input)).toBe(true);
    expect(body).not.toHaveProperty("messages");
    expect(body.max_output_tokens).toBe(64);
  });

  it("OpenAI client, non-streaming: a chat.completion with the text", async () => {
    const result = await run({ model: "ocg/grok-4.6", stream: false, max_tokens: 64, messages });
    const json = await result.response.json();
    expect(json.choices[0].message.content).toBe("Hello there");
    // Output passes through as is; prompt counts carry kRouter's deliberate 2000-token
    // safety buffer (usageTracking.js BUFFER_TOKENS), so only check they arrived.
    expect(json.usage?.completion_tokens).toBe(2);
    expect(json.usage?.prompt_tokens).toBeGreaterThanOrEqual(5);
  });

  it("OpenAI client, streaming: chat chunks with the text", async () => {
    const result = await run({ model: "ocg/grok-4.6", stream: true, max_tokens: 64, messages });
    const text = await result.response.text();
    const content = [...text.matchAll(/"content":"([^"]*)"/g)].map((m) => m[1]).join("");
    expect(content).toBe("Hello there");
    expect(text).toContain("finish_reason");
  });

  it("Claude client, non-streaming: a Claude message", async () => {
    const result = await run({ model: "ocg/grok-4.6", stream: false, max_tokens: 64, messages }, "claude");
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.content.find((b) => b.type === "text")?.text).toBe("Hello there");
  });

  it("Claude client, streaming: Claude events", async () => {
    const result = await run({ model: "ocg/grok-4.6", stream: true, max_tokens: 64, messages }, "claude");
    const text = await result.response.text();
    expect(text).toContain("event: message_start");
    const deltas = [...text.matchAll(/"text_delta","text":"([^"]*)"/g)].map((m) => m[1]).join("");
    expect(deltas).toBe("Hello there");
    expect(text).toContain("event: message_stop");
  });

  it("Responses client, non-streaming: a Responses object", async () => {
    const result = await run({ model: "ocg/grok-4.6", stream: false, max_output_tokens: 64, input: "Say hello" }, "openai-responses");
    const json = await result.response.json();
    expect(json.object).toBe("response");
    expect(json.status).toBe("completed");
    const msg = json.output.find((o) => o.type === "message");
    expect(msg.content[0].text).toBe("Hello there");
  });

  it("Responses client, streaming: Responses events", async () => {
    const result = await run({ model: "ocg/grok-4.6", stream: true, max_output_tokens: 64, input: "Say hello" }, "openai-responses");
    const text = await result.response.text();
    const deltas = [...text.matchAll(/"type":"response\.output_text\.delta"[^}]*"delta":"([^"]*)"/g)].map((m) => m[1]).join("");
    expect(deltas).toBe("Hello there");
    expect(text).toContain("response.completed");
  });
});

const respondWith = (text, status = 200, type = "text/event-stream") => proxyAwareFetch.mockImplementation(
  () => Promise.resolve(new Response(text, { status, headers: { "Content-Type": type } })));
const START = [
  ["response.created", { type: "response.created", response: { id: "resp_x", status: "in_progress", output: [] } }],
  ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_x", role: "assistant", content: [] } }],
  ["response.output_text.delta", { type: "response.output_text.delta", item_id: "msg_x", output_index: 0, content_index: 0, delta: "Partial" }],
];

describe("replies that do not complete normally (review findings)", () => {
  const INCOMPLETE = sse([...START, ["response.incomplete", { type: "response.incomplete", response: {
    id: "resp_x", status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
    usage: { input_tokens: 5, output_tokens: 16, total_tokens: 21 } } }]]);

  it("cut off by the token limit: OpenAI non-stream says length, with usage", async () => {
    respondWith(INCOMPLETE);
    const json = await (await run({ model: "ocg/grok-4.6", stream: false, max_tokens: 16, messages })).response.json();
    expect(json.choices[0].finish_reason).toBe("length");
    expect(json.usage?.completion_tokens).toBe(16);
  });

  it("cut off by the token limit: a Claude stream still ends, with max_tokens", async () => {
    respondWith(INCOMPLETE);
    const text = await (await run({ model: "ocg/grok-4.6", stream: true, max_tokens: 16, messages }, "claude")).response.text();
    expect(text).toContain("event: message_stop");
    expect(text).toContain('"stop_reason":"max_tokens"');
  });

  it("cut off by the token limit: a Responses client gets status incomplete", async () => {
    respondWith(INCOMPLETE);
    const json = await (await run({ model: "ocg/grok-4.6", stream: false, max_output_tokens: 16, input: "hi" }, "openai-responses")).response.json();
    expect(json.status).toBe("incomplete");
    expect(json.usage?.total_tokens).toBeGreaterThan(0);
    expect(json).not.toHaveProperty("created");
  });

  it("a stream cut with no terminal event still closes a Claude reply", async () => {
    respondWith(sse(START));
    const text = await (await run({ model: "ocg/grok-4.6", stream: true, max_tokens: 64, messages }, "claude")).response.text();
    expect(text).toContain("event: message_stop");
  });

  it("response.failed is an error for non-streaming clients, not a 200", async () => {
    respondWith(sse([...START, ["response.failed", { type: "response.failed", response: { id: "resp_x", status: "failed",
      error: { code: "rate_limit_exceeded", message: "Slow down" } } }]]));
    const result = await run({ model: "ocg/grok-4.6", stream: false, max_tokens: 64, messages });
    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
  });

  it("the spec's top-level error event is recognised too", async () => {
    respondWith(sse([...START, ["error", { type: "error", code: "server_error", message: "Upstream broke" }]]));
    const result = await run({ model: "ocg/grok-4.6", stream: false, max_tokens: 64, messages });
    expect(result.success).toBe(false);
  });
});

describe("tools and settings through the pipeline", () => {
  const TOOL_SSE = sse([
    ["response.created", { type: "response.created", response: { id: "resp_t", status: "in_progress", output: [] } }],
    ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "read_file", arguments: "" } }],
    ["response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: "{\"path\":\"a.txt\"}" }],
    ["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "read_file", arguments: "{\"path\":\"a.txt\"}" } }],
    ["response.completed", { type: "response.completed", response: { id: "resp_t", status: "completed", usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 } } }],
  ]);
  const tools = [{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } } } }];

  it("a tool call reaches an OpenAI client as tool_calls", async () => {
    respondWith(TOOL_SSE);
    const json = await (await run({ model: "ocg/grok-4.6", stream: false, max_tokens: 64, messages, tools })).response.json();
    const call = json.choices[0].message.tool_calls[0];
    expect(call.function.name).toBe("read_file");
    expect(JSON.parse(call.function.arguments)).toEqual({ path: "a.txt" });
    expect(json.choices[0].finish_reason).toBe("tool_calls");
  });

  it("a tool call reaches a Claude client as tool_use", async () => {
    respondWith(TOOL_SSE);
    const json = await (await run({ model: "ocg/grok-4.6", stream: false, max_tokens: 64, messages,
      tools: [{ name: "read_file", input_schema: { type: "object", properties: { path: { type: "string" } } } }] }, "claude")).response.json();
    const use = json.content.find((b) => b.type === "tool_use");
    expect(use.name).toBe("read_file");
    expect(use.input).toEqual({ path: "a.txt" });
  });

  it("a Responses client's reasoning effort reaches OpenCode", async () => {
    await run({ model: "ocg/grok-4.6", stream: true, max_output_tokens: 64, input: "hi", reasoning: { effort: "high" } }, "openai-responses");
    expect(upstream().body.reasoning).toEqual({ effort: "high", summary: "auto" });
  });

  it("JSON mode is sent as text.format", async () => {
    await run({ model: "ocg/grok-4.6", stream: false, max_tokens: 64, messages, response_format: { type: "json_object" } });
    expect(upstream().body.text).toEqual({ format: { type: "json_object" } });
  });

  it("a protocol override sends the request where it says", async () => {
    await handleChatCore({
      body: { model: "ocg/grok-4.6", stream: false, max_tokens: 64, messages },
      modelInfo: { provider: "opencode-go", model: "grok-4.6" },
      credentials: { apiKey: "test-key", connectionId: "conn-test", modelTransports: { "grok-4.6": "chat" } },
      connectionId: "conn-test",
    });
    expect(upstream().url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(upstream().body).toHaveProperty("messages");
  });
});

describe("OpenCode's ModelError", () => {
  it("is reported as 400, not 401, so the account is not cooled down", async () => {
    respondWith(JSON.stringify({ type: "error", error: { type: "ModelError", message: "Model x is not supported for format oa-compat" } }), 401, "application/json");
    const result = await run({ model: "ocg/grok-4.6", stream: false, max_tokens: 64, messages });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });

  it("a real auth failure stays 401", async () => {
    respondWith(JSON.stringify({ type: "error", error: { type: "AuthError", message: "Invalid API key." } }), 401, "application/json");
    const result = await run({ model: "ocg/grok-4.6", stream: false, max_tokens: 64, messages });
    expect(result.status).toBe(401);
  });
});
