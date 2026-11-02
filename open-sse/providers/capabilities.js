// Model capabilities — what each model can read/do beyond plain text.
//
// Fallback order (first match wins), result merged over DEFAULT_CAPABILITIES:
//   1. PROVIDER_CAPABILITIES[provider][model]  — provider-specific override
//   2. MODEL_CAPABILITIES[model]               — canonical exact id (handles exceptions)
//   3. PATTERN_CAPABILITIES                     — glob match, ordered specific -> generic
//   4. DEFAULT_CAPABILITIES                     — safe floor (always returned)
//
// ── HOW TO ADD / UPDATE A MODEL ──────────────────────────────────────
// Authoritative data source: https://models.dev/api.json (145 providers, 4000+
// models, MIT). Each model exposes the exact fields we map below:
//   modalities.input  ["text","image","pdf","audio","video"] -> vision / pdf / audioInput / videoInput
//   modalities.output ["text","image","audio"]               -> imageOutput / audioOutput
//   reasoning   -> reasoning      tool_call    -> tools
//   limit.context -> contextWindow   limit.output -> maxOutput
// Look up the model id, then:
//   • If a PATTERN below already covers it correctly -> nothing to do.
//   • If it is an exception (pattern would mis-match) -> add an exact entry to
//     MODEL_CAPABILITIES (only the fields that differ from DEFAULT).
//   • If a whole new family -> add an ordered PATTERN (specific before generic).
// NOTE: models.dev has NO "search" flag (web search is a runtime tool, not a
// model spec); set `search` from vendor docs (Claude 4.x+, GPT-5.x/4o, Gemini
// 2.0+, Grok, Perplexity). Verify with: curl -s https://models.dev/api.json

