// Model Family Fallback (0.5.28) — port of OmniRoute's modelFamilyFallback.
//
// When a provider returns "model not available" (404 or a known 400/403
// fragment), try the next sibling model in the same family before giving up.
// Used by combo flow: if "ag/gemini-3-pro-preview" is deleted upstream, we
// auto-try "ag/gemini-3.1-pro-preview", then "ag/gemini-3-pro-high", etc.
//
// Static families — when an upstream actually deletes a model, the user
// shouldn't have to update their config. The fallback chain is the closest-
// equivalent model, ordered by similarity (preview before high before low).

import { parseModel } from "./model.js";

// Ordered candidate lists per model family.
// First entry is the most preferred; fallback proceeds in declared order.
// Bare model name (no provider prefix) as the key. Dots normalized to hyphens
// for the lookup so "gemini-3.1-pro-preview" matches "gemini-3-1-pro-preview".
const MODEL_FAMILIES = {
  // Gemini 3 / 3.1 Pro family
  "gemini-3-pro": [
    "gemini-3.1-pro-preview", "gemini-3-pro-preview",
    "gemini-3.1-pro-high", "gemini-3-pro-high",
    "gemini-3.1-pro-low", "gemini-3-pro-low",
  ],
  "gemini-3-1-pro": [
    "gemini-3.1-pro-preview", "gemini-3-pro-preview",
    "gemini-3.1-pro-high", "gemini-3-pro-high",
    "gemini-3.1-pro-low", "gemini-3-pro-low",
  ],
  "gemini-3-pro-preview": [
    "gemini-3.1-pro-preview", "gemini-3-pro-high",
    "gemini-3.1-pro-high", "gemini-3-pro-low", "gemini-3.1-pro-low",
  ],
  "gemini-3-1-pro-preview": [
    "gemini-3-pro-preview", "gemini-3.1-pro-high",
    "gemini-3-pro-high", "gemini-3.1-pro-low", "gemini-3-pro-low",
  ],
  "gemini-3-pro-high": [
    "gemini-3.1-pro-high", "gemini-3-pro-preview",
    "gemini-3.1-pro-preview", "gemini-3-pro-low", "gemini-3.1-pro-low",
  ],
  "gemini-3-1-pro-high": [
    "gemini-3-pro-high", "gemini-3.1-pro-preview",
    "gemini-3-pro-preview", "gemini-3.1-pro-low", "gemini-3-pro-low",
  ],
  "gemini-3-flash": ["gemini-3-flash-agent", "gemini-3.5-flash-low"],
  "gemini-3-flash-agent": ["gemini-3-flash", "gemini-3.5-flash-low"],
  "gemini-3-5-flash-low": ["gemini-3.5-flash-extra-low", "gemini-3-flash"],

  // Gemini 2.5 Pro
  "gemini-2-5-pro": ["gemini-2.5-pro-preview-06-05", "gemini-2.5-pro-exp-03-25"],

  // Claude families (Mythos / Opus / Sonnet)
  "claude-fable-5": ["claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6"],
  "claude-opus-4-8": ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6"],
  "claude-opus-4-7": ["claude-opus-4-6", "claude-opus-4-6-thinking", "claude-sonnet-4-6"],
  "claude-opus-4-6": ["claude-opus-4-6-thinking", "claude-opus-4-7", "claude-sonnet-4-6"],
  "claude-opus-4-6-thinking": ["claude-opus-4-6", "claude-opus-4-7"],
  "claude-sonnet-4-6": ["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"],

  // GPT-5
  "gpt-5": ["gpt-5-mini", "gpt-4o"],
  "gpt-5-1": ["gpt-5.1-mini", "gpt-5", "gpt-4o"],
};

// Error-body fragments that indicate the requested MODEL is unavailable
// (vs. a transient server error). Lowercase-matched on the response body text.
const MODEL_UNAVAILABLE_FRAGMENTS = [
  "model not found",
  "model_not_found",
  "model not available",
  "model is not available",
  "no such model",
  "unsupported model",
  "unknown model",
  "this model does not exist",
  "invalid model",
  "model not supported",
  "not enabled for",
  "access to model",
  "improperly formed request", // Kiro 400 (model unavailable)
  "requested entity was not found", // Google
];

// True when status + body indicate the model itself is gone, not a transient.
// 404 unconditionally counts; 400/403 only count if the body matches a fragment.
export function isModelUnavailableError(status, errorBody) {
  if (status === 404) return true;
  if (status !== 400 && status !== 403) return false;
  if (typeof errorBody !== "string" || !errorBody) return false;
  const lower = errorBody.toLowerCase();
  return MODEL_UNAVAILABLE_FRAGMENTS.some(f => lower.includes(f));
}

// Look up the model's family, return the next candidate (with provider prefix)
// not already in triedModels. Returns null when family exhausted or unknown.
export function getNextFamilyFallback(currentModel, triedModels) {
  if (!currentModel) return null;
  const tried = triedModels instanceof Set ? triedModels : new Set(triedModels || []);

  const parsed = parseModel(currentModel);
  const bareModel = parsed.model || currentModel;
  const prefixPart = parsed.providerAlias || parsed.provider || "";
  const prefix = prefixPart ? `${prefixPart}/` : "";

  // Normalize dots to hyphens for the lookup so notation differences don't matter
  const lookupKey = bareModel.replace(/\./g, "-");
  const family = MODEL_FAMILIES[lookupKey] || MODEL_FAMILIES[bareModel];
  if (!family) return null;

  for (const candidate of family) {
    const fullCandidate = `${prefix}${candidate}`;
    if (!tried.has(fullCandidate)) {
      return fullCandidate;
    }
  }
  return null;
}

// True if this model appears in any registered family
export function isInModelFamily(model) {
  if (!model) return false;
  const parsed = parseModel(model);
  const bareModel = (parsed.model || model).replace(/\./g, "-");
  return bareModel in MODEL_FAMILIES;
}

// All members of a model's family, with provider prefix preserved
export function getModelFamily(model) {
  const parsed = parseModel(model);
  const bareModel = (parsed.model || model).replace(/\./g, "-");
  const prefixPart = parsed.providerAlias || parsed.provider || "";
  const prefix = prefixPart ? `${prefixPart}/` : "";
  const family = MODEL_FAMILIES[bareModel];
  if (!family) return [model];
  return [model, ...family.map(c => `${prefix}${c}`)];
}

// Exported for tests
export const _MODEL_FAMILIES = MODEL_FAMILIES;
