// taskAwareRouter (0.5.29) — port of OmniRoute's taskAwareRouter.
//
// Given a classified intent (code / math / reasoning / creative / simple),
// suggest the best combo to route to. Used as a HINT layer — the actual
// model resolution still respects the user's combo definition; this just
// tells the user "your prompt looks like code — try the 'code-combo' combo".
//
// Returns null if no good match — caller falls back to default routing.

const DEFAULT_INTENT_TO_COMBO = {
  // Each value is an ORDERED preference list. The first available combo wins.
  code: ["code-combo", "deepseek", "claude-code", "google-combo"],
  math: ["math-combo", "claude-code", "google-combo"],
  reasoning: ["thinking-combo", "claude-code", "google-combo"],
  creative: ["creative-combo", "claude-code", "google-combo"],
  simple: ["cheap-combo", "google-combo"],
  medium: ["google-combo", "claude-code"],
};

// Per-installation overrides via settings.taskAwareRouterMap
export function buildTaskAwareRoutingMap(settings) {
  const userMap = settings?.taskAwareRouterMap;
  if (userMap && typeof userMap === "object" && !Array.isArray(userMap)) {
    return { ...DEFAULT_INTENT_TO_COMBO, ...userMap };
  }
  return DEFAULT_INTENT_TO_COMBO;
}

// Pick the best combo for an intent. availableComboNames is the user's
// configured combo list (Set or Array). Returns the first matching name,
// or null if none of the suggestions are available.
export function suggestComboForIntent(intent, availableComboNames, map = DEFAULT_INTENT_TO_COMBO) {
  if (!intent) return null;
  const available = availableComboNames instanceof Set
    ? availableComboNames
    : new Set(Array.isArray(availableComboNames) ? availableComboNames : []);
  if (available.size === 0) return null;
  const candidates = map[intent] || [];
  for (const candidate of candidates) {
    if (available.has(candidate)) return candidate;
  }
  return null;
}

// Convenience: combine intent classification + combo suggestion.
// Returns { intent, suggestedCombo, reason }. Use suggestedCombo only if
// the user explicitly opted in (settings.taskAwareRoutingEnabled).
export function adviseRouting(intent, settings, availableComboNames) {
  const map = buildTaskAwareRoutingMap(settings);
  const suggested = suggestComboForIntent(intent, availableComboNames, map);
  if (!suggested) {
    return { intent, suggestedCombo: null, reason: "no_match" };
  }
  return {
    intent,
    suggestedCombo: suggested,
    reason: `intent=${intent} → ${suggested}`,
  };
}

export const _DEFAULT_INTENT_TO_COMBO = DEFAULT_INTENT_TO_COMBO;
