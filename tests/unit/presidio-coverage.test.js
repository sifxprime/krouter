import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createRedactionMiddleware,
  invalidateRedactionSettingsCache,
} from "@/middleware/redaction/middleware.js";

/**
 * PR #1 review: the middleware returned early unless body.messages existed, so
 * redaction was a silent no-op on /v1/responses and /v1/responses/compact --
 * the Responses API carries content in `input`/`instructions` -- while the
 * dashboard still reported redaction as on. The Anthropic top-level `system`
 * prompt was skipped for the same reason.
 */

const { getSettings } = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({ getSettings }));

/**
 * Sidecar stub that replaces any email with <EMAIL>, preserving order.
 * The pattern is deliberately bounded to word characters: a greedy \S+@\S+
 * swallows surrounding JSON quotes, which made the tool_call test look like a
 * production bug when it was the stub mangling the payload.
 */
function stubSidecar() {
  const seen = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const { texts } = JSON.parse(init.body);
    seen.push(...texts);
    return {
      ok: true,
      status: 200,
      json: async () => ({ redacted_texts: texts.map((t) => t.replace(/[\w.+-]+@[\w-]+\.\w+/g, "<EMAIL>")) }),
    };
  }));
  return seen;
}

const send = async (payload) => {
  const mw = createRedactionMiddleware({ sidecarUrl: "http://sidecar/redact" });
  let forwarded = null;
  await mw(
    new Request("http://localhost:20128/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    async (req) => {
      forwarded = await req.clone().json();
      return new Response("{}", { status: 200 });
    },
  );
  return forwarded;
};

describe("redaction coverage beyond body.messages", () => {
  beforeEach(() => {
    invalidateRedactionSettingsCache();
    getSettings.mockResolvedValue({ presidioEnabled: true, presidioPiiRedaction: true });
    vi.unstubAllGlobals();
  });

  it("redacts the Responses API `input` when it is a bare string", async () => {
    stubSidecar();
    const out = await send({ model: "gpt-5.4", input: "mail me at john@example.com" });
    expect(out.input).toBe("mail me at <EMAIL>");
  });

  it("redacts Responses API `input` items with input_text blocks", async () => {
    stubSidecar();
    const out = await send({
      model: "gpt-5.4",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "reach me: a@b.com" }] }],
    });
    expect(out.input[0].content[0].text).toBe("reach me: <EMAIL>");
  });

  it("redacts Responses API `instructions`", async () => {
    stubSidecar();
    const out = await send({ model: "gpt-5.4", instructions: "escalate to ops@corp.com", input: "hi" });
    expect(out.instructions).toBe("escalate to <EMAIL>");
  });

  it("redacts the Anthropic top-level `system` string", async () => {
    stubSidecar();
    const out = await send({
      model: "claude-haiku-4.5",
      system: "the operator is jane@corp.com",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(out.system).toBe("the operator is <EMAIL>");
  });

  it("redacts Anthropic `system` given as text blocks", async () => {
    stubSidecar();
    const out = await send({
      model: "claude-haiku-4.5",
      system: [{ type: "text", text: "owner: bob@corp.com" }],
      messages: [{ role: "user", content: "hello" }],
    });
    expect(out.system[0].text).toBe("owner: <EMAIL>");
  });

  it("still redacts ordinary chat messages (no regression)", async () => {
    stubSidecar();
    const out = await send({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "ping me at dev@corp.com" }],
    });
    expect(out.messages[0].content).toBe("ping me at <EMAIL>");
  });

  it("passes through untouched when there is genuinely nothing to redact", async () => {
    const seen = stubSidecar();
    const out = await send({ model: "gpt-5.4", temperature: 0.2 });
    expect(seen).toHaveLength(0);
    expect(out.model).toBe("gpt-5.4");
  });
});

describe("tool traffic redaction", () => {
  beforeEach(() => {
    invalidateRedactionSettingsCache();
    getSettings.mockResolvedValue({ presidioEnabled: true, presidioPiiRedaction: true });
    vi.unstubAllGlobals();
  });

  it("redacts an OpenAI role:tool result message", async () => {
    stubSidecar();
    const out = await send({
      model: "gpt-5.4",
      messages: [
        { role: "user", content: "read the file" },
        { role: "tool", tool_call_id: "c1", content: "owner listed as sam@corp.com" },
      ],
    });
    expect(out.messages[1].content).toBe("owner listed as <EMAIL>");
  });

  it("redacts Anthropic tool_result string content", async () => {
    stubSidecar();
    const out = await send({
      model: "claude-haiku-4.5",
      messages: [
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "found kate@corp.com" }] },
      ],
    });
    expect(out.messages[0].content[0].content).toBe("found <EMAIL>");
  });

  it("redacts Anthropic tool_result nested text blocks", async () => {
    stubSidecar();
    const out = await send({
      model: "claude-haiku-4.5",
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "cc: lee@corp.com" }] },
          ],
        },
      ],
    });
    expect(out.messages[0].content[0].content[0].text).toBe("cc: <EMAIL>");
  });

  it("redacts tool descriptions in both OpenAI shapes", async () => {
    stubSidecar();
    const out = await send({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { type: "function", function: { name: "page", description: "pages oncall@corp.com" } },
        { name: "mail", description: "mails ops@corp.com" },
      ],
    });
    expect(out.tools[0].function.description).toBe("pages <EMAIL>");
    expect(out.tools[1].description).toBe("mails <EMAIL>");
  });

  it("redacts tool_call arguments when the result is still valid JSON", async () => {
    stubSidecar();
    const out = await send({
      model: "gpt-5.4",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "c1", type: "function", function: { name: "send", arguments: '{"to":"amy@corp.com"}' } },
          ],
        },
      ],
    });
    const args = out.messages[0].tool_calls[0].function.arguments;
    expect(args).toBe('{"to":"<EMAIL>"}');
    expect(() => JSON.parse(args)).not.toThrow();
  });

  it("keeps the original arguments if redaction would break the JSON", async () => {
    // A sidecar that mangles the payload into invalid JSON. Shipping that would
    // fail loudly for every tool call, which is worse than the leak.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ redacted_texts: ['{"to": <REDACTED>'] }),
    })));
    const original = '{"to":"amy@corp.com"}';
    const out = await send({
      model: "gpt-5.4",
      messages: [
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "send", arguments: original } }] },
      ],
    });
    expect(out.messages[0].tool_calls[0].function.arguments).toBe(original);
  });
});
