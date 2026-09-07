import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { convertCommandCodeToOpenAI } from "../translator/response/commandcode-to-openai.js";

/**
 * CommandCodeExecutor — talks to https://api.commandcode.ai/alpha/generate
 *
 * Auth: Bearer <user_xxx> API key (stored as the connection's apiKey).
 * Adds the per-request `x-session-id` header expected by CommandCode upstream.
 *
 * Upstream returns AI SDK v5 NDJSON (one JSON event per line, no `data:` prefix).
 * We translate each event to an OpenAI chat.completion.chunk and emit it as SSE so
 * both the streaming and non-streaming (forced SSE → JSON) downstream handlers in
 * 9router can consume it without further format translation.
 */
export class CommandCodeExecutor extends BaseExecutor {
  constructor() {
    super("commandcode", PROVIDERS.commandcode);
  }

  transformRequest(model, body, stream, credentials) {
    body.stream = true;
    return body;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...(this.config.headers || {}),
      "x-session-id": randomUUID(),
    };

    const token = credentials?.apiKey || credentials?.accessToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async execute(opts) {
    const result = await super.execute(opts);
    if (!result?.response?.ok || !result.response.body) return result;
    result.response = await inspectAndWrapCommandCodeResponse(result.response, opts.model);
    return result;
  }

  // Lets parseUpstreamError() pull a clean message/status out of the body we
  // synthesize below, instead of showing the raw JSON envelope to the user.
  parseError(response, bodyText) {
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText || "{}");
    } catch {
      parsed = null;
    }
    const errObj = parsed?.error || parsed;
    const msg = errObj?.message || parsed?.message || bodyText || response.statusText;
    const status = Number(errObj?.code || errObj?.statusCode || response.status) || response.status;
    return {
      status,
      message: msg || `CommandCode upstream error: ${response.status}`,
    };
  }
}

// CommandCode reports failures as a type:"error" event inside an HTTP 200 NDJSON
// stream. Combo and account fallback key off response.status, so a 200 never
// triggered them and the error text was streamed to the client as content.
// Map the event onto a real status so the existing fallback logic can see it.
export function parseCommandCodeError(event) {
  if (!event || typeof event !== "object") {
    return { statusCode: 503, message: "CommandCode upstream error", type: "server_error" };
  }

  const errVal = event.error ?? event.message ?? "unknown";
  let message = "";
  let statusCode = null;
  let type = "server_error";

  if (typeof errVal === "object" && errVal !== null) {
    message = errVal.message || errVal.error || JSON.stringify(errVal);
    if (errVal.statusCode && Number.isInteger(Number(errVal.statusCode))) {
      statusCode = Number(errVal.statusCode);
    } else if (errVal.status && Number.isInteger(Number(errVal.status))) {
      statusCode = Number(errVal.status);
    }
    if (errVal.type) type = errVal.type;
  } else if (typeof errVal === "string") {
    message = errVal;
  } else {
    message = JSON.stringify(errVal);
  }

  if (event.statusCode && Number.isInteger(Number(event.statusCode))) {
    statusCode = Number(event.statusCode);
  }

  // No usable status on the event: infer one from the text, so a rate limit
  // fails over differently than an auth failure.
  if (!statusCode || statusCode < 400 || statusCode > 599) {
    const lower = message.toLowerCase();
    if (lower.includes("rate limit") || lower.includes("too many requests")) {
      statusCode = 429;
      type = "rate_limit_error";
    } else if (lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("authentication")) {
      statusCode = 401;
      type = "authentication_error";
    } else if (lower.includes("payment required") || lower.includes("billing")) {
      statusCode = 402;
      type = "billing_error";
    } else if (lower.includes("quota") || lower.includes("forbidden") || lower.includes("permission")) {
      statusCode = 403;
      type = "permission_error";
    } else if (lower.includes("not found")) {
      statusCode = 404;
      type = "invalid_request_error";
    } else if (lower.includes("unavailable") || lower.includes("overloaded") || lower.includes("server error")) {
      statusCode = 503;
      type = "server_error";
    } else {
      statusCode = 503;
    }
  }

  return { statusCode, message, type };
}

