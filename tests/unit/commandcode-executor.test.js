import { describe, it, expect, vi } from "vitest";
import {
  parseCommandCodeError,
  inspectAndWrapCommandCodeResponse,
  CommandCodeExecutor,
} from "../../open-sse/executors/commandcode.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

function createNdjsonStream(lines) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(typeof line === "string" ? line : JSON.stringify(line) + "\n"));
      }
      controller.close();
    },
  });
}

describe("parseCommandCodeError", () => {
  it("parses user exact error payload with statusCode 503 and isRetryable", () => {
    const event = {
      type: "error",
      error: {
        type: "server_error",
        message: "Service temporarily unavailable. Please try again shortly.",
        statusCode: 503,
        isRetryable: true,
      },
    };
    const parsed = parseCommandCodeError(event);
    expect(parsed.statusCode).toBe(503);
    expect(parsed.message).toBe("Service temporarily unavailable. Please try again shortly.");
    expect(parsed.type).toBe("server_error");
  });

  it("handles string error message", () => {
    const event = {
      type: "error",
      message: "Rate limit exceeded. Please wait 30s.",
    };
    const parsed = parseCommandCodeError(event);
    expect(parsed.statusCode).toBe(429);
    expect(parsed.message).toBe("Rate limit exceeded. Please wait 30s.");
  });

  it("handles plain error string in error property", () => {
    const event = {
      type: "error",
      error: "Unauthorized access",
    };
    const parsed = parseCommandCodeError(event);
    expect(parsed.statusCode).toBe(401);
    expect(parsed.message).toBe("Unauthorized access");
  });
});

describe("inspectAndWrapCommandCodeResponse", () => {
  it("converts initial upstream 200 with error event to 503 Response", async () => {
    const ndjsonBody = createNdjsonStream([
      JSON.stringify({
        type: "error",
        error: {
          type: "server_error",
          message: "Service temporarily unavailable. Please try again shortly.",
          statusCode: 503,
          isRetryable: true,
        },
      }) + "\n",
    ]);

    const fakeResponse = new Response(ndjsonBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const result = await inspectAndWrapCommandCodeResponse(fakeResponse, "poolside/laguna-s-2.1-free");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);

    const body = await result.json();
    expect(body.error.message).toContain("Service temporarily unavailable");
    expect(body.error.code).toBe(503);
  });

  it("converts initial upstream 200 with start/start-step followed by error to 503 Response", async () => {
    const ndjsonBody = createNdjsonStream([
      JSON.stringify({ type: "start" }) + "\n",
      JSON.stringify({ type: "start-step" }) + "\n",
      JSON.stringify({
        type: "error",
        error: {
          type: "server_error",
          message: "Service temporarily unavailable. Please try again shortly.",
          statusCode: 503,
          isRetryable: true,
        },
      }) + "\n",
    ]);

    const fakeResponse = new Response(ndjsonBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const result = await inspectAndWrapCommandCodeResponse(fakeResponse, "poolside/laguna-s-2.1-free");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);

    const body = await result.json();
    expect(body.error.message).toContain("Service temporarily unavailable");
  });

  it("streams successful responses when content is emitted", async () => {
    const ndjsonBody = createNdjsonStream([
      JSON.stringify({ type: "start" }) + "\n",
      JSON.stringify({ type: "text-delta", text: "Hello from Laguna" }) + "\n",
      JSON.stringify({ type: "finish" }) + "\n",
    ]);

    const fakeResponse = new Response(ndjsonBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const result = await inspectAndWrapCommandCodeResponse(fakeResponse, "poolside/laguna-s-2.1-free");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);

    const text = await result.text();
    expect(text).toContain("Hello from Laguna");
    expect(text).toContain("data: [DONE]");
  });
});

