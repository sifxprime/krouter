import { describe, expect, it } from "vitest";

import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const RESPONSES = FORMATS.OPENAI_RESPONSES;

// A response.completed event carrying real usage -- the last thing codex reads
// before it closes the socket.
const TERMINAL = `event: response.completed\ndata: ${JSON.stringify({
  type: "response.completed",
  response: {
    status: "completed",
    usage: { input_tokens: 1234, output_tokens: 567, total_tokens: 1801 }
  }
})}\n\n`;

function makeStream(onStreamComplete) {
  return createSSETransformStreamWithLogger(
    RESPONSES,            // targetFormat (provider)
    RESPONSES,            // sourceFormat (client) -- same-format codex path
    "openai",             // provider
    null,                 // reqLogger
    null,                 // toolNameMap
    "gpt-5-codex",        // model
    null,                 // connectionId
    { model: "gpt-5-codex" },
    onStreamComplete,
    null                  // apiKey
  );
}

describe("Responses terminal-event usage accounting", () => {
  it("records usage when the client closes the socket on response.completed", async () => {
    const calls = [];
    const stream = makeStream((content, usage) => calls.push(usage));

    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    // Don't await the write: with no reader draining yet it blocks on backpressure.
    const written = writer.write(new TextEncoder().encode(TERMINAL));

    // Read the terminal chunk, then hang up exactly like codex does. This cancels
    // the reader, so flush() never runs.
    await reader.read();
    await reader.cancel();
    await written.catch(() => { });
    await writer.close().catch(() => { });

    expect(calls.length).toBe(1);
    expect(calls[0]).toBeTruthy();
    expect(calls[0].input_tokens ?? calls[0].prompt_tokens).toBe(1234);
    expect(calls[0].output_tokens ?? calls[0].completion_tokens).toBe(567);
  });

  it("does not double-count when the client reads to the end", async () => {
    const calls = [];
    const stream = makeStream((content, usage) => calls.push(usage));

    const writer = stream.writable.getWriter();
    const readAll = (async () => {
      const reader = stream.readable.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    })();

    await writer.write(new TextEncoder().encode(TERMINAL));
    await writer.close();
    await readAll;

    // finalizeStream is once-guarded: the flush path must be a no-op here.
    expect(calls.length).toBe(1);
  });
});
