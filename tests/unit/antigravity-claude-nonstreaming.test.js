import { describe, it, expect } from "vitest";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

/**
 * Antigravity normalises every model to the Gemini envelope -- {response:{candidates}}
 * -- including its Claude and GPT models. So all AG traffic takes the Gemini branch of
 * translateNonStreamingResponse, which ended by returning an OpenAI completion no matter
 * what the client speaks. A Claude client calling /v1/messages therefore received
 * {object:"chat.completion", choices:[...]} with no `content` array it could parse.
 *
 * Same defect class as 0.5.109 (openai -> claude) and 0.5.117 (kiro -> claude); AG was
 * simply never covered because its payload is nested one level down. The streaming path
 * was correct throughout, so this only ever showed up on non-streaming requests.
 */

const agEnvelope = (parts, finishReason = "STOP") => ({
  response: {
    candidates: [{ content: { role: "model", parts }, finishReason }],
    usageMetadata: { promptTokenCount: 196, candidatesTokenCount: 6, totalTokenCount: 202 },
    modelVersion: "claude-sonnet-4-6",
    responseId: "msg_vrtx_011CeRoftEtUmyYdWRsie47i",
  },
  traceId: "t-1",
  metadata: {},
});

describe("antigravity -> claude, non-streaming", () => {
  it("returns a Claude message, not an OpenAI completion", () => {
    const out = translateNonStreamingResponse(
      agEnvelope([{ text: "PONG" }]), FORMATS.ANTIGRAVITY, FORMATS.CLAUDE);

    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(Array.isArray(out.content)).toBe(true);
    expect(out.content.find((b) => b.type === "text")?.text).toBe("PONG");
    expect(out.stop_reason).toBe("end_turn");
    // The shape a Claude client cannot parse must be gone entirely.
    expect(out.choices).toBeUndefined();
    expect(out.object).toBeUndefined();
  });

  it("carries reasoning through as a thinking block", () => {
    const out = translateNonStreamingResponse(
      agEnvelope([{ thought: true, text: "considering" }, { text: "PONG" }]),
      FORMATS.ANTIGRAVITY, FORMATS.CLAUDE);

    expect(out.content.map((b) => b.type)).toContain("thinking");
    expect(out.content.find((b) => b.type === "text")?.text).toBe("PONG");
  });

  it("still returns an OpenAI completion for an OpenAI client", () => {
    const out = translateNonStreamingResponse(
      agEnvelope([{ text: "PONG" }]), FORMATS.ANTIGRAVITY, FORMATS.OPENAI);

    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.content).toBe("PONG");
    expect(out.type).toBeUndefined();
  });

  // Gemini says MAX_TOKENS where OpenAI says "length". Lower-casing alone produced the
  // non-OpenAI value "max_tokens", which convertFinishReason did not recognise, so it
  // fell through to "end_turn" and truncation became invisible to the client.
  it("reports a truncated response as max_tokens, not end_turn", () => {
    const out = translateNonStreamingResponse(
      agEnvelope([{ text: "PON" }], "MAX_TOKENS"), FORMATS.ANTIGRAVITY, FORMATS.CLAUDE);

    expect(out.type).toBe("message");
    expect(out.stop_reason).toBe("max_tokens");
  });

  it("reports truncation to an OpenAI client as length", () => {
    const out = translateNonStreamingResponse(
      agEnvelope([{ text: "PON" }], "MAX_TOKENS"), FORMATS.ANTIGRAVITY, FORMATS.OPENAI);

    expect(out.choices[0].finish_reason).toBe("length");
  });

  it("maps a safety stop to content_filter", () => {
    const out = translateNonStreamingResponse(
      agEnvelope([{ text: "" }], "SAFETY"), FORMATS.ANTIGRAVITY, FORMATS.OPENAI);

    expect(out.choices[0].finish_reason).toBe("content_filter");
  });

  it("treats an unrecognised finish reason as a normal stop", () => {
    const out = translateNonStreamingResponse(
      agEnvelope([{ text: "hi" }], "SOMETHING_NEW"), FORMATS.ANTIGRAVITY, FORMATS.OPENAI);

    expect(out.choices[0].finish_reason).toBe("stop");
  });
});
