// Emergency Fallback (0.5.28) — port of OmniRoute's emergencyFallback.
//
// When a request fails due to budget exhaustion (HTTP 402 or "out of credits"
// keywords in the error body), optionally redirect to a free-tier model so
// the user gets SOMETHING instead of a hard error. Default-disabled because
// it changes the model the user explicitly asked for — opt-in via setting.
//
// Settings:
//   settings.emergencyFallbackEnabled: boolean (default false)
//   settings.emergencyFallbackProvider: string (default "nvidia")
//   settings.emergencyFallbackModel: string (default "openai/gpt-oss-120b")
//   settings.emergencyFallbackSkipForTools: boolean (default true)

export const EMERGENCY_FALLBACK_DEFAULTS = {
  enabled: false,
  provider: "nvidia",
  model: "openai/gpt-oss-120b",
  triggerOn402: true,
  triggerOnBudgetKeywords: true,
  skipForToolRequests: true,
  maxOutputTokens: 4096,
};

const BUDGET_KEYWORDS = [
  "insufficient funds",
  "insufficient_funds",
  "budget exceeded",
  "budget_exceeded",
  "quota exceeded",
  "quota_exceeded",
  "billing",
  "payment required",
  "out of credits",
  "no credits",
  "credit limit",
  "spending limit",
];

// Decide whether the request should be redirected to the fallback model.
// Returns { shouldFallback: true, provider, model, reason } or
//         { shouldFallback: false, reason }
export function shouldUseEmergencyFallback(status, errorBody, requestHasTools, config = EMERGENCY_FALLBACK_DEFAULTS) {
  if (!config.enabled) return { shouldFallback: false, reason: "emergency_fallback_disabled" };
  if (config.skipForToolRequests && requestHasTools) {
    return { shouldFallback: false, reason: "skipped_tool_request" };
  }
  if (config.triggerOn402 && status === 402) {
    return {
      shouldFallback: true,
      reason: `HTTP 402 → ${config.provider}/${config.model}`,
      provider: config.provider,
      model: config.model,
      maxOutputTokens: config.maxOutputTokens,
    };
  }
  if (config.triggerOnBudgetKeywords && typeof errorBody === "string" && errorBody) {
    const lower = errorBody.toLowerCase();
    const matched = BUDGET_KEYWORDS.find(kw => lower.includes(kw));
    if (matched) {
      return {
        shouldFallback: true,
        reason: `budget keyword "${matched}" → ${config.provider}/${config.model}`,
        provider: config.provider,
        model: config.model,
        maxOutputTokens: config.maxOutputTokens,
      };
    }
  }
  return { shouldFallback: false, reason: "no_trigger_matched" };
}

// Build a config from runtime settings (loaded from db). Pass null to get defaults.
export function buildEmergencyFallbackConfig(settings) {
  if (!settings || typeof settings !== "object") return EMERGENCY_FALLBACK_DEFAULTS;
  return {
    enabled: settings.emergencyFallbackEnabled === true,
    provider: typeof settings.emergencyFallbackProvider === "string" && settings.emergencyFallbackProvider
      ? settings.emergencyFallbackProvider : EMERGENCY_FALLBACK_DEFAULTS.provider,
    model: typeof settings.emergencyFallbackModel === "string" && settings.emergencyFallbackModel
      ? settings.emergencyFallbackModel : EMERGENCY_FALLBACK_DEFAULTS.model,
    triggerOn402: settings.emergencyFallbackTriggerOn402 !== false,
    triggerOnBudgetKeywords: settings.emergencyFallbackTriggerOnBudgetKeywords !== false,
    skipForToolRequests: settings.emergencyFallbackSkipForTools !== false,
    maxOutputTokens: typeof settings.emergencyFallbackMaxOutputTokens === "number"
      ? settings.emergencyFallbackMaxOutputTokens : EMERGENCY_FALLBACK_DEFAULTS.maxOutputTokens,
  };
}
