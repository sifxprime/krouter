/**
 * Providers kRouter always streams (openai, codebuddy-cn, ...) answer a
 * non-streaming client through handleForcedSSEToJson. Two bugs there, found while
 * reviewing #23: a /v1/responses client's CHAT stream was parsed as Responses
 * events (keyed on the client's format, not the upstream's) -> empty reply; and
 * every client got the raw chat.completion back, Claude and Responses clients too.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, proxyAwareFetch: vi.fn() };
});

const dataDir = mkdtempSync(join(tmpdir(), "krouter-forced-"));
let handleChatCore;
let proxyAwareFetch;
const CHAT_SSE = [
  { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "Hi" } }] },
  { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: " there" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";

beforeAll(async () => {
  process.env.DATA_DIR = dataDir;
  await import("../translator/registerAll.js");
  ({ proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js"));
  ({ handleChatCore } = await import("../../open-sse/handlers/chatCore.js"));
});
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
beforeEach(() => {
  proxyAwareFetch.mockReset();
  proxyAwareFetch.mockImplementation(() => Promise.resolve(new Response(CHAT_SSE, { status: 200, headers: { "Content-Type": "text/event-stream" } })));
});

const run = (body, sourceFormatOverride) => handleChatCore({
  body, modelInfo: { provider: "openai", model: "gpt-4o" },
  credentials: { apiKey: "test-key", connectionId: "conn-openai" }, connectionId: "conn-openai", sourceFormatOverride,
});

describe("forced-stream provider, non-streaming clients", () => {
  it("a Responses client gets a Responses object with the text", async () => {
    const json = await (await run({ model: "openai/gpt-4o", stream: false, input: "hello" }, "openai-responses")).response.json();
    expect(json.object).toBe("response");
    expect(json.output.find((o) => o.type === "message").content[0].text).toBe("Hi there");
  });

  it("a Claude client gets a Claude message", async () => {
    const json = await (await run({ model: "openai/gpt-4o", stream: false, max_tokens: 32, messages: [{ role: "user", content: "hello" }] }, "claude")).response.json();
    expect(json.type).toBe("message");
    expect(json.content.find((b) => b.type === "text").text).toBe("Hi there");
  });

  it("an OpenAI client still gets a chat.completion", async () => {
    const json = await (await run({ model: "openai/gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] })).response.json();
    expect(json.choices[0].message.content).toBe("Hi there");
  });
});