// Inline matchPattern — avoids pulling in pricing.js (Wave-2 module not in our tree).
// Same glob-with-* semantics, anchored case-insensitive.
function matchPattern(pattern, model) {
  const regex = new RegExp("^" + pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  return regex.test(model);
}

/**
 * Safe floor — every resolved result is merged over this so consumers
 * never need null-checks. Most modern LLMs meet these limits.
 */
export const DEFAULT_CAPABILITIES = {
  // input modalities
  vision: false,        // read images
  pdf: false,           // read PDF / documents
  audioInput: false,    // read audio
  videoInput: false,    // read video
  // output modalities
  imageOutput: false,   // generate images
  audioOutput: false,   // generate audio
  // features
  search: false,        // built-in web search tool / grounding
  tools: true,          // function / tool calling
  reasoning: false,     // thinking / reasoning
  // thinking wire format (only meaningful when reasoning:true). null → derive from transport.format.
  // enum: openai|claude-adaptive|claude-budget|gemini-level|gemini-budget|zai|qwen|deepseek|kimi|minimax|hunyuan|step
  thinkingFormat: null,
  thinkingCanDisable: true,  // false → model cannot turn thinking off (clamp to min instead of disable)
  thinkingRange: null,       // { min, max } for budget formats; null = no clamp
  // limits (tokens)
  contextWindow: 200000,
  maxOutput: 64000,
};

// User-added model metadata can carry dashboard service kinds instead of the
// runtime capability names used here. Map those typed model kinds into input /
// output capabilities so custom vision models are not treated as text-only.
const SERVICE_KIND_CAPABILITIES = {
  imageToText: { vision: true },
  image: { imageOutput: true },
  stt: { audioInput: true },
  tts: { audioOutput: true },
  embedding: { tools: false },
};

export function capabilitiesFromServiceKind(kind) {
  return SERVICE_KIND_CAPABILITIES[kind] || null;
}

/**
 * Canonical exact-id overrides — used for exceptions that patterns would
 * otherwise mis-match. Only declare deltas vs DEFAULT.
 */
export const MODEL_CAPABILITIES = {
  // Claude 4.6/4.7 have 1M context + adaptive thinking (override generic claude pattern).
  // 0.5.166 — every current Claude row reads PDFs (upstream f5f88039,
  // platform.claude.com/docs/en/build-with-claude/pdf-support); without it the
  // opt-in pdf pool went in front of Claude.
  "claude-opus-4.6":   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.7":   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-6":   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-4.6": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 64000 },
  // 0.5.164 — Claude API ids (cc / anthropic), from each model's page under
  // platform.claude.com/docs/en/models (2026-10-06). The dash ids missed the
  // dotted patterns and fell to *claude*opus* / *claude*sonnet*, publishing a
  // 200K context, 64K output and budget thinking. Sonnet 4.6 output is 128K.
  "claude-sonnet-4-6": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-7":   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-8":   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5":     { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5":   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  // Opus 5.5 and Sonnet 5.5 answer thinking "disabled" with a 400 (Sonnet 5.5's
  // floor is "between_tools"), so thinking cannot be turned off.
  "claude-opus-5-5":   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-5": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },
  // 0.5.166 — Antigravity serves the same two models as per-effort ids (upstream
  // a07ed95b). The *claude*opus-5* / *claude*sonnet-5* patterns cover their window
  // but not thinkingCanDisable, so the tier ids were offering a "none" that 400s.
  ...Object.fromEntries(["high", "medium", "low"].flatMap((tier) => [
    [`claude-opus-5-5-${tier}`,   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 }],
    [`claude-sonnet-5-5-${tier}`, { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 }],
  ])),

  // Gemini image-gen / OpenAI image / xai image variants
  "gpt-image-1":       { imageOutput: true, tools: false },

  // GLM vision variants (text GLM has no vision). 0.5.166 — 5.3-Flash is natively
  // multimodal with the full 1M window; 4.6V/4.5V also read video (upstream 9c650e1d,
  // limits from models.dev zai). *glm-5* would have made 5.3-Flash text-only, so the
  // image pool went in front of ocg's "GLM 5.3 Flash (Vision)".
  "glm-5.3-flash":     { vision: true, videoInput: true, pdf: true, reasoning: true, thinkingFormat: "zai", contextWindow: 1000000, maxOutput: 131072 },
  "glm-4.6v":          { vision: true, videoInput: true, reasoning: true, thinkingFormat: "zai", contextWindow: 128000, maxOutput: 32768 },
  "glm-4.5v":          { vision: true, videoInput: true, reasoning: true, thinkingFormat: "zai", contextWindow: 64000, maxOutput: 16384 },

  // 0.5.166 — DeepSeek V4.1-Flash reads images (upstream 9c650e1d, 912ed295, 8a4f4d9d).
  // api-docs.deepseek.com/quick_start/pricing (2026-10-18): deepseek-flash is
  // V4.1-Flash, "Vision ✓", 1M context, 384K output; the -vision-exp id is served by it.
  // Upstream gives deepseek-flash 128K/64K; kRouter follows DeepSeek's page.
  // deepseek-v4-1-flash is the dash spelling some hosts (Kenari) use.
  "deepseek-v4-flash-vision-exp": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
  "deepseek-v4.1-flash": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
  "deepseek-v4-1-flash": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
  "deepseek-flash":      { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },

  // Qwen plain coder/text (no vision) — registry "vision-model" / "coder-model" aliases
  "vision-model":      { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 },
  "coder-model":       { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 },
};

// 0.5.166 — the *gpt-5.4/5.5/5.6* and *gpt-6* patterns now carry the 1.05M API
// window (upstream 89ffac5a). Hosts that truncate lower keep their own number here,
// which wins over the patterns. Rows are full: a provider row short-circuits them.
const gptCaps = (contextWindow) => ({ vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow, maxOutput: 128000 });

// Kiro serves GPT-5.6 at 272K and answers CONTENT_LENGTH_EXCEEDS_THRESHOLD above it
// (v0.5.104, upstream b94685b8; this used to be the *gpt-5.6* pattern itself).
const KIRO_GPT_5_6 = Object.fromEntries(
  ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].flatMap((id) =>
    ["", "-thinking", "-agentic", "-thinking-agentic"].map((suffix) => [`${id}${suffix}`, gptCaps(272000)])),
);

