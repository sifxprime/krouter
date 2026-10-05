/**
 * OpenCode Go serves three wire protocols and each model accepts only some:
 *   /chat/completions  OpenAI body, bearer       (most models)
 *   /messages          Claude body, x-api-key    (MiniMax)
 *   /responses         Responses body, bearer    (grok, gpt-luna, Muse Spark)
 * The URL, the auth header and the body shape must agree, or the request fails in
 * a way that never names the real cause: #23 was seven models posted to
 * /chat/completions and answered "400 ModelProtocolUnsupported".
 *
 * Earlier this was two hand-kept lists (an executor Set and the catalog) kept in
 * step by a regex over the source. The executor now reads the catalog, so there is
 * one list; these tests check the behaviour that list must produce.
 */
import { describe, expect, it } from "vitest";

import { PROVIDER_MODELS, getDefaultModel } from "../../open-sse/config/providerModels.js";
import {
  OpenCodeGoExecutor,
  openCodeGoTransport,
  openCodeGoTargetFormat,
  toOpenCodeGoResponsesBody,
} from "../../open-sse/executors/opencode-go.js";

const BASE = "https://opencode.ai/zen/go/v1";
const creds = (overrides) => ({
  apiKey: "k",
  connectionId: "c",
  // chat.js attaches settings.providerModelTransports[provider] here per request.
  ...(overrides ? { modelTransports: overrides } : {}),
});
const table = PROVIDER_MODELS["opencode-go"];
const expected = (m) => (m.transport === "responses" ? "responses" : m.targetFormat === "claude" ? "messages" : "chat");

describe("OpenCode Go transport per model", () => {
  it.each(table.map((m) => [m.id, expected(m)]))("%s -> %s: URL, auth and body format agree", (id, transport) => {
    const exec = new OpenCodeGoExecutor();
    const url = exec.buildUrl(id, true, 0, creds());
    const headers = exec.buildHeaders(creds(), true, url, id);
    const path = { chat: "/chat/completions", messages: "/messages", responses: "/responses" }[transport];
    expect(url).toBe(`${BASE}${path}`);
    if (transport === "messages") {
      expect(headers["x-api-key"]).toBe("k");
      expect(headers.Authorization).toBeUndefined();
    } else {
      expect(headers.Authorization).toBe("Bearer k");
      expect(headers["x-api-key"]).toBeUndefined();
    }
    expect(headers["x-opencode-session"]).toMatch(/^ses_[0-9a-f]{32}$/);
    // chatCore shapes the body from this: Claude for /messages, OpenAI otherwise
    // (the executor itself converts OpenAI <-> Responses).
    expect(exec.resolveTargetFormat(id, creds())).toBe(transport === "messages" ? "claude" : "openai");
  });

  it("serves the seven models OpenCode only offers on /responses (#23)", () => {
    const responsesOnly = table.filter((m) => m.transport === "responses").map((m) => m.id).sort();
    expect(responsesOnly).toEqual([
      "gpt-5.6-luna", "gpt-6-luna", "grok-4.5", "grok-4.6", "grok-4.7",
      "muse-spark-1.2-contributor", "muse-spark-1.3-contributor",
    ]);
  });

  it("keeps a chat-completions model as the default that validation pings", () => {
    expect(openCodeGoTransport(getDefaultModel("opencode-go"))).toBe("chat");
  });

  it("uses the request's own model for auth, not the last one seen", () => {
    // The executor is a singleton; buildUrl for another request in between must not
    // decide this request's auth header.
    const exec = new OpenCodeGoExecutor();
    exec.buildUrl("minimax-m3");
    const headers = exec.buildHeaders(creds(), true, `${BASE}/responses`, "grok-4.6");
    expect(headers.Authorization).toBe("Bearer k");
    expect(headers["x-api-key"]).toBeUndefined();
  });
});

describe("protocol override", () => {
  it("wins over the catalog, for every protocol", () => {
    const c = creds({ "glm-5.1": "responses", "grok-4.6": "chat", "minimax-m3": "chat", "kimi-k3": "messages" });
    expect(openCodeGoTransport("glm-5.1", c)).toBe("responses");
    expect(openCodeGoTransport("grok-4.6", c)).toBe("chat");
    expect(openCodeGoTransport("minimax-m3", c)).toBe("chat");
    expect(openCodeGoTargetFormat("minimax-m3", c)).toBe("openai");
    expect(openCodeGoTargetFormat("kimi-k3", c)).toBe("claude");
    expect(new OpenCodeGoExecutor().buildUrl("glm-5.1", true, 0, c)).toBe(`${BASE}/responses`);
  });

  it("covers models kRouter's table does not know yet", () => {
    expect(openCodeGoTransport("grok-5", creds({ "grok-5": "responses" }))).toBe("responses");
    expect(openCodeGoTransport("grok-5", creds())).toBe("chat");
  });

  it("does not read inherited properties for odd model ids", () => {
    // Inherited Object properties are never treated as overrides...
    expect(openCodeGoTransport("constructor", creds({}))).toBe("chat");
    expect(openCodeGoTransport("toString", creds({}))).toBe("chat");
    expect(openCodeGoTransport("__proto__", creds({}))).toBe("chat");
    // ...while an explicit own entry is honoured, whatever the id (JSON.parse
    // creates "__proto__" as an own key, as the settings store does).
    expect(openCodeGoTransport("__proto__", creds(JSON.parse('{"__proto__":"responses"}')))).toBe("responses");
  });

  it("ignores values that are not a protocol", () => {
    expect(openCodeGoTransport("grok-4.6", creds({ "grok-4.6": "websocket" }))).toBe("responses");
    expect(openCodeGoTransport("glm-5.1", creds({ "glm-5.1": "" }))).toBe("chat");
  });
});

