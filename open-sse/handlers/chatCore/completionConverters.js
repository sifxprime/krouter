import { convertFinishReason } from "../../translator/response/openai-to-claude.js";

function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

// chat.completion -> the client's own format, shared by the non-streaming handler
// and the forced-stream SSE->JSON handler (which used to hand every client the raw
// chat.completion). Kept apart so the two handlers do not import each other.

/**
 * Convert an OpenAI chat.completion body into a Claude message body.
 *
 * Used when the provider speaks OpenAI but the client speaks Claude and the
 * request was non-streaming. Mirrors the block order the streaming translator
 * produces: thinking, then text, then tool_use.
 */
export function openAICompletionToClaudeMessage(responseBody) {
  if (!responseBody?.choices?.[0]) return responseBody;
  const choice = responseBody.choices[0];
  const message = choice.message || {};
  const content = [];

  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning) content.push({ type: "thinking", thinking: reasoning });
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content });
  }
  for (const toolCall of message.tool_calls || []) {
    const fn = toolCall.function || {};
    content.push({
      type: "tool_use",
      id: toolCall.id || `toolu_${Date.now()}_${content.length}`,
      name: fn.name || toolCall.name || "",
      input: parseToolArguments(fn.arguments || toolCall.arguments),
    });
  }
  // Claude clients require a non-empty content array.
  if (content.length === 0) content.push({ type: "text", text: "" });

  const usage = responseBody.usage || {};
  return {
    id: String(responseBody.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, ""),
    type: "message",
    role: "assistant",
    model: responseBody.model || "unknown",
    content,
    stop_reason: convertFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: usage.completion_tokens || usage.output_tokens || 0,
    },
  };
}

/**
 * Translate non-streaming response body from provider format → OpenAI format.
 */
/**
 * OpenAI chat.completion -> Responses API response object.
 *
 * A Responses client (`/v1/responses`, stream:false) served by an OpenAI-format
 * provider used to receive the raw chat.completion back, which it cannot read.
 * This made every such provider unusable non-streaming from Responses clients --
 * including OpenCode Go's Responses-only models, which kRouter reaches through an
 * executor that converts their replies to chat (#23).
 */
export function openAICompletionToResponsesObject(completion) {
  const choice = completion?.choices?.[0];
  if (!choice) return completion;
  const message = choice.message || {};
  const rawId = String(completion.id || `${Date.now()}`);
  const id = rawId.startsWith("resp_") ? rawId : `resp_${rawId}`;

  const text = typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content) ? message.content.map((p) => p?.text || "").join("") : "";
  const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : "";

  const output = [
    ...(reasoning ? [{ type: "reasoning", id: `rs_${id}`, summary: [{ type: "summary_text", text: reasoning }] }] : []),
    ...(text ? [{ type: "message", id: `msg_${id}`, role: "assistant", status: "completed",
      content: [{ type: "output_text", text, annotations: [] }] }] : []),
    ...(message.tool_calls || []).map((tc) => ({
      type: "function_call", id: `fc_${tc.id}`, call_id: tc.id, name: tc.function?.name,
      arguments: tc.function?.arguments || "{}", status: "completed",
    })),
  ];

  const usage = completion.usage;
  const truncated = choice.finish_reason === "length";
  return {
    id,
    object: "response",
    created_at: completion.created || Math.floor(Date.now() / 1000),
    model: completion.model,
    status: truncated ? "incomplete" : "completed",
    ...(truncated ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
    output,
    ...(usage ? { usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens ?? ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)),
      input_tokens_details: { cached_tokens: usage.prompt_tokens_details?.cached_tokens || 0 },
      output_tokens_details: { reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens || 0 },
    } } : {}),
  };
}
