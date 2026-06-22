// fingerprintRotator (0.5.29) — distilled from OmniRoute's sessionPool/fingerprintRotator.
//
// Produces a stable browser-like fingerprint per (provider, account) tuple.
// Same account → same fingerprint across all its requests for the process
// lifetime. Different accounts → distinct fingerprints. This keeps the
// per-account identity consistent (no rotation mid-session that would look
// suspicious to upstream anti-abuse systems) while preventing two accounts
// from looking identical.
//
// What we vary per account:
//   - User-Agent suffix (build hash) — looks like a real client version
//   - X-Client-Version (semver patch) — small variation in build
//   - sec-ch-ua-mobile (?0 desktop / ?1 mobile) — biased to desktop
//   - sec-ch-ua-platform (macOS / Windows / Linux)
//
// Crucially does NOT vary the major UA family — that's set by the provider
// (Antigravity vs Cursor vs Claude Code) and must be consistent.

import { createHash } from "node:crypto";

const PLATFORMS = ["macOS", "Windows", "Linux"];
const PATCH_VERSIONS = ["0", "1", "2", "3"];
const BUILD_HASH_LEN = 7;

// Cache: key → fingerprint object
const fingerprintCache = new Map();
const MAX_CACHE = 500;

function hash(seed) {
  return createHash("sha256").update(seed).digest("hex");
}

// Deterministic pick from a list using a hex hash slice.
function pickFromHash(hex, offset, list) {
  const slice = hex.slice(offset, offset + 8);
  const n = parseInt(slice, 16);
  return list[n % list.length];
}

// Build a stable fingerprint for the given (provider, account) tuple.
// Returns an object with discrete header values; caller composes them into
// the actual outbound headers.
export function getFingerprint(provider, accountKey) {
  const cacheKey = `${provider}::${accountKey}`;
  const cached = fingerprintCache.get(cacheKey);
  if (cached) return cached;

  if (fingerprintCache.size >= MAX_CACHE) {
    const firstKey = fingerprintCache.keys().next().value;
    if (firstKey !== undefined) fingerprintCache.delete(firstKey);
  }

  const h = hash(cacheKey);
  const fp = {
    buildHash: h.slice(0, BUILD_HASH_LEN),
    patchVersion: pickFromHash(h, 0, PATCH_VERSIONS),
    platform: pickFromHash(h, 8, PLATFORMS),
    secChUaMobile: parseInt(h.slice(16, 24), 16) % 100 < 5 ? "?1" : "?0",
  };
  fingerprintCache.set(cacheKey, fp);
  return fp;
}

// Apply fingerprint to existing headers in-place-safe (returns new object).
// Only fills fields the caller didn't already set.
//
// IMPORTANT: this function MUST NOT inject headers that Antigravity treats
// as significant (X-Client-Version is checked by Google's anti-abuse and
// must stay at the executor-configured value). We only touch headers that
// our scrub module would otherwise strip — so this is effectively a no-op
// for the upstream request. Kept around for SESSION TRACKING / dashboard
// display only. See getFingerprint() for the full fingerprint object.
export function applyFingerprint(headers, provider, accountKey) {
  if (!provider || !accountKey) return headers;
  // Touch the cache so dashboard can read the fingerprint; do NOT mutate
  // outgoing headers to avoid changing the upstream request shape.
  getFingerprint(provider, accountKey);
  return headers;
}

export function clearFingerprintCache() {
  fingerprintCache.clear();
}
export function getFingerprintCacheSize() {
  return fingerprintCache.size;
}