// Peek at the leading NDJSON events before committing to the stream. Stops at the
// first event that proves the stream is real content, so the happy path reads only
// a chunk or two ahead; everything buffered is replayed losslessly.
export async function inspectAndWrapCommandCodeResponse(originalResponse, model) {
  const reader = originalResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Every chunk pulled off the reader, kept as raw bytes. The replay re-emits these
  // verbatim rather than rebuilding text from parsed lines: reconstructing loses any
  // line the peek did not walk, duplicates the trailing partial one, and splits
  // multi-byte characters across two decoders. Bytes in, same bytes out.
  const consumed = [];
  let detectedError = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        // A final line with no trailing newline never became a complete line above.
        const trimmed = buffer.trim();
        if (trimmed) {
          try {
            const jsonStr = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
            const parsed = JSON.parse(jsonStr);
            if (parsed?.type === "error") detectedError = parsed;
          } catch { /* not an error event; it replays with everything else */ }
        }
        break;
      }

      consumed.push(value);
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let stopLoop = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const jsonStr = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
        if (!jsonStr || jsonStr === "[DONE]") { stopLoop = true; break; }

        let event;
        try {
          event = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (event?.type === "error") {
          detectedError = event;
          stopLoop = true;
          break;
        }

        // Any of these proves real content is flowing -- stop peeking.
        if (
          event?.type === "text-delta" ||
          event?.type === "reasoning-delta" ||
          event?.type === "tool-input-start" ||
          event?.type === "tool-call" ||
          event?.type === "finish" ||
          event?.type === "finish-step"
        ) {
          stopLoop = true;
          break;
        }
      }

      if (stopLoop) break;
    }
  } catch {
    // Could not peek: hand back the original rather than dropping the response.
    try { reader.releaseLock(); } catch { /* ignore */ }
    return originalResponse;
  }

  if (detectedError) {
    try { await reader.cancel(); } catch { /* ignore */ }
    const { statusCode, message, type } = parseCommandCodeError(detectedError);
    return new Response(
      JSON.stringify({ error: { message: `[CommandCode error: ${message}]`, type, code: statusCode } }),
      {
        status: statusCode,
        statusText: statusCode === 503 ? "Service Unavailable" : (statusCode === 429 ? "Too Many Requests" : "Bad Gateway"),
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );
  }

  return wrapNdjsonAsOpenAISse(createReplayedStream(consumed, reader), model, originalResponse);
}

// Re-emits the bytes the peek consumed, then hands through the rest of the reader.
function createReplayedStream(consumedChunks, reader) {
  let replayed = false;

  return new ReadableStream({
    async pull(controller) {
      if (!replayed) {
        replayed = true;
        for (const chunk of consumedChunks) controller.enqueue(chunk);
      }

      try {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } catch { /* ignore */ }
    },
  });
}

function buildSseHeaders(originalResponse) {
  const headers = new Headers();
  if (originalResponse?.headers) {
    for (const [k, v] of originalResponse.headers.entries()) headers.set(k, v);
  }
  headers.set("Content-Type", "text/event-stream");
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");
  return headers;
}

function wrapNdjsonAsOpenAISse(streamBody, model, originalResponse = null) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const state = { model };

  const emitChunks = (chunks, controller) => {
    if (!chunks) return;
    const list = Array.isArray(chunks) ? chunks : [chunks];
    for (const c of list) {
      if (c == null) continue;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
    }
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Translate AI SDK v5 NDJSON line to one or more OpenAI chunks
        emitChunks(convertCommandCodeToOpenAI(trimmed, state), controller);
      }
    },
    flush(controller) {
      const trimmed = buffer.trim();
      if (trimmed) {
        emitChunks(convertCommandCodeToOpenAI(trimmed, state), controller);
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  });

  const newBody = streamBody.pipeThrough(transform);
  return new Response(newBody, {
    status: originalResponse?.status || 200,
    statusText: originalResponse?.statusText || "OK",
    headers: buildSseHeaders(originalResponse),
  });
}

export default CommandCodeExecutor;
