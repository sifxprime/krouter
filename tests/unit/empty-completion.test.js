import { describe, it, expect } from "vitest";
import { detectEmptyCompletion, EMPTY_COMPLETION_STATUS } from "open-sse/utils/emptyCompletion.js";

describe("detectEmptyCompletion", () => {
  it("returns null when the model produced text", () => {
    expect(detectEmptyCompletion({ finishReason: "stop", text: "AG OK" })).toBeNull();
  });

  it("returns null when the model produced tool calls instead of text", () => {
    expect(detectEmptyCompletion({
      finishReason: "tool_calls",
      text: "",
      toolCalls: [{ id: "1", function: { name: "read" } }],
    })).toBeNull();
  });

  // The live case: ag/gemini-3.5-flash-low with max_tokens 40 spent 37 tokens
  // on reasoning and emitted nothing. A bare empty completion is
  // indistinguishable from a broken provider.
  it("flags a reasoning budget that consumed the whole allowance", () => {
    const d = detectEmptyCompletion({
      finishReason: "max_tokens",
      text: "",
      usage: { completion_tokens: 37, completion_tokens_details: { reasoning_tokens: 37 } },
      maxTokens: 40,
    });
    expect(d).not.toBeNull();
    expect(d.code).toBe("empty_completion_reasoning_budget");
    expect(d.reasoningTokens).toBe(37);
    expect(d.message).toMatch(/max_tokens/i);
  });

  it("reads reasoning tokens from the Anthropic-shaped usage too", () => {
    const d = detectEmptyCompletion({
      finishReason: "max_tokens",
      text: "",
      usage: { output_tokens: 20, output_tokens_details: { reasoning_tokens: 20 } },
    });
    expect(d?.code).toBe("empty_completion_reasoning_budget");
    expect(d.reasoningTokens).toBe(20);
  });

  it("treats 'length' as the same condition as 'max_tokens'", () => {
    const d = detectEmptyCompletion({
      finishReason: "length",
      text: "",
      usage: { completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 12 } },
    });
    expect(d?.code).toBe("empty_completion_reasoning_budget");
  });

  it("flags truncation with no reasoning as a plain budget problem", () => {
    const d = detectEmptyCompletion({
      finishReason: "max_tokens",
      text: "",
      usage: { completion_tokens: 0 },
    });
    expect(d?.code).toBe("empty_completion_truncated");
  });

  // A provider that says "stop" and returns nothing is a different fault and
  // must not be mislabelled as a token-budget problem.
  it("flags an empty response that claims it finished normally", () => {
    const d = detectEmptyCompletion({ finishReason: "stop", text: "", usage: { completion_tokens: 0 } });
    expect(d?.code).toBe("empty_completion_no_output");
  });

  it("does not flag whitespace-only text as output", () => {
    const d = detectEmptyCompletion({ finishReason: "stop", text: "   \n  ", usage: {} });
    expect(d?.code).toBe("empty_completion_no_output");
  });

  it("carries a log status distinct from a plain 200", () => {
    const d = detectEmptyCompletion({
      finishReason: "max_tokens",
      text: "",
      usage: { completion_tokens_details: { reasoning_tokens: 5 } },
    });
    expect(EMPTY_COMPLETION_STATUS(d)).toMatch(/EMPTY/);
    expect(EMPTY_COMPLETION_STATUS(d)).not.toBe("200 OK");
  });

  it("never throws on malformed or missing input", () => {
    expect(() => detectEmptyCompletion({})).not.toThrow();
    expect(() => detectEmptyCompletion({ usage: null, text: null })).not.toThrow();
    expect(() => detectEmptyCompletion({ text: undefined, finishReason: undefined })).not.toThrow();
  });
});

import { readCompletionShape } from "open-sse/utils/emptyCompletion.js";

