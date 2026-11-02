// A role:"tool" message forwarded its content array verbatim into the Claude
// tool_result block, so an OpenAI image_url part reached Anthropic unchanged and the
// request failed with 400 "Input tag 'image_url' ... does not match any of the expected
// tags". Claude does accept image blocks inside tool_result — they just have to be
// Claude-shaped. The user branch already converted them; the tool branch did not.
// Upstream 95009651, #5125.
import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

const PNG = "iVBORw0KGgoAAAANSUhEUg==";

function toolResultOf(content) {
  const body = openaiToClaudeRequest("claude-sonnet-4-6", {
    model: "claude-sonnet-4-6",
    messages: [
      { role: "user", content: "look at this" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "screenshot", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call_1", content },
    ],
  }, false);

  const blocks = body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
  return blocks.find((b) => b.type === "tool_result");
}

describe("image_url inside a tool message becomes a Claude image block", () => {
  it("converts a base64 data URI", () => {
    const result = toolResultOf([
      { type: "text", text: "here it is" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } },
    ]);

    expect(result.content).toEqual([
      { type: "text", text: "here it is" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
    ]);
  });

  // The whole point of the bug: no image_url survives into the wire body.
  it("leaves no image_url part anywhere in the request", () => {
    const result = toolResultOf([
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } },
    ]);
    expect(JSON.stringify(result)).not.toContain("image_url");
  });

  it("converts an http(s) url to a url source", () => {
    for (const url of ["https://example.com/a.png", "http://example.com/a.png"]) {
      const result = toolResultOf([{ type: "image_url", image_url: { url } }]);
      expect(result.content, url).toEqual([{ type: "image", source: { type: "url", url } }]);
    }
  });

  it("passes an already-Claude image block through", () => {
    const source = { type: "base64", media_type: "image/jpeg", data: PNG };
    const result = toolResultOf([{ type: "image", source }]);
    expect(result.content).toEqual([{ type: "image", source }]);
  });
});

describe("everything else about tool_result is unchanged", () => {
  it("passes a plain string through untouched", () => {
    const result = toolResultOf("plain text output");
    expect(result.content).toBe("plain text output");
  });

  it("keeps the tool_use_id", () => {
    const result = toolResultOf([{ type: "text", text: "ok" }]);
    expect(result.tool_use_id).toBe("call_1");
  });

  // An empty tool_result is itself a 400, so a payload with nothing convertible in it is
  // better sent as-is than silently emptied.
  it("keeps the original payload when nothing is convertible", () => {
    const odd = [{ type: "something_else", value: 1 }];
    expect(toolResultOf(odd).content).toEqual(odd);
  });

  it("skips an image_url part with no url rather than emitting a broken block", () => {
    const result = toolResultOf([
      { type: "text", text: "kept" },
      { type: "image_url", image_url: {} },
    ]);
    expect(result.content).toEqual([{ type: "text", text: "kept" }]);
  });

  // A non-data, non-http scheme (file:, blob:) is not fetchable by Anthropic.
  it("drops an unusable url scheme", () => {
    const result = toolResultOf([
      { type: "text", text: "kept" },
      { type: "image_url", image_url: { url: "file:///etc/passwd" } },
    ]);
    expect(result.content).toEqual([{ type: "text", text: "kept" }]);
  });
});
