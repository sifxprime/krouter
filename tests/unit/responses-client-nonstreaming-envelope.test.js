/**
 * 0.5.169 — a Codex-style client must get a Responses envelope, not a chat.completion.
 *
 * translateNonStreamingResponse(body, targetFormat, sourceFormat) names the PROVIDER
 * format `targetFormat` and the CLIENT format `sourceFormat`. Every provider branch in
 * it ends by building an OpenAI `chat.completion`, and only the OpenAI-provider branch
 * ever converted that into the Responses envelope. So a client speaking OPENAI_RESPONSES
 * got {object:"chat.completion", choices:[...]} — no `output[]` to read — from every
 * other provider.
 *
 * Measured on a dev server against the three live connections before the fix:
 *   POST /v1/responses {"stream":false}   cc/claude-opus-5          object=chat.completion
 *                                         ag/claude-sonnet-5-5-high object=chat.completion
 *                                         kr/claude-sonnet-4.5      object=chat.completion
 *   the same request {"stream":true}      all three                 9-10 response.* events
 * Streaming was already right; only non-streaming leaked. Same shape of gap as the Claude
 * client fixes in 0.5.109 (openai), 0.5.117 (kiro) and 0.5.146 (antigravity).
 */
import { describe, it, expect } from "vitest";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const claudeBody = () => ({
  id: "msg_01TEST",
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content: [{ type: "text", text: "OK7" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 11, output_tokens: 3 },
});

const geminiBody = () => ({
  candidates: [{ content: { role: "model", parts: [{ text: "OK7" }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3 },
});

const openaiBody = () => ({
  id: "chatcmpl-1",
  object: "chat.completion",
  model: "m",
  choices: [{ index: 0, message: { role: "assistant", content: "OK7" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
});

const textOf = (r) =>
  (r.output || []).flatMap((i) => i.content || []).map((c) => c.text || "").join("");

describe("a Responses client gets a Responses envelope from every provider", () => {
  const CASES = [
    ["Claude provider", FORMATS.CLAUDE, claudeBody],
    ["Gemini provider", FORMATS.GEMINI, geminiBody],
    ["Antigravity provider", FORMATS.ANTIGRAVITY, geminiBody],
    ["Vertex provider", FORMATS.VERTEX, geminiBody],
    ["Kiro provider", FORMATS.KIRO, openaiBody],
    ["OpenAI provider", FORMATS.OPENAI, openaiBody],
  ];

  it.each(CASES)("%s -> object is 'response', not 'chat.completion'", (_n, providerFmt, make) => {
    const out = translateNonStreamingResponse(make(), providerFmt, FORMATS.OPENAI_RESPONSES);
    expect(out.object).toBe("response");
    expect(out.choices).toBeUndefined();
    expect(Array.isArray(out.output)).toBe(true);
  });

  it.each(CASES)("%s -> the text survives the conversion", (_n, providerFmt, make) => {
    const out = translateNonStreamingResponse(make(), providerFmt, FORMATS.OPENAI_RESPONSES);
    expect(textOf(out)).toContain("OK7");
  });
});

describe("it does not double-convert or disturb other clients", () => {
  it("a body that is already a Responses object is left alone", () => {
    const already = translateNonStreamingResponse(openaiBody(), FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    expect(already.object).toBe("response");
    // Feeding the result back through must not wrap it a second time.
    const again = translateNonStreamingResponse(already, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    expect(again.object).toBe("response");
    expect(textOf(again)).toContain("OK7");
  });

  it("an OpenAI client still gets chat.completion", () => {
    const out = translateNonStreamingResponse(claudeBody(), FORMATS.CLAUDE, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.content).toBe("OK7");
  });

  it("a Claude client still gets a Claude message", () => {
    const out = translateNonStreamingResponse(openaiBody(), FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.content.map((b) => b.text).join("")).toBe("OK7");
  });

  it("identical provider and client formats are passed through untouched", () => {
    const body = openaiBody();
    expect(translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.OPENAI)).toBe(body);
  });
});