// Codex OAuth (ChatGPT backend) reports windows below the API's: GPT-6 at 272K,
// GPT-5.6 Sol 372K, Terra/Luna 272K (upstream 79918c78, 92c7bdd5). -review ids are
// the same upstream model (withCodexReviewModels).
// 0.5.166 — gpt-5.5 / gpt-5.4 left the cx catalog (upstream 7878f53b retired them
// for ChatGPT sign-in). Their rows stay so a stored combo or a hand-typed cx id
// still resolves a real window instead of the 200K floor.
// gpt-6.1-sol, gpt-daybreak-blue-latest and gpt-reserve are deliberately absent:
// upstream publishes no OAuth window for them either, so they inherit the
// *gpt-6* pattern / the floor until a backend-api/codex/models probe reads theirs.
const CODEX_WINDOWS = {
  "gpt-6-astra": 272000, "gpt-6-sol": 272000, "gpt-6-luna": 272000,
  "gpt-5.6-sol": 372000, "gpt-5.6-terra": 272000, "gpt-5.6-luna": 272000,
  "gpt-5.5": 400000, "gpt-5.4": 400000,
};
const CODEX_GPT = Object.fromEntries(
  Object.entries(CODEX_WINDOWS).flatMap(([id, window]) => [[id, gptCaps(window)], [`${id}-review`, gptCaps(window)]]),
);

/**
 * Provider-specific capability overrides. Keyed by provider alias/id.
 */
