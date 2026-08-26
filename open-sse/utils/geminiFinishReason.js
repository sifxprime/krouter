/**
 * Gemini and OpenAI name their stop conditions differently, and Gemini's happen to
 * look close enough to OpenAI's that both the streaming and non-streaming paths simply
 * lower-cased them and passed them off as OpenAI values.
 *
 * That silently broke truncation reporting. Gemini says MAX_TOKENS; OpenAI says
 * "length". Lower-casing produced "max_tokens", which is not an OpenAI finish_reason,
 * so convertFinishReason did not recognise it and fell through to its default -- and a
 * Claude client was told a cut-off answer had finished cleanly with end_turn. Verified
 * live on ag/gemini-3.5-flash-low with max_tokens:8 on both paths.
 *
 * Antigravity normalises every model it serves -- Gemini, Claude and GPT alike -- to
 * the Gemini envelope, so this covers all Antigravity traffic, not just Gemini models.
 */
const GEMINI_FINISH_REASONS = {
  stop: "stop",
  max_tokens: "length",
  safety: "content_filter",
  recitation: "content_filter",
  blocklist: "content_filter",
  prohibited_content: "content_filter",
  spii: "content_filter",
};

/**
 * Map a Gemini finishReason onto its OpenAI equivalent.
 * Unrecognised values fall back to "stop", matching the previous behaviour for
 * anything Google adds later rather than inventing a reason we cannot justify.
 */
export function geminiFinishReasonToOpenAI(reason) {
  if (!reason) return "stop";
  return GEMINI_FINISH_REASONS[String(reason).toLowerCase()] || "stop";
}

export { GEMINI_FINISH_REASONS };
