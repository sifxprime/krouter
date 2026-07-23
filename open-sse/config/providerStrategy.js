// 0.5.119 — Per-provider default account-selection strategy.
//
// Antigravity enforces a per-MINUTE (TPM) rate limit per account ON TOP OF the
// daily quota. The default `fill-first` strategy pins traffic to ONE account
// until it dies, so a burst trips that account's minute-window almost
// immediately; the picker then moves to the next account and trips ITS window,
// cascading every account into a short lock at once → "No active credentials /
// all accounts locked" 503s while sibling accounts sit idle and the daily quota
// never drains. `round-robin` spreads the burst across all accounts, keeping
// each under its per-minute window, so more of the daily quota is actually used
// and the pool rarely goes fully cold.
//
// Precedence (see getEffectiveFallbackStrategy): an explicit per-provider
// override the user set in the dashboard ALWAYS wins; this default only applies
// when the user hasn't chosen a strategy for the provider, and it sits ABOVE the
// global default so Antigravity round-robins even when the global is fill-first.
export const PROVIDER_DEFAULT_STRATEGY = {
  antigravity: "round-robin",
};

/**
 * Resolve the effective fallback strategy for a provider.
 * @param {object|null} settings - app settings (may be null)
 * @param {string} providerId - canonical provider id (e.g. "antigravity")
 * @returns {string} one of: "round-robin" | "fill-first" | "p2c" | "random" | "zenith"
 */
export function getEffectiveFallbackStrategy(settings, providerId) {
  const providerOverride = (settings?.providerStrategies || {})[providerId] || {};
  return (
    providerOverride.fallbackStrategy ||
    PROVIDER_DEFAULT_STRATEGY[providerId] ||
    settings?.fallbackStrategy ||
    "fill-first"
  );
}