export const PROVIDER_CAPABILITIES = {
  // Keyed by both id and alias: the Kiro executor and /v1/models pass the id,
  // combos and the capacity adapter pass the alias.
  kiro: KIRO_GPT_5_6,
  kr: KIRO_GPT_5_6,
  codex: CODEX_GPT,
  cx: CODEX_GPT,
  // CodeBuddy.cn — authoritative per-model metadata from the gateway's model
  // config (contextWindow=maxInputTokens, maxOutput=maxOutputTokens, vision=
  // supportsImages). Every model reasons via OpenAI-style reasoning_effort
  // (see registry thinkingFormat). `onlyReasoning` models can't turn thinking
  // off → thinkingCanDisable:false (clamped to minimal instead of disabled).
  "codebuddy-cn": {
    // 0.5.166 — refreshed from the 2026-09-30 product-config snapshot (upstream
    // e014cb53, cec672d9, 807553e2, 63de82b8). thinkingCanDisable maps to the
    // server's reasoning.canDisableThinking, which is NOT the inverse of
    // onlyReasoning: onlyReasoning means "thinking is on by default",
    // canDisableThinking means "it CAN be turned off". glm-5.2/5.3 and the DeepSeek
    // V4 pair are both, so reporting false here clamped every client "none" to
    // minimal. The hy* models really are forced always-on. The old 48000 output caps
    // had no source and truncated long answers.
    "glm-5.3":            { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 131072 },
    "glm-5.3-flash":      { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 131072 },
    "glm-5.2":            { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 131072 },
    "kimi-k3-1":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 1048576 },
    // contextWindow is the server's contextWindow.defaultLength, NOT maxInputTokens:
    // k2.8 publishes supportedLengths [300000, 1000000] and only gives 1M when the
    // request opts in, which this executor never does. Budgeting history for 1M
    // would overflow the window the model actually has.
    "kimi-k2.8-preview":  { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 300000, maxOutput: 131072 },
    "hy3":                { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 192000, maxOutput: 64000 },
    "hy4-preview":        { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 64000 },
    // deepseek-v4.1-flash replaced v4-flash on the server list; the 2026-09-30
    // snapshot raised maxOutput to 393216 and changed the published efforts from
    // low/high/xhigh to low/high/max.
    "deepseek-v4.1-flash": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 393216 },
    "glm-5.1":            { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5.0":            { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 48000 },
    "glm-5.0-turbo":      { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5v-turbo":       { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 38000 },
    "glm-4.7":            { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 48000 },
    "minimax-m3":         { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 512000, maxOutput: 524288 },
    "minimax-m2.7":       { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "kimi-k2.7":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 32000 },
    "kimi-k2.6":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 32000 },
    "kimi-k2.5":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 164000, maxOutput: 32000 },
    "hy3-preview":        { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 192000, maxOutput: 64000 },
    // 0.5.164 — no vision: DeepSeek lists V4 Pro image input as "Not supported"
    // (api-docs.deepseek.com/quick_start/pricing); the gateway flag cannot add it.
    "deepseek-v4-pro":    { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 393216 },
    "deepseek-v4-flash":  { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 50000 },
    "deepseek-v3-2-volc": { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 96000, maxOutput: 32000 },
  },
  // 0.5.166 (upstream 2ab6a4c9) — Qoder publishes opaque internal ids (dfmodel,
  // gfmodel, ...). The catalog `name` is display-only and capability lookup matches
  // the raw id, so no pattern can reach them and every Qoder model claimed the 200K
  // default window. contextWindow follows the real model family: the gateway's
  // max_input_tokens under-reports some windows (GLM-5.3 / Kimi-K3 / Qwen3.8-Max all
  // claim 180K but accept more) and max_output_tokens arrives as 0 for every model.
  // thinkingCanDisable is false everywhere on purpose: the executor forwards only
  // messages/tools/max_tokens and thinking is fixed server-side by the model config,
  // so a client's "none" is dropped and must never be offered.
  "qoder": {
    "ultimate":       { vision: true, reasoning: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 }, // Claude Opus 5
    "auto":           { vision: true, reasoning: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },
    "performance":    { vision: true, reasoning: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 }, // Claude Sonnet 5
    "efficient":      { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },
    "lite":           { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },
    "dmodel":         { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },  // DeepSeek-V4-Pro
    "dfmodel":        { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },  // DeepSeek-V4-Flash
    "gmodel":         { reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },      // GLM-5.3
    "gfmodel":        { vision: true, reasoning: true, thinkingFormat: "zai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 }, // GLM-5.3-Flash
    "kmodel":         { vision: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 256000, maxOutput: 65536 },  // Kimi-K2.7-Code
    "mmodel":         { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 512000 },  // MiniMax-M3
    "qmodel_latest":  { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },  // Qwen3.7-Max
    "qmodel":         { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },  // Qwen3.7-Plus
    "qfmodel":        { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },  // Qwen3.8-Flash
    "qmodel_38max":   { vision: true, reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 65536 },  // Qwen3.8-Max
  },
  // 0.5.166 (upstream 5c399b64) — Ollama Cloud's DeepSeek V4.1 Flash. The generic
  // *deepseek-v4* pattern misses the vision badge the library page publishes, and
  // the ":cloud" suffix keeps it out of the plain deepseek rows.
  "ollama": {
    "deepseek-v4.1-flash:cloud": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
  },
  // 0.5.166 (upstream c8644368) — OpenCode Go's claude-haiku-5-5 answers
  // thinking.type "enabled" — what the global *claude*haiku* -> claude-budget
  // pattern sends — with 400 ("use thinking.type.adaptive and
  // output_config.effort"). claude-adaptive emits exactly that shape. Limits follow
  // the model, not the pattern: the Go catalog reports context_length 1000000.
  "opencode-go": {
    "claude-haiku-5-5": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  },
  // OpenCode Free (oc). The free lane has no static catalog here, so its ids fall
  // through to the pattern table and pick up the paid deepseek-v4.1-flash row's
  // 1000000/384000. The free backend rejects prompts above ~330k tokens (upstream
  // 1da5b0d7, #5097), and clients size their compaction budget from the published
  // context_length (src/app/api/v1/models/route.js), so they never compacted and the
  // session hard-failed mid-run with a 400.
  //
  // Only the limits change: vision, reasoning and thinkingFormat are what this id
  // already resolved to. maxOutput drops to 128000 to stay <= contextWindow, since a
  // max_completion_tokens above the window is itself rejected.
  "opencode": {
    "deepseek-v4.1-flash-free": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 330000, maxOutput: 128000 },
  },
};

/**
 * Pattern fallback — glob (* = wildcard), matched case-insensitively and
 * anchored (^...$) so a pattern must match the full model id. ORDER MATTERS:
 * vision/specific variants first, text-only/generic families last, to avoid
 * a broad family pattern swallowing an exception (e.g. glm-4.6v vs glm-5).
 */
