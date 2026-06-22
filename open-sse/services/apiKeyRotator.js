// API Key Rotator (0.5.28) — port of OmniRoute's apiKeyRotator.
//
// Round-robin rotation across multiple API keys for the same provider
// connection. Extra keys live in providerSpecificData.extraApiKeys[].
//
// Per-key health tracking: keys that fail (auth errors) 2+ consecutive times
// are marked "invalid" and skipped during rotation. A successful call resets
// the count back to "active".
//
// All state is in-memory and resets on process restart — intentional, no
// persistence overhead, and ensures even distribution across restarts.

const _keyIndexes = new Map();        // connectionId → round-robin index
const _keyHealth = new Map();          // `${connectionId}:${keyId}` → { status, failures, ... }
const _connectionExtraKeys = new Map(); // connectionId → boolean

const MAX_KEY_HEALTH_ENTRIES = 500;
const FAILURE_THRESHOLD = 2;

function getOrCreateHealth(connectionId, keyId) {
  const scopedKey = `${connectionId}:${keyId}`;
  if (!_keyHealth.has(scopedKey)) {
    if (_keyHealth.size >= MAX_KEY_HEALTH_ENTRIES) {
      const oldest = _keyHealth.keys().next().value;
      if (oldest !== undefined) _keyHealth.delete(oldest);
    }
    _keyHealth.set(scopedKey, {
      status: "active",
      failures: 0,
      lastFailure: null,
      lastSuccess: null,
      totalRequests: 0,
      totalFailures: 0,
    });
  }
  return _keyHealth.get(scopedKey);
}

export function getKeyHealth(connectionId, keyId) {
  return _keyHealth.get(`${connectionId}:${keyId}`) || null;
}

export function trackConnectionExtraKeys(connectionId, extraKeys) {
  const valid = (Array.isArray(extraKeys) ? extraKeys : [])
    .filter(k => typeof k === "string" && k.trim().length > 0);
  _connectionExtraKeys.set(connectionId, valid.length > 0);
}

export function connectionHasExtraKeys(connectionId, extraKeys) {
  if (Array.isArray(extraKeys) && extraKeys.length > 0) return true;
  return _connectionExtraKeys.get(connectionId) === true;
}

// Round-robin among ACTIVE keys only (skips invalid). Returns
// { key, keyId } or null when all keys are invalid.
export function getValidApiKey(connectionId, primaryKey, extraKeys = []) {
  const validExtras = (Array.isArray(extraKeys) ? extraKeys : [])
    .filter(k => typeof k === "string" && k.trim().length > 0);

  const allKeys = [];
  const primaryHealth = getOrCreateHealth(connectionId, "primary");
  if (primaryKey && primaryHealth.status !== "invalid") {
    allKeys.push({ key: primaryKey, keyId: "primary" });
  }
  for (let i = 0; i < validExtras.length; i++) {
    const keyId = `extra_${i}`;
    const h = getOrCreateHealth(connectionId, keyId);
    if (h.status !== "invalid") {
      allKeys.push({ key: validExtras[i], keyId });
    }
  }

  if (allKeys.length === 0) return null;
  if (allKeys.length === 1) return { key: allKeys[0].key, keyId: allKeys[0].keyId };

  const current = _keyIndexes.get(connectionId) ?? 0;
  const idx = current % allKeys.length;
  _keyIndexes.set(connectionId, current + 1);
  return { key: allKeys[idx].key, keyId: allKeys[idx].keyId };
}

// Legacy round-robin (no health check). Kept for back-compat callers.
export function getRotatingApiKey(connectionId, primaryKey, extraKeys = []) {
  const validExtras = (Array.isArray(extraKeys) ? extraKeys : [])
    .filter(k => typeof k === "string" && k.trim().length > 0);
  if (validExtras.length === 0) return primaryKey;
  const allKeys = [primaryKey, ...validExtras].filter(Boolean);
  if (allKeys.length <= 1) return primaryKey;
  const current = _keyIndexes.get(connectionId) ?? 0;
  const idx = current % allKeys.length;
  _keyIndexes.set(connectionId, current + 1);
  return allKeys[idx];
}

export function recordKeyFailure(connectionId, keyId) {
  const h = getOrCreateHealth(connectionId, keyId);
  h.failures++;
  h.totalRequests++;
  h.totalFailures++;
  h.lastFailure = new Date().toISOString();
  if (h.failures >= FAILURE_THRESHOLD) {
    h.status = "invalid";
  } else {
    h.status = "warning";
  }
  return { ...h };
}

export function recordKeySuccess(connectionId, keyId) {
  const h = getOrCreateHealth(connectionId, keyId);
  h.failures = 0;
  h.totalRequests++;
  h.lastSuccess = new Date().toISOString();
  h.status = "active";
  return { ...h };
}

// For tests
export function clearAllKeyState() {
  _keyIndexes.clear();
  _keyHealth.clear();
  _connectionExtraKeys.clear();
}
