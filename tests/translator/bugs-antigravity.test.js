// Real Antigravity-MITM requests (Gemini-internal: { request: { contents, ... } }) → OpenAI.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const AG2O = (req) =>
  translateRequest(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, "m", { request: req }, true, null, null);

describe("Antigravity → OpenAI", () => {
  // antigravity-to-openai.js:177-189 — content with BOTH functionResponse and functionCall/text
  // returns toolResults early → drops the tool calls / text.
  // KNOWN BUG
  it.fails("functionResponse + functionCall in same content keeps both", () => {
    const out = AG2O({
      contents: [{
        role: "model",
        parts: [
          { functionResponse: { id: "c1", name: "prev", response: { result: "done" } } },
          { functionCall: { id: "c2", name: "next", args: {} } },
        ],
      }],
    });
    const json = JSON.stringify(out);
    expect(json, "functionCall lost when sharing content with functionResponse").toContain("\"next\"");
  });

  // antigravity-to-openai.js:172 — functionCall without an id gets a deterministic
  // `call_${name}` id that pairs cleanly with its functionResponse counterpart.
  // Fixed in our fork's hardening pass before upstream wrote this test; `.fails`
  // annotation removed accordingly.
  it("functionCall without id keeps a stable matchable id", () => {
    const out = AG2O({
      contents: [
        { role: "model", parts: [{ functionCall: { name: "search", args: { q: "x" } } }] },
        { role: "user", parts: [{ functionResponse: { name: "search", response: { result: "r" } } }] },
      ],
    });
    const asst = out.messages.find((m) => m.tool_calls);
    const tool = out.messages.find((m) => m.role === "tool");
    expect(tool?.tool_call_id, "id mismatch between call and response").toBe(asst?.tool_calls?.[0]?.id);
  });

  // antigravity-to-openai.js:144-147 — signature-only part handling (regression guard)
  it("signature-only part does not produce empty text", () => {
    const out = AG2O({
      contents: [{ role: "model", parts: [{ thoughtSignature: "sig", text: "" }] }],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    const content = asst?.content;
    const hasEmpty = Array.isArray(content)
      ? content.some((c) => c.type === "text" && c.text === "")
      : content === "";
    expect(hasEmpty, "empty text part emitted").toBe(false);
  });
});

describe("Antigravity executor", () => {
  it("strips optional from nested tool schemas", () => {
    const out = new AntigravityExecutor().transformRequest("gemini-2.5-pro", {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{
          functionDeclarations: [{
            name: "lookup",
            description: "Lookup a value",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query",
                  optional: true,
                },
              },
            },
          }],
        }],
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const query = out.request.tools[0].functionDeclarations[0].parameters.properties.query;
    expect(query).toEqual({ type: "string", description: "Search query" });
  });
});

// Gemini serialises its Schema from protobuf, so int64 keywords arrive as STRINGS
// ("minLength": "1") and the type enum arrives UPPERCASE. Anthropic validates tool
// schemas strictly against JSON Schema draft 2020-12 and rejects both, with
//   tools.4.custom.input_schema: JSON schema is invalid
// Captured from a real Antigravity chat turn (the `send_message` tool).
describe("Antigravity tool schemas → valid JSON Schema", () => {
  const SEND_MESSAGE = {
    tools: [{
      functionDeclarations: [{
        name: "send_message",
        description: "Send a message.",
        parameters: {
          type: "OBJECT",
          properties: {
            Message: { type: "STRING", description: "Content of the message.", minLength: "1" },
            Recipient: { type: "STRING", description: "Conversation ID.", minLength: "1" },
          },
          required: ["Recipient", "Message"],
        },
      }],
    }],
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
  };

  const paramsOf = (out) => out.tools[0].function.parameters;

  it("lowercases the protobuf type enum", () => {
    const p = paramsOf(AG2O(SEND_MESSAGE));
    expect(p.type).toBe("object");
    expect(p.properties.Message.type).toBe("string");
  });

  it("coerces string-encoded numeric keywords to numbers", () => {
    const p = paramsOf(AG2O(SEND_MESSAGE));
    expect(p.properties.Message.minLength, "minLength must be a number").toBe(1);
    expect(typeof p.properties.Recipient.minLength).toBe("number");
  });

  it("normalises schemas nested in anyOf / items / $defs", () => {
    const out = AG2O({
      tools: [{
        functionDeclarations: [{
          name: "nested",
          parameters: {
            type: "OBJECT",
            properties: {
              list: { type: "ARRAY", items: { type: "STRING", minLength: "2" }, maxItems: "5" },
              choice: { anyOf: [{ type: "STRING", minLength: "3" }, { type: "NUMBER" }] },
            },
          },
        }],
      }],
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    });
    const p = paramsOf(out);
    expect(p.properties.list.items.type).toBe("string");
    expect(p.properties.list.items.minLength).toBe(2);
    expect(p.properties.list.maxItems).toBe(5);
    expect(p.properties.choice.anyOf[0].type).toBe("string");
    expect(p.properties.choice.anyOf[0].minLength).toBe(3);
  });
});