export const PATTERN_CAPABILITIES = [
  // ── Claude (4.6+ = adaptive thinking; older/haiku = budget) ──────
  // 0.5.166 — 5.x spellings the exact rows miss (Kiro's dotted claude-opus-5.5 and its
  // -thinking/-agentic ids, claude-sonnet-5.5, dated ids) fell to the budget/200K
  // generics (upstream ccd0677d, e78b766a).
  { pattern: "*claude*opus-5*",     caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*sonnet-5*",   caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*opus-4.6*",   caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*opus-4.7*",   caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*opus-4.8*",   caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*sonnet-4.6*", caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  { pattern: "*claude*sonnet-4.7*", caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive" } },
  // 0.5.166 — current 4.x/5.x families read PDFs (upstream f5f88039); the generic
  // fallbacks below stay without it rather than inferring PDF from vision.
  { pattern: "*claude*haiku-5*",  caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*haiku-4*",  caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*opus-4*",   caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*sonnet-4*", caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*haiku*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*opus*",   caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  { pattern: "*claude*sonnet*", caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },
  // 0.5.164 — Fable 5 / 5.1 think adaptively and always (budget thinking and "disabled" are 400s).
  { pattern: "*claude*fable*",  caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude*mythos*", caps: { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-budget", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*claude-3*",      caps: { vision: true } },
  { pattern: "*claude*",        caps: { vision: true, reasoning: true, search: true, thinkingFormat: "claude-budget" } },

  // ── Gemini (all 2.0+ multimodal + google_search grounding, 1M ctx) ─
  { pattern: "*gemini*image*",  caps: { vision: true, imageOutput: true, contextWindow: 1048576 } },
  // 0.5.166 — Gemini 4 (Argon) had no row at all and fell to the *gemini* floor:
  // no reasoning, and thinking advertised as switchable. Argon answers thinkingLevel
  // "minimal" and any thinkingBudget with 400 — LOW/MEDIUM/HIGH only (upstream
  // 29fc880e). The 3.7/3.8 ladders are covered by *gemini-3* below with the same caps.
  { pattern: "*gemini-4*",      caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-3*pro*",  caps:{ vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65535 } },
  { pattern: "*gemini-3*",      caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-2.5*",    caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-budget", thinkingRange: { min: 0, max: 24576 }, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-2*",      caps: { vision: true, audioInput: true, videoInput: true, search: true, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini*",        caps: { vision: true, search: true, contextWindow: 1048576 } },
  { pattern: "*gemma*",         caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*nanobanana*",    caps: { vision: true, imageOutput: true } },

  // ── OpenAI GPT-6.x / GPT-5.x (vision + thinking + web search) ────
  // 0.5.166 — 1.05M is the API window for the gpt-6 family and gpt-5.4+ (upstream
  // 89ffac5a; models.dev openai, github-copilot, opencode-go). gpt-6 had no row and
  // fell to the 200K text-only floor. The 0.5.104 272K *gpt-5.6* pattern was Kiro's
  // own truncation; it now lives in PROVIDER_CAPABILITIES.kiro, Codex's in .codex.
  { pattern: "*gpt-6*",         caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 } },
  { pattern: "*gpt-5*image*",   caps: { imageOutput: true } },
  { pattern: "*gpt-5*codex*",   caps: { reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  // mini / nano stayed at 400K; first match wins, so they sit above *gpt-5.4*.
  { pattern: "*gpt-5.4-mini*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-5.4-nano*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-5.4*",       caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 } },
  { pattern: "*gpt-5.5*",       caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 } },
  { pattern: "*gpt-5.6*",       caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 } },
  { pattern: "*gpt-5*",         caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-4o*",        caps: { vision: true, search: true, contextWindow: 128000, maxOutput: 16384 } },
  { pattern: "*gpt-4.1*",       caps: { vision: true, contextWindow: 1000000, maxOutput: 32768 } },
  { pattern: "*gpt-4-turbo*",   caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*gpt-4*",         caps: { contextWindow: 128000 } },
  { pattern: "*gpt-3.5*",       caps: { contextWindow: 16385, maxOutput: 4096 } },
  { pattern: "*gpt-oss*",       caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 } },

  // ── OpenAI o-series (reasoning, vision) ──────────────────────────
  { pattern: "*o1-mini*",       caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 } },
  { pattern: "*o1*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "*o3*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },
  { pattern: "*o4*",            caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 100000 } },

  // ── Grok (vision + Live Search) ──────────────────────────────────
  { pattern: "*grok*image*",    caps: { imageOutput: true } },
  { pattern: "*grok-code*",     caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 256000 } },
  // 0.5.166 — Grok 4.5+ is 500K (upstream 9c650e1d; models.dev xai lists 500K for
  // 4.5/4.6/4.7, and 4.7 is in ocg's catalog). *grok-4* published 256K. Grok 4.5
  // keeps the 64K output the Grok CLI proxy reports.
  { pattern: "*grok-4.7*",      caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 500000, maxOutput: 500000 } },
  { pattern: "*grok-4.6*",      caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 500000, maxOutput: 500000 } },
  { pattern: "*grok-4.5*",      caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 500000, maxOutput: 64000 } },
  { pattern: "*grok-4*",      caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 256000 } },
  { pattern: "*grok-3*",        caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 131072 } },
  { pattern: "*grok*",          caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 256000 } },

  // ── Qwen (enable_thinking + thinking_budget; QwQ = thinking-only) ─
  { pattern: "*qwen*vl*",       caps: { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 } },
  { pattern: "*qwen*max*",      caps: { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen*plus*",     caps: { vision: true, reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 65536 } },
  { pattern: "*qwen*235b*",     caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 } },
  { pattern: "*qwen*coder*",    caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 } },
  { pattern: "*qwq*",           caps: { reasoning: true, thinkingFormat: "qwen", thinkingCanDisable: false, contextWindow: 131072 } },
  { pattern: "*qwen*",          caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 } },

  // ── Kimi (enabled→reasoning_effort; K2.7-code cannot disable) ─────
  { pattern: "*kimi*k2.7*code*", caps: { vision: true, reasoning: true, thinkingFormat: "kimi", thinkingCanDisable: false, contextWindow: 262144, maxOutput: 262144 } },
  { pattern: "*kimi*k2*",       caps: { vision: true, reasoning: true, thinkingFormat: "kimi", contextWindow: 262144, maxOutput: 262144 } },
  { pattern: "*kimi*",          caps: { reasoning: true, thinkingFormat: "kimi", contextWindow: 262144 } },

  // ── GLM / Z.ai (thinking.enabled; disable via enable_thinking:false) ─
  // 0.5.166 — GLM-5.2/5.3 are 1M (upstream 0f7f6e72; models.dev zai). *glm-5* gave
  // them 200K, and the capacity adapter trims history at 80% of the window.
  { pattern: "*glm-5.3*",       caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*glm-5.2*",       caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 1000000, maxOutput: 128000 } },
  { pattern: "*glm-5*",        caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000, maxOutput: 128000 } },
  { pattern: "*glm-4.7*",       caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000, maxOutput: 128000 } },
  { pattern: "*glm-4*",         caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000 } },
  { pattern: "*glm*",           caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000 } },

  // ── DeepSeek (thinking.enabled + reasoning_effort; r1 = thinking-only) ─
  // 0.5.166 — dotted V4.x releases (V4.1+) read images (upstream 367fc546); dash ids
  // (deepseek-v4-pro, -v4-flash) stay text-only.
  { pattern: "*deepseek-v4.*",  caps: { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 } },
  { pattern: "*deepseek-v4*",   caps: { reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 } },
  { pattern: "*reasoner*",      caps: { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 128000 } },
  { pattern: "*deepseek-r*",    caps: { reasoning: true, thinkingFormat: "deepseek", thinkingCanDisable: false, contextWindow: 128000 } },
  { pattern: "*deepseek-chat*", caps: { contextWindow: 128000 } },
  { pattern: "*deepseek*",      caps: { reasoning: true, thinkingFormat: "deepseek", contextWindow: 128000 } },

  // ── MiniMax (M3 = adaptive; M2.x cannot disable) ─────────────────
  { pattern: "*minimax*image*", caps: { imageOutput: true } },
  { pattern: "*minimax-m3*",    caps: { reasoning: true, thinkingFormat: "minimax", contextWindow: 1048576, maxOutput: 512000 } },
  { pattern: "*minimax-m2.7*",  caps: { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 204800, maxOutput: 131072 } },
  { pattern: "*minimax*",       caps: { reasoning: true, thinkingFormat: "minimax", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 131072 } },

  // ── Xiaomi MiMo (vision, 1M / 262K ctx) ──────────────────────────
  { pattern: "*mimo*v2.5*",     caps: { vision: true, audioInput: true, videoInput: true, contextWindow: 1048576, maxOutput: 131072 } },
  { pattern: "*mimo*omni*",     caps: { vision: true, audioInput: true, contextWindow: 262144, maxOutput: 131072 } },
  { pattern: "*mimo*",          caps: { vision: true, contextWindow: 262144, maxOutput: 131072 } },

  // ── Llama (4 = vision/1M; 3.x = text-only/128K) ──────────────────
  { pattern: "*llama-4*",       caps: { vision: true, contextWindow: 1000000 } },
  { pattern: "*llama*",         caps: { contextWindow: 128000 } },

  // ── Mistral (Large 3 = vision/256K; codestral text) ──────────────
  { pattern: "*codestral*",     caps: { contextWindow: 256000 } },
  { pattern: "*mistral-large*", caps: { vision: true, contextWindow: 256000 } },
  { pattern: "*mistral*",       caps: { contextWindow: 128000 } },

  // ── Cohere (Command A Vision = vision; others text) ──────────────
  { pattern: "*command-a-vision*", caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*command*",       caps: { contextWindow: 128000 } },

  // ── Perplexity (web search native) ───────────────────────────────
  { pattern: "*sonar*",         caps: { search: true, contextWindow: 128000 } },
  { pattern: "*pplx*",          caps: { search: true, contextWindow: 128000 } },
  { pattern: "*perplexity*",    caps: { search: true, contextWindow: 128000 } },

  // ── Others ───────────────────────────────────────────────────────
  { pattern: "*hunyuan*",       caps: { reasoning: true, thinkingFormat: "hunyuan", contextWindow: 262144, maxOutput: 262144 } },
  { pattern: "hy3*",            caps: { reasoning: true, thinkingFormat: "hunyuan", contextWindow: 262144, maxOutput: 262144 } },
  { pattern: "*step-*",         caps: { reasoning: true, thinkingFormat: "step", contextWindow: 128000 } },
  { pattern: "*nemotron*",      caps: { reasoning: true, contextWindow: 128000 } },
  { pattern: "*ling-*",         caps: { reasoning: true, contextWindow: 128000 } },
];

