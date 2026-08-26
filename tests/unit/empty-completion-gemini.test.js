import { describe, it, expect } from "vitest";
import { detectEmptyCompletion, readCompletionShape } from "../../open-sse/utils/emptyCompletion.js";

/**
 * nonStreamingHandler diagnoses a response BEFORE translating it, so readCompletionShape
 * receives the provider's own body. It understood the OpenAI and Claude shapes but not
 * the Gemini envelope -- and Antigravity normalises every model it serves to that
 * envelope. So each healthy Antigravity non-streaming response read as
 * {text:"", usage:null} and was filed as empty_completion_no_output, putting a false
 * "empty" on ordinary successful traffic in the request log and usage stats.
 */
const envelope = (parts, finishReason, usageMetadata = {}, wrapped = true) => {
  const inner = { candidates: [{ content: { role: "model", parts }, finishReason }], usageMetadata };
  return wrapped ? { response: inner, traceId: "t", metadata: {} } : inner;
};
const diagnose = (body, maxTokens) =>
  detectEmptyCompletion({ ...readCompletionShape(body), maxTokens });

describe("empty-completion detection on the Gemini/Antigravity envelope", () => {
  it("does not flag a healthy response", () => {
    const d = diagnose(envelope([{ text: "PONG" }], "STOP",
      { promptTokenCount: 196, candidatesTokenCount: 6, totalTokenCount: 202 }), 2000);
    expect(d).toBeNull();
  });

  it("reads the text out of the envelope rather than seeing none", () => {
    expect(readCompletionShape(envelope([{ text: "PONG" }], "STOP")).text).toBe("PONG");
  });

  it("handles the bare envelope as well as the wrapped one", () => {
    expect(readCompletionShape(envelope([{ text: "hi" }], "STOP", {}, false)).text).toBe("hi");
  });

  it("does not count reasoning parts as answer text", () => {
    // Otherwise a response that produced only reasoning would look like real output,
    // masking the reasoning-budget case this module exists to detect.
    const shape = readCompletionShape(envelope(
      [{ thought: true, text: "deliberating" }, { text: "ANSWER" }], "STOP"));
    expect(shape.text).toBe("ANSWER");
  });

  it("still flags a response that produced nothing at all", () => {
    const d = diagnose(envelope([], "STOP", { candidatesTokenCount: 0 }), 2000);
    expect(d?.code).toBe("empty_completion_no_output");
  });

  it("still flags a budget spent entirely on reasoning", () => {
    const d = diagnose(envelope([{ thought: true, text: "thinking" }], "MAX_TOKENS",
      { candidatesTokenCount: 0, thoughtsTokenCount: 61 }), 64);
    expect(d).not.toBeNull();
  });

  it("treats a tool call as real output", () => {
    const d = diagnose(envelope([{ functionCall: { name: "get_weather", args: {} } }], "STOP",
      { candidatesTokenCount: 5 }), 2000);
    expect(d).toBeNull();
  });

  it("leaves the OpenAI and Claude shapes working", () => {
    expect(diagnose({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }, 100)).toBeNull();
    expect(diagnose({ type: "message", content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" }, 100)).toBeNull();
  });
});
