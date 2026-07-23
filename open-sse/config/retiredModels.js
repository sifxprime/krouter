// 0.5.119 — Retired / discontinued upstream models.
//
// When a client (e.g. opencode) still requests a model the upstream has since
// removed, kRouter used to forward it and surface the provider's opaque reply —
// for OpenCode that is a 400/401 `ModelError: Model <x> is not supported`, which
// tells the user nothing about what to do. Instead we intercept the known-dead
// ids here and return a clear, actionable kRouter error naming the live
// replacement and the tier it lives on.
//
// Current entries: OpenCode discontinued its FREE tier. Every model in the `oc`
// catalog is commented out (see open-sse/config/providerModels.js); the live
// equivalents are on the paid `opencode-go` (API-key) tier.
//
// NOTE: if a tier is ever re-enabled upstream, remove its ids from this map AND
// re-add them to PROVIDER_MODELS — this list is an explicit "known dead" gate,
// not derived from the catalog.
export const RETIRED_MODELS = {
  "qwen3.6-plus-free": {
    replacement: "qwen3.6-plus",
    tier: "opencode-go (API key)",
    reason: "OpenCode discontinued its free tier",
  },
  "minimax-m2.5-free": {
    replacement: "minimax-m2.5",
    tier: "opencode-go (API key)",
    reason: "OpenCode discontinued its free tier",
  },
  "nemotron-3-super-free": {
    replacement: null,
    tier: "opencode-go (API key)",
    reason: "OpenCode discontinued its free tier",
  },
  "trinity-large-preview-free": {
    replacement: null,
    tier: "opencode-go (API key)",
    reason: "OpenCode discontinued its free tier",
  },
  "big-pickle": {
    replacement: null,
    tier: "opencode-go (API key)",
    reason: "OpenCode discontinued its free tier",
  },
};

/**
 * Return a clear, actionable error string when `model` is a known-retired id,
 * or null when the model is fine to route. Matches on the bare model id, so a
 * caller may pass either "qwen3.6-plus-free" or "oc/qwen3.6-plus-free".
 * @param {string} model
 * @returns {string|null}
 */
export function getRetiredModelError(model) {
  if (!model || typeof model !== "string") return null;
  const bare = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  const info = RETIRED_MODELS[bare];
  if (!info) return null;
  const fix = info.replacement
    ? `Use "${info.replacement}" on the ${info.tier} instead.`
    : `No direct replacement — pick a live model on the ${info.tier}.`;
  return `Model "${bare}" has been retired (${info.reason}). ${fix}`;
}