describe("CommandCode in Combo Fallback", () => {
  it("automatically falls back to next model when commandcode returns 503 error", async () => {
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const handleSingleModel = vi.fn(async (body, modelStr) => {
      if (modelStr === "commandcode/poolside/laguna-s-2.1-free") {
        // Simulated failed CommandCode response
        return new Response(
          JSON.stringify({
            error: {
              message: "Service temporarily unavailable. Please try again shortly.",
              type: "server_error",
              code: 503,
            },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }

      if (modelStr === "openai/gpt-4o-mini") {
        // Fallback model succeeds
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            choices: [{ message: { role: "assistant", content: "Fallback success!" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const comboResponse = await handleComboChat({
      body: { messages: [{ role: "user", content: "Hello" }] },
      models: ["commandcode/poolside/laguna-s-2.1-free", "openai/gpt-4o-mini"],
      handleSingleModel,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(comboResponse.ok).toBe(true);
    expect(comboResponse.status).toBe(200);

    const data = await comboResponse.json();
    expect(data.choices[0].message.content).toBe("Fallback success!");
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
    expect(handleSingleModel).toHaveBeenNthCalledWith(1, expect.anything(), "commandcode/poolside/laguna-s-2.1-free");
    expect(handleSingleModel).toHaveBeenNthCalledWith(2, expect.anything(), "openai/gpt-4o-mini");
  });
});

// Upstream's tests above exercise inspectAndWrapCommandCodeResponse() directly, so
// they stay green even if execute() never calls it. These cover that wiring.
describe("CommandCodeExecutor.execute wiring", () => {
  const ndjson = (lines) => {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const l of lines) controller.enqueue(encoder.encode(JSON.stringify(l) + "\n"));
        controller.close();
      },
    });
  };

  const runExecute = async (lines) => {
    const exec = new CommandCodeExecutor();
    const upstream = new Response(ndjson(lines), {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    });
    // Stub the network hop; we are testing what execute() does with the response.
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(exec));
    const spy = vi.spyOn(proto, "execute").mockResolvedValue({ response: upstream });
    try {
      return await exec.execute({ model: "cc-model" });
    } finally {
      spy.mockRestore();
    }
  };

  it("turns an in-stream error into a non-200 so fallback can see it", async () => {
    const { response } = await runExecute([
      { type: "start" },
      { type: "error", error: { message: "rate limit exceeded" } },
    ]);

    // A 200 here is the whole bug: combo/account fallback keys off the status.
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.message).toContain("rate limit exceeded");
    expect(body.error.type).toBe("rate_limit_error");
  });

  it("passes a normal stream through as SSE with nothing dropped", async () => {
    const { response } = await runExecute([
      { type: "start" },
      { type: "text-delta", delta: "Hello" },
      { type: "text-delta", delta: " world" },
      { type: "finish" },
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const text = await response.text();
    const content = text
      .split("\n")
      .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
      .map((l) => JSON.parse(l.slice(6)))
      .map((c) => c.choices?.[0]?.delta?.content || "")
      .join("");

    // The peek buffers the prefix; replay must not lose or duplicate it.
    expect(content).toBe("Hello world");
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
  });
});

// The peek consumes whole reads, so where the network splits the body must not change
// what the client receives. Every test above feeds exactly one line per enqueue, which
// is the one framing that never exercised the replay. These do.
describe("peek replay is byte-exact regardless of chunk boundaries", () => {
  const bytes = (s) => new TextEncoder().encode(s);
  const bodyOf = (chunks) => new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); },
  });
  const run = async (byteChunks) => {
    const res = await inspectAndWrapCommandCodeResponse(
      new Response(bodyOf(byteChunks), { status: 200 }), "m");
    return await res.text();
  };
  const content = (sse) => sse.split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)))
    .map((c) => c.choices?.[0]?.delta?.content || "")
    .join("");

  const CONVO = [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "AAA" },
    { type: "text-delta", id: "t1", delta: "BBB" },
    { type: "text-delta", id: "t1", delta: "CCC" },
    { type: "finish" },
  ].map((l) => JSON.stringify(l) + "\n");

  it("keeps events that share a read with the first content event", async () => {
    // The stop event is text-delta AAA; BBB, CCC and finish ride in the same read.
    // Rebuilding the replay from parsed lines dropped them and truncated the answer.
    expect(content(await run([bytes(CONVO.join(""))]))).toBe("AAABBBCCC");
  });

  it("gives the same output whatever the framing", async () => {
    const whole = content(await run([bytes(CONVO.join(""))]));
    const perLine = content(await run(CONVO.map(bytes)));
    const split = content(await run([
      bytes(CONVO.join("").slice(0, 90)),
      bytes(CONVO.join("").slice(90)),
    ]));
    expect([whole, perLine, split]).toEqual(["AAABBBCCC", "AAABBBCCC", "AAABBBCCC"]);
  });

  it("does not emit a trailing line twice when the body has no final newline", async () => {
    // Nothing here is in the stop list until the last line, which never terminates --
    // it stayed in the text buffer and was replayed on top of itself.
    const text =
      JSON.stringify({ type: "start" }) + "\n" +
      JSON.stringify({ type: "start-step" }) + "\n" +
      JSON.stringify({ type: "text-delta", id: "t", delta: "ONCE" });
    expect(content(await run([bytes(text)]))).toBe("ONCE");
  });

  it("does not corrupt a multi-byte character split across a read", async () => {
    const raw =
      JSON.stringify({ type: "start" }) + "\n" +
      JSON.stringify({ type: "text-delta", id: "t", delta: "AA" }) + "\n" +
      JSON.stringify({ type: "text-delta", id: "t", delta: "你好世界" }) + "\n";
    const buf = bytes(raw);
    // Cut on a UTF-8 continuation byte, i.e. inside a character.
    let cut = buf.length - 6;
    while (cut > 0 && (buf[cut] & 0xC0) !== 0x80) cut--;
    // Two decoders across the peek boundary lost the leading bytes of that character.
    expect(content(await run([buf.slice(0, cut), buf.slice(cut)]))).toBe("AA你好世界");
  });
});
