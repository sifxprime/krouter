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

async function collect(clientFormat) {
  // Argument order matters and is counter-intuitive: the signature is
  // (targetFormat, sourceFormat) where sourceFormat is the CLIENT. Passing the
  // client as targetFormat is what made the first version of this test pass
  // against code that was still emitting the sentinel.
  const out = openaiStream(CHUNKS).pipeThrough(
    createSSETransformStreamWithLogger(FORMATS.OPENAI, clientFormat, null, null, null, "m")
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

// The guard first went into stream.js only, and the bypass path kept emitting
// the sentinel -- same bug, second file, one client. Both now ask the same
// predicate, and this pins it so a third emitter has to opt in deliberately.
describe("the done-sentinel rule is shared, not per-file", () => {
  it("says Antigravity wants no sentinel and OpenAI does", async () => {
    const { clientWantsDoneSentinel } = await import("../../open-sse/utils/sseConstants.js");
    expect(clientWantsDoneSentinel(FORMATS.ANTIGRAVITY)).toBe(false);
    expect(clientWantsDoneSentinel(FORMATS.OPENAI)).toBe(true);
    expect(clientWantsDoneSentinel(FORMATS.CLAUDE)).toBe(true);
  });

  it("every client-facing emitter consults it", async () => {
    const fs = await import("node:fs");
    for (const f of ["open-sse/utils/stream.js", "open-sse/utils/bypassHandler.js"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, `${f} must gate its [DONE] on the shared predicate`)
        .toContain("clientWantsDoneSentinel");
    }
  });
});
