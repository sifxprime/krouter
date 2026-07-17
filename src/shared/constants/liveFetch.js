// 0.5.86 — Universal live-catalog fetch table.
//
// Single source of truth for "given a provider id and an API key, where do I
// GET the model list and how do I parse it?" — covers every OpenAI-shaped
// provider even ones that were previously missing from PROVIDER_MODELS_CONFIG.
//
// Shape:
//   LIVE_FETCH[id] = {
//     url: "https://api.provider.com/v1/models",
//     authHeader: "Authorization" | "x-api-key" | "api-key" | "token",
//     authPrefix: "Bearer " | "",
//     extraHeaders?: { "Anthropic-Version": "2023-06-01", ... },
//     parse: (json) => [{ id, name? }, ...]     // returns normalized list
//   }
//
// Providers not listed here can still work via the fallback URL derivation
// in getLiveFetcher() when their notice.apiKeyUrl or website exposes a hostname.

// 0.5.108 — Some catalogs sit behind a WAF that rejects requests carrying no
// User-Agent. Featherless answers undici's default (no UA) with 404 "Gone.",
// but returns a real 401/200 the moment any UA is present. Node's fetch sends
// no UA by default, so every live-catalog request has to set one explicitly.
export const LIVE_FETCH_USER_AGENT = "krouter/1.0 (+https://github.com/sifxprime/krouter)";

const openaiShape = (url, extraHeaders = null) => ({
  url,
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  extraHeaders,
  parse: (j) => Array.isArray(j?.data) ? j.data : (Array.isArray(j?.models) ? j.models : []),
});

export const LIVE_FETCH = {
  // ─── Providers already covered by PROVIDER_MODELS_CONFIG ──────────────────
  openai:        openaiShape("https://api.openai.com/v1/models"),
  openrouter:    openaiShape("https://openrouter.ai/api/v1/models"),
  atomesus:      openaiShape("https://api.atomesus.com/v1/models"),
  deepseek:      openaiShape("https://api.deepseek.com/models"),
  groq:          openaiShape("https://api.groq.com/openai/v1/models"),
  xai:           openaiShape("https://api.x.ai/v1/models"),
  mistral:       openaiShape("https://api.mistral.ai/v1/models"),
  perplexity:    openaiShape("https://api.perplexity.ai/v1/models"),
  together:      openaiShape("https://api.together.xyz/v1/models"),
  fireworks:     openaiShape("https://api.fireworks.ai/inference/v1/models"),
  cerebras:      openaiShape("https://api.cerebras.ai/v1/models"),
  cohere:        openaiShape("https://api.cohere.ai/v1/models"),
  nebius:        openaiShape("https://api.studio.nebius.ai/v1/models"),
  siliconflow:   openaiShape("https://api.siliconflow.com/v1/models"),
  hyperbolic:    openaiShape("https://api.hyperbolic.xyz/v1/models"),
  // 0.5.98 — Featherless (LLM catalog)
  featherless:   openaiShape("https://api.featherless.ai/v1/models"),
  // 0.5.98 — Venice AI (LLM catalog)
  venice:        openaiShape("https://api.venice.ai/api/v1/models"),
  // 0.5.98 — Perplexity Agent API models endpoint (distinct from search-focused Perplexity provider)
  "perplexity-agent": openaiShape("https://api.perplexity.ai/v1/models"),
  chutes:        openaiShape("https://llm.chutes.ai/v1/models"),
  nvidia:        openaiShape("https://integrate.api.nvidia.com/v1/models"),
  nanobanana:    openaiShape("https://api.nanobananaapi.ai/v1/models"),
  assemblyai:    openaiShape("https://api.assemblyai.com/v1/models"),
  byteplus:      openaiShape("https://ark.ap-southeast.bytepluses.com/api/coding/v3/models"),
  "volcengine-ark": openaiShape("https://ark.cn-beijing.volces.com/api/coding/v3/models"),
  "vercel-ai-gateway": openaiShape("https://ai-gateway.vercel.sh/v1/models"),
  alicode:       openaiShape("https://coding.dashscope.aliyuncs.com/v1/models"),
  "alicode-intl": openaiShape("https://coding-intl.dashscope.aliyuncs.com/v1/models"),

  // Anthropic uses x-api-key + Anthropic-Version.
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    authHeader: "x-api-key",
    authPrefix: "",
    extraHeaders: { "Anthropic-Version": "2023-06-01" },
    parse: (j) => Array.isArray(j?.data) ? j.data : [],
  },
  claude: {
    url: "https://api.anthropic.com/v1/models",
    authHeader: "x-api-key",
    authPrefix: "",
    extraHeaders: { "Anthropic-Version": "2023-06-01" },
    parse: (j) => Array.isArray(j?.data) ? j.data : [],
  },

  // Gemini uses ?key= query param — special-cased in preview route.
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    authQuery: "key",
    parse: (j) => Array.isArray(j?.models) ? j.models.map(m => ({
      id: m.name?.replace("models/", "") || m.id,
      name: m.displayName || m.name,
    })) : [],
  },

  // ─── NEWLY ADDED providers (previously stuck on hardcoded static lists) ──
  glm:           openaiShape("https://api.z.ai/api/paas/v4/models"),
  "glm-cn":      openaiShape("https://open.bigmodel.cn/api/paas/v4/models"),
  kimi:          openaiShape("https://api.moonshot.ai/v1/models"),
  minimax:       openaiShape("https://api.minimaxi.com/v1/models"),
  "minimax-cn":  openaiShape("https://api.minimaxi.com/v1/models"),
  "xiaomi-mimo": openaiShape("https://api.xiaomimimo.com/v1/models"),
  blackbox:      openaiShape("https://api.blackbox.ai/v1/models"),
  commandcode:   openaiShape("https://api.commandcode.ai/v1/models"),
  "opencode-go": openaiShape("https://opencode.ai/zen/v1/models"),

  // Embeddings-only providers — same shape, /v1/models works.
  "voyage-ai":   openaiShape("https://api.voyageai.com/v1/models"),

  // TTS-only / STT-only providers.
  deepgram: {
    url: "https://api.deepgram.com/v1/models",
    authHeader: "Authorization",
    authPrefix: "Token ",
    parse: (j) => Array.isArray(j?.stt) ? j.stt.map(m => ({ id: m.canonical_name || m.name, name: m.name })) : [],
  },
  elevenlabs: {
    url: "https://api.elevenlabs.io/v1/models",
    authHeader: "xi-api-key",
    authPrefix: "",
    parse: (j) => Array.isArray(j) ? j.map(m => ({ id: m.model_id, name: m.name })) : [],
  },
  cartesia: {
    url: "https://api.cartesia.ai/voices",   // Cartesia lists voices, not models
    authHeader: "x-api-key",
    authPrefix: "",
    extraHeaders: { "Cartesia-Version": "2024-06-10" },
    parse: (j) => Array.isArray(j) ? j.map(v => ({ id: v.id, name: v.name })) : [],
  },
};

/**
 * Return the live-fetch descriptor for a provider id, or null if unknown.
 * @param {string} providerId
 * @returns {{url:string, authHeader?:string, authPrefix?:string, authQuery?:string, extraHeaders?:object, parse:function} | null}
 */
export function getLiveFetcher(providerId) {
  return LIVE_FETCH[providerId] || null;
}

/**
 * List provider ids that support live fetching.
 * @returns {string[]}
 */
export function listLiveFetchProviders() {
  return Object.keys(LIVE_FETCH);
}
