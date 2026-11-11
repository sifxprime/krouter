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

// 0.5.172 — a 200 whose entire "answer" is the vendor telling you the model is gone.
//
// Measured live, requesting ag/claude-sonnet-4-6, an id still in the catalogue:
//   HTTP 200
//   {"object":"chat.completion","model":"gemini","choices":[{"message":{
//     "content":"Claude Sonnet 4.6 is no longer available. Please switch to Claude Sonnet 5.5."},
//     "finish_reason":"stop"}]}
//
// Nothing in the tree saw a problem: finish_reason is a clean "stop", there is text, so
// it counted as a success. It was billed, recorded in usage as ok, rendered to the user
// as if the model had said it, and a combo did not fall through to its next entry —
// isZeroContentResponse rejects anything whose finish_reason is not in/incomplete.
//
// The risk in detecting this is a false positive: a model legitimately ANSWERING a
// question about a retired model would say much the same words, and eating that reply
// would be worse than the bug. So the gate is a conjunction, and every part must hold:
//   - no tool calls (a notice never calls tools)
//   - the whole message is short — a notice, not an explanation
//   - it says the thing is gone, AND it names a replacement; vendors always do both
//   - when the caller tells us which model was requested, the text must NAME that model
// The last one is what makes it safe in practice: a user asking "is Sonnet 4.6 still
// around?" while calling a DIFFERENT model does not match, and a vendor notice always
// names the model you asked for.
const RETIREMENT_MAX_CHARS = 200;
const RETIREMENT_GONE = /\b(no longer (available|supported|offered)|has been (retired|deprecated|discontinued|removed|sunset)|is (retired|deprecated|discontinued|unavailable))\b/i;
const RETIREMENT_REPLACEMENT = /\b(switch|migrate|upgrade|move|update|change)\s+to\b|\bplease use\b|\binstead\b/i;

/** Normalised for comparison: "ag/claude-sonnet-4-6" and "Claude Sonnet 4.6" both -> claudesonnet46 */
function normaliseModelToken(v) {
  return String(v || "").replace(/^[^/]*\//, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function detectVendorRetirementNotice({ text, toolCalls, model } = {}) {
  if (Array.isArray(toolCalls) && toolCalls.length > 0) return null;
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t || t.length > RETIREMENT_MAX_CHARS) return null;
  if (!RETIREMENT_GONE.test(t) || !RETIREMENT_REPLACEMENT.test(t)) return null;
  if (model) {
    const want = normaliseModelToken(model);
    // A bare or very short id would match almost anything; require something substantial.
    if (want.length >= 6 && !normaliseModelToken(t).includes(want)) return null;
  }
  return {
    code: "vendor_retirement_notice",
    message: `The provider answered 200 with a retirement notice instead of a completion: "${t}"`,
    notice: t,
    reasoningTokens: 0,
    completionTokens: 0,
    finishReason: null,
  };
}

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
export function detectEmptyCompletion({ finishReason, text, toolCalls, usage, maxTokens, model } = {}) {
  // 0.5.172 — a retirement notice IS text, so it has to be judged before the
  // "there is text, therefore there was output" early return below.
  const retirement = detectVendorRetirementNotice({ text, toolCalls, model });
  if (retirement) return retirement;

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
  if (diagnosis.code === "vendor_retirement_notice") return "200 RETIREMENT NOTICE (not an answer)";
  return "200 EMPTY (no output)";
}