/**
 * Resolve capabilities for a model using the 4-step fallback chain,
 * merged over DEFAULT_CAPABILITIES so the result is always complete.
 *
 * @param {string} provider
 * @param {string} model
 * @returns {object} full capabilities object
 */
export function getCapabilitiesForModel(provider, model) {
  if (!model) return { ...DEFAULT_CAPABILITIES };

  // 1. Provider-specific override
  if (provider && PROVIDER_CAPABILITIES[provider]?.[model]) {
    return { ...DEFAULT_CAPABILITIES, ...PROVIDER_CAPABILITIES[provider][model] };
  }

  // 2. Canonical exact (strip vendor prefix: "anthropic/claude-opus-4.7" -> "claude-opus-4.7")
  const baseModel = model.includes("/") ? model.split("/").pop() : model;
  if (MODEL_CAPABILITIES[baseModel]) return { ...DEFAULT_CAPABILITIES, ...MODEL_CAPABILITIES[baseModel] };
  if (MODEL_CAPABILITIES[model]) return { ...DEFAULT_CAPABILITIES, ...MODEL_CAPABILITIES[model] };

  // 3. Pattern match (first match wins)
  for (const { pattern, caps } of PATTERN_CAPABILITIES) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      return { ...DEFAULT_CAPABILITIES, ...caps };
    }
  }

  // 4. Floor
  return { ...DEFAULT_CAPABILITIES };
}