describe("readCompletionShape", () => {
  it("reads an OpenAI chat completion", () => {
    const s = readCompletionShape({
      choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { completion_tokens: 3 },
    });
    expect(s).toMatchObject({ text: "hi", finishReason: "stop" });
    expect(s.usage.completion_tokens).toBe(3);
  });

  it("reads an OpenAI completion whose content is a block array", () => {
    const s = readCompletionShape({
      choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }, finish_reason: "stop" }],
    });
    expect(s.text).toBe("ab");
  });

  it("reads OpenAI tool calls as output", () => {
    const s = readCompletionShape({
      choices: [{ message: { content: null, tool_calls: [{ id: "1" }] }, finish_reason: "tool_calls" }],
    });
    expect(s.toolCalls).toHaveLength(1);
  });

  it("reads a Claude message body and its stop_reason", () => {
    const s = readCompletionShape({
      type: "message",
      content: [{ type: "text", text: "AG OK" }],
      stop_reason: "end_turn",
      usage: { output_tokens: 5 },
    });
    expect(s).toMatchObject({ text: "AG OK", finishReason: "end_turn" });
  });

  it("reads Claude tool_use blocks as output", () => {
    const s = readCompletionShape({
      type: "message",
      content: [{ type: "tool_use", id: "t1", name: "read" }],
      stop_reason: "tool_use",
    });
    expect(s.toolCalls).toHaveLength(1);
    expect(s.text).toBe("");
  });

  // The exact live body shape that produced an empty answer.
  it("diagnoses the real Antigravity empty response end to end", () => {
    const body = {
      choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "max_tokens" }],
      usage: { prompt_tokens: 2373, completion_tokens: 37, completion_tokens_details: { reasoning_tokens: 37 } },
    };
    const s = readCompletionShape(body);
    const d = detectEmptyCompletion({ ...s, maxTokens: 40 });
    expect(d.code).toBe("empty_completion_reasoning_budget");
    expect(d.reasoningTokens).toBe(37);
  });

  // And the successful one must stay silent.
  it("stays silent on the real Kiro success body", () => {
    const body = {
      type: "message",
      content: [{ type: "text", text: "KIRO OK" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 6375, output_tokens: 1 },
    };
    expect(detectEmptyCompletion(readCompletionShape(body))).toBeNull();
  });

  it("never throws on junk", () => {
    for (const junk of [null, undefined, {}, { choices: [] }, { content: null }, "str", 5]) {
      expect(() => readCompletionShape(junk)).not.toThrow();
    }
  });
});

describe("detectEmptyCompletion — token-delta signal (streaming passthrough)", () => {
  // In passthrough streaming the router forwards bytes without parsing, so
  // accumulatedContent is empty even on a successful response. Text alone
  // therefore cannot distinguish "no output" from "output not captured".
  // completion_tokens minus reasoning_tokens can: it is the real output count.

  it("stays silent when tokens prove output existed, even with no captured text", () => {
    // The live control: max_tokens 400 produced "AG OK".
    expect(detectEmptyCompletion({
      text: "",
      finishReason: null,
      usage: { completion_tokens: 78, completion_tokens_details: { reasoning_tokens: 76 } },
      maxTokens: 400,
    })).toBeNull();
  });

  it("flags when reasoning consumed every completion token", () => {
    // The live failure: max_tokens 40, all 37 tokens spent reasoning.
    const d = detectEmptyCompletion({
      text: "",
      finishReason: null,
      usage: { completion_tokens: 37, completion_tokens_details: { reasoning_tokens: 37 } },
      maxTokens: 40,
    });
    expect(d?.code).toBe("empty_completion_reasoning_budget");
    expect(d.reasoningTokens).toBe(37);
  });

  it("does not flag a single output token as empty", () => {
    expect(detectEmptyCompletion({
      text: "",
      usage: { completion_tokens: 77, completion_tokens_details: { reasoning_tokens: 76 } },
    })).toBeNull();
  });

  it("still trusts real text over the token delta", () => {
    expect(detectEmptyCompletion({
      text: "AG OK",
      usage: { completion_tokens: 37, completion_tokens_details: { reasoning_tokens: 37 } },
    })).toBeNull();
  });

  it("falls back to the text signal when usage carries no reasoning breakdown", () => {
    const d = detectEmptyCompletion({ text: "", finishReason: "stop", usage: { completion_tokens: 0 } });
    expect(d?.code).toBe("empty_completion_no_output");
  });
});
