/**
 * Empty-completion diagnosis.
 *
 * A provider can return HTTP 200 with a well-formed body and no output at all.
 * Passed through untouched, that is indistinguishable from a broken provider,
 * and the usual conclusion is "the router is broken".
 *
 * The case that prompted this: `ag/gemini-3.5-flash-low` with `max_tokens: 40`
 * reported `finish_reason: "max_tokens"` and
 * `completion_tokens_details.reasoning_tokens: 37` — the model spent its entire
 * allowance thinking and had nothing left to emit. Nothing failed; the budget
 * was simply too small. Raising it to 400 produced output on the first try.
 *
 * These helpers are pure so the handlers can stay thin and the conditions stay
 * testable without a live provider.
 */

// finish_reason values that mean "the token budget ran out", across formats.
const TRUNCATED = new Set(["max_tokens", "length", "MAX_TOKENS"]);

function readReasoningTokens(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const n =
    usage.completion_tokens_details?.reasoning_tokens ??
    usage.output_tokens_details?.reasoning_tokens ??
    usage.reasoning_tokens ??
    0;
  return Number.isFinite(n) ? n : 0;
}

function readCompletionTokens(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const n = usage.completion_tokens ?? usage.output_tokens ?? 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * @returns {null|{code:string,message:string,reasoningTokens:number,completionTokens:number,finishReason:string|null}}
 *   null when the response carried real output; a diagnosis otherwise.
 */
export function detectEmptyCompletion({ finishReason, text, toolCalls, usage, maxTokens } = {}) {
  // Tool calls are output. So is any non-whitespace text.
  if (Array.isArray(toolCalls) && toolCalls.length > 0) return null;
  if (typeof text === "string" && text.trim() !== "") return null;

  const reasoningTokens   = readReasoningTokens(usage);
  const completionTokens  = readCompletionTokens(usage);

  // Absence of text is not proof of absence of output. In passthrough
  // streaming the router forwards bytes without parsing them, so the
  // accumulated content is empty even on a perfectly good response — flagging
  // on text alone marks every passthrough stream as empty.
  //
  // completion_tokens minus reasoning_tokens is the real output count and does
  // not depend on capture. Measured live on the same model and prompt:
  //   max_tokens 400 -> completion 78, reasoning 76  => 2 output tokens ("AG OK")
  //   max_tokens 40  -> completion 37, reasoning 37  => 0 output tokens (empty)
  // Only trust it when the provider actually reported a breakdown.
  if (reasoningTokens > 0 && completionTokens > 0 && completionTokens - reasoningTokens > 0) {
    return null;
  }
  const truncated         = finishReason != null && TRUNCATED.has(String(finishReason));

  // Reasoning that consumed the entire completion budget is the reasoning-budget
  // case whether or not the provider reported a finish reason. The streaming
  // path has no finish_reason to offer, so requiring one here would misfile the
  // exact case this exists to catch.
  if (reasoningTokens > 0 && completionTokens > 0 && completionTokens - reasoningTokens <= 0) {
    const budget = Number.isFinite(maxTokens) ? ` of a max_tokens of ${maxTokens}` : "";
    return {
      code: "empty_completion_reasoning_budget",
      finishReason: finishReason ?? null,
      reasoningTokens,
      completionTokens,
      message:
        `The model spent ${reasoningTokens} token(s)${budget} on internal reasoning and had none left ` +
        `to answer with. This is a token budget problem, not a provider failure — raise max_tokens and retry.`,
    };
  }

  if (truncated) {
    return {
      code: "empty_completion_truncated",
      finishReason: finishReason ?? null,
      reasoningTokens,
      completionTokens,
      message: "The response hit the token limit before producing any output. Raise max_tokens and retry.",
    };
  }

  return {
    code: "empty_completion_no_output",
    finishReason: finishReason ?? null,
    reasoningTokens,
    completionTokens,
    message:
      `The provider returned no output and reported finish_reason "${finishReason ?? "unknown"}". ` +
      `This is a provider-side fault rather than a token budget problem.`,
  };
}

/**
 * Normalise an OpenAI-shaped or Claude-shaped response body into the fields
 * detectEmptyCompletion needs, so handlers do not have to branch on format.
 *
 * @returns {{text:string, finishReason:string|null, toolCalls:Array, usage:object|null}}
 */
export function readCompletionShape(body) {
  const empty = { text: "", finishReason: null, toolCalls: [], usage: null };
  if (!body || typeof body !== "object") return empty;

  const usage = body.usage && typeof body.usage === "object" ? body.usage : null;

  // Gemini / Antigravity envelope. This has to come first: the handler diagnoses the
  // response BEFORE translating it, so what arrives here is the provider's own body,
  // not an OpenAI completion. Antigravity normalises every model it serves to this
  // shape, so without this branch each of its healthy non-streaming responses read as
  // {text:"", usage:null} and was filed as empty_completion_no_output.
  // Note the envelope may be wrapped ({response:{candidates}}) or bare ({candidates}).
  const gemini = Array.isArray(body.response?.candidates)
    ? body.response
    : Array.isArray(body.candidates)
      ? body
      : null;
  if (gemini) {
    const parts = gemini.candidates[0]?.content?.parts || [];
    const meta = gemini.usageMetadata || {};
    return {
      // parts carrying `thought: true` are reasoning, not answer text -- counting them
      // as output would mask the reasoning-budget case this module exists to detect.
      text: parts
        .filter((pt) => pt && pt.thought !== true && typeof pt.text === "string")
        .map((pt) => pt.text)
        .join(""),
      finishReason: gemini.candidates[0]?.finishReason ?? null,
      toolCalls: parts.filter((pt) => pt && pt.functionCall),
      usage: {
        completion_tokens: meta.candidatesTokenCount || 0,
        completion_tokens_details: { reasoning_tokens: meta.thoughtsTokenCount || 0 },
      },
    };
  }

  // Claude Messages shape: { type: "message", content: [...], stop_reason }
  if (Array.isArray(body.content)) {
    const blocks = body.content.filter(Boolean);
    return {
      text: blocks.filter(b => b.type === "text").map(b => b.text || "").join(""),
      finishReason: body.stop_reason ?? null,
      toolCalls: blocks.filter(b => b.type === "tool_use"),
      usage,
    };
  }

  // OpenAI Chat Completions shape
  const choice = Array.isArray(body.choices) ? body.choices[0] : null;
  if (!choice) return { ...empty, usage };

  const msg = choice.message || choice.delta || {};
  const content = msg.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter(c => c && (c.type === "text" || typeof c.text === "string")).map(c => c.text || "").join("")
      : "";

  return {
    text,
    finishReason: choice.finish_reason ?? null,
    toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
    usage,
  };
}

/** Log status for an empty completion, so it is not filed alongside real 200s. */
export function EMPTY_COMPLETION_STATUS(diagnosis) {
  if (!diagnosis) return "200 OK";
  if (diagnosis.code === "empty_completion_reasoning_budget") return "200 EMPTY (reasoning budget)";
  if (diagnosis.code === "empty_completion_truncated") return "200 EMPTY (truncated)";
  return "200 EMPTY (no output)";
}
