// Google's streamGenerateContent?alt=sse has NO [DONE] sentinel — the stream simply
// ends. kRouter appended the OpenAI-style "data: [DONE]", which agy parses as JSON,
// fails on, and reports as "Agent execution terminated due to error" — AFTER the
// answer has already rendered. Captured from a real Antigravity turn.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function openaiStream(chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(`data: ${JSON.stringify(c)}\n\n`));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

const CHUNKS = [
  { id: "c1", model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "Hi" } }] },
  { id: "c1", model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
];

async function collect(targetFormat) {
  const out = openaiStream(CHUNKS).pipeThrough(
    createSSETransformStreamWithLogger(targetFormat, FORMATS.OPENAI, null, null, null, "m")
  );
  const reader = out.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
  }
  return text;
}

describe("SSE terminator per client format", () => {
  it("does NOT send [DONE] to Antigravity", async () => {
    const text = await collect(FORMATS.ANTIGRAVITY);
    // Scoped to the terminator on purpose: frame translation is covered by
    // bugs-antigravity.test.js, and asserting it here would couple this test to
    // the chunk shape the translator happens to accept.
    expect(text, "agy cannot parse [DONE] as JSON").not.toContain("[DONE]");
  });

  it("still sends [DONE] to OpenAI clients", async () => {
    const text = await collect(FORMATS.OPENAI);
    expect(text).toContain("[DONE]");
  });
});
