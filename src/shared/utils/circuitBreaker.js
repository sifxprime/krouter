// circuitBreaker (0.5.30)
//
// Provider-level circuit breaker to complement the per-account model locks.
// If a provider (like O‍penCode or Kiro) goes down entirely and starts throwing
// 500s across ALL accounts, we shouldn't keep hammering it. This breaker trips
// after 10 consecutive 500s across the whole provider and blocks new requests
// for 5 minutes.

const breakers = new Map();

const THRESHOLD = 10;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 min

function ensureBreaker(provider) {
  let b = breakers.get(provider);
  if (!b) {
    b = { consecutiveFailures: 0, trippedUntil: null };
    breakers.set(provider, b);
  }
  return b;
}

export function isCircuitBreakerOpen(provider) {
  if (!provider) return false;
  const b = breakers.get(provider);
  if (!b || !b.trippedUntil) return false;
  if (Date.now() > b.trippedUntil) {
    // Cooldown expired — enter half-open state
    b.trippedUntil = null;
    return false;
  }
  return true;
}

export function recordProviderSuccess(provider) {
  if (!provider) return;
  const b = ensureBreaker(provider);
  b.consecutiveFailures = 0;
  b.trippedUntil = null;
}

export function recordProviderFailure(provider, status) {
  if (!provider) return;
  // We only count 5xx server errors as provider failure.
  // 429s are handled by account locks; 400s are bad requests.
  if (status < 500 || status >= 600) return;

  const b = ensureBreaker(provider);
  b.consecutiveFailures++;

  if (b.consecutiveFailures >= THRESHOLD) {
    b.trippedUntil = Date.now() + COOLDOWN_MS;
    return true; // Just tripped
  }
  return false;
}

export function getAllCircuitBreakerStatuses() {
  const now = Date.now();
  const out = {};
  for (const [provider, b] of breakers.entries()) {
    if (b.trippedUntil && b.trippedUntil > now) {
      out[provider] = { status: "open", resetsInMs: b.trippedUntil - now };
    } else if (b.consecutiveFailures > 0) {
      out[provider] = { status: "half-open", failures: b.consecutiveFailures };
    } else {
      out[provider] = { status: "closed" };
    }
  }
  return out;
}

// For tests
export function _clearCircuitBreakers() {
  breakers.clear();
}
