import { initState } from "../translator/index.js";
import { openaiResponsesToOpenAIResponse } from "../translator/response/openai-responses.js";
import { parseSSELine, formatSSE } from "./streamHelpers.js";

/**
 * Re-serve a Responses-API SSE reply as OpenAI chat-completion SSE.
 *
 * For executors that must call an upstream /responses endpoint while the rest of
 * the pipeline keeps treating the provider as plain "openai": chatCore's tested
 * openai paths then handle every client format, streaming and non-streaming.
 * GitHub Copilot (gpt/codex models) and OpenCode Go (grok, gpt-luna, Muse Spark)
 * both use it. Status and headers are kept; only the body is converted.
 *
 * `stream` is the client's choice: a [DONE] sent by the upstream is forwarded only
 * to a streaming client.
 */
export function responsesToChatResponse(response, { model, stream }) {
  if (!response.body) {
    return new Response("", { status: response.status, headers: response.headers });
  }

  const state = initState("openai-responses");
  state.model = model;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const emit = (controller, parsed) => {
    const converted = openaiResponsesToOpenAIResponse(parsed, state);
    if (converted) controller.enqueue(encoder.encode(formatSSE(converted, "openai")));
  };
  // Close the reply if the upstream never sent a terminal event (a cut connection,
  // an event shape we do not map): a finish chunk with finish_reason, so a Claude
  // client still gets message_stop. A no-op once completed/incomplete was seen.
  const finish = (controller) => emit(controller, null);

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = parseSSELine(trimmed);
        if (!parsed) continue;
        if (parsed.done) {
          finish(controller); // before [DONE]: readers stop at [DONE]
          if (stream === true) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          continue;
        }
        emit(controller, parsed);
      }
    },
    flush(controller) {
      if (buffer.trim()) {
        const parsed = parseSSELine(buffer.trim());
        if (parsed && !parsed.done) emit(controller, parsed);
      }
      finish(controller);
    },
  });

  return new Response(response.body.pipeThrough(transformStream), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