describe("chat body -> OpenCode Go Responses body", () => {
  const tools = [
    { type: "function", function: { name: "read_file", description: "Read", parameters: { type: "object", properties: {} } } },
    { type: "web_search_preview" },
  ];
  const body = (over = {}) => ({
    model: "grok-4.6",
    messages: [
      { role: "system", content: "Be brief." },
      { role: "user", content: "hi" },
    ],
    tools,
    tool_choice: { type: "function", function: { name: "read_file" } },
    parallel_tool_calls: false,
    reasoning_effort: "high",
    max_tokens: 8,
    ...over,
  });

  it("keeps what the shared translator drops, in Responses form", () => {
    const original = body();
    const snapshot = JSON.stringify(original);
    const out = toOpenCodeGoResponsesBody("grok-4.6", original, true, creds());
    expect(out.input.some((i) => i.role === "user")).toBe(true);
    expect(out.instructions).toBe("Be brief.");
    expect(out.max_output_tokens).toBe(16); // raised to OpenCode's minimum
    expect(out).not.toHaveProperty("max_tokens");
    expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(out).not.toHaveProperty("reasoning_effort");
    expect(out.tool_choice).toEqual({ type: "function", name: "read_file" });
    expect(out.parallel_tool_calls).toBe(false);
    expect(out.tools).toEqual([expect.objectContaining({ type: "function", name: "read_file" })]);
    expect(out.store).toBe(false);
    expect(out.stream).toBe(true);
    expect(JSON.stringify(original)).toBe(snapshot); // the client's body is not mutated
  });

  it("keeps a larger cap as is, and prefers max_completion_tokens", () => {
    expect(toOpenCodeGoResponsesBody("grok-4.6", body({ max_tokens: 900 }), true).max_output_tokens).toBe(900);
    expect(toOpenCodeGoResponsesBody("grok-4.6", body({ max_tokens: 900, max_completion_tokens: 500 }), true).max_output_tokens).toBe(500);
    expect(toOpenCodeGoResponsesBody("grok-4.6", body({ max_tokens: undefined }), true)).not.toHaveProperty("max_output_tokens");
  });

  it("drops a tool_choice naming a tool that is not sent, and empty instructions", () => {
    const out = toOpenCodeGoResponsesBody("grok-4.6", body({
      tool_choice: { type: "function", function: { name: "missing" } },
      messages: [{ role: "user", content: "hi" }],
    }), true);
    expect(out).not.toHaveProperty("tool_choice");
    expect(out).not.toHaveProperty("instructions");
    expect(toOpenCodeGoResponsesBody("grok-4.6", body({ tool_choice: "auto" }), true).tool_choice).toBe("auto");
  });

  it("strips prior reasoning items and encrypted reasoning (Muse Spark rejects them)", () => {
    const out = toOpenCodeGoResponsesBody("muse-spark-1.3-contributor", {
      input: [
        { type: "reasoning", id: "rs_1", encrypted_content: "opaque", summary: [] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "a" }], encrypted_content: "x" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "b" }] },
      ],
    }, true);
    expect(out.input.map((i) => i.type)).toEqual(["message", "message"]);
    expect(out.input.every((i) => !("encrypted_content" in i))).toBe(true);
  });
});

describe("stored overrides and the dashboard's Auto", () => {
  it("stores only known protocols for plausible model ids", async () => {
    const { sanitizeModelTransports } = await import("../../open-sse/config/providerModels.js");
    expect(sanitizeModelTransports({ "grok-4.6": "chat", "glm-5.1": "responses", "x": "websocket", "": "chat", "y": 1 }))
      .toEqual({ "grok-4.6": "chat", "glm-5.1": "responses" });
    expect(sanitizeModelTransports(null)).toEqual({});
    expect(sanitizeModelTransports(["chat"])).toEqual({});
    expect(sanitizeModelTransports({ ["m".repeat(201)]: "chat" })).toEqual({});
  });

  it("Auto means the same protocol on the dashboard as in the executor", async () => {
    const { getDefaultTransport } = await import("../../open-sse/config/providerModels.js");
    for (const m of table) expect(getDefaultTransport("opencode-go", m.id)).toBe(openCodeGoTransport(m.id));
  });
});

describe("body edge cases (review findings)", () => {
  const base = { model: "grok-4.6", messages: [{ role: "user", content: "hi" }] };
  it("a zero or negative cap means unset, not a 16-token cap", () => {
    expect(toOpenCodeGoResponsesBody("grok-4.6", { ...base, max_tokens: 0 }, true)).not.toHaveProperty("max_output_tokens");
    expect(toOpenCodeGoResponsesBody("grok-4.6", { ...base, max_tokens: -1, max_completion_tokens: 300 }, true).max_output_tokens).toBe(300);
  });
  it("sends only Responses reasoning fields", () => {
    const out = toOpenCodeGoResponsesBody("grok-4.6", { ...base, reasoning: { effort: "low", exclude: true, max_tokens: 99 } }, true);
    expect(out.reasoning).toEqual({ effort: "low", summary: "auto" });
  });
  it("maps json_schema response_format to text.format", () => {
    const out = toOpenCodeGoResponsesBody("grok-4.6", { ...base, response_format: { type: "json_schema",
      json_schema: { name: "answer", schema: { type: "object" }, strict: true } } }, true);
    expect(out.text).toEqual({ format: { type: "json_schema", name: "answer", schema: { type: "object" }, strict: true } });
    expect(out).not.toHaveProperty("response_format");
  });
});
