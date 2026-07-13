// Response cache for repeated non-streaming LLM requests.
//
// Many IDE/agent workflows re-fire identical requests within seconds (warmup,
// title generation, structured-output retries, "is X enabled" probes). Caching
// the response for a short TTL saves real provider tokens without sacrificing
// correctness, since the cache is keyed by the exact request shape.
//
// Cache key = SHA-256 of (model, system prompt, messages JSON, temperature,
// max_tokens, tools JSON). Cache value = the upstream's full JSON body + status
// code + content-type. TTL is configurable; default 5 minutes.
//
// Streaming requests are NOT cached in this version — capturing + replaying SSE
// chunks correctly across providers is a larger undertaking. Determinism is
// gated on temperature ≤ 0.3 (raises the bar above the model's stochastic
// floor).
//
// Stored in module-global memory (Map) with LRU eviction at max entries.
import crypto from "node:crypto";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;
const MAX_TEMPERATURE_FOR_CACHE = 0.3;

const g = globalThis;
if (!g.__krouterResponseCache) {
  g.__krouterResponseCache = new Map();
  g.__krouterResponseCacheStats = {
    hits: 0,
    misses: 0,
    skipped: 0,
    bytesSaved: 0,
    tokensSaved: 0,
    lastResetAt: Date.now(),
  };
}

const cache = g.__krouterResponseCache;
const stats = g.__krouterResponseCacheStats;

function hashRequest({ model, body }) {
  const keyParts = {
    model,
    system: body?.system ?? null,
    instructions: body?.instructions ?? null,
    messages: body?.messages ?? null,
    input: body?.input ?? null,
    contents: body?.contents ?? null,
    temperature: body?.temperature ?? null,
    max_tokens: body?.max_tokens ?? body?.max_output_tokens ?? null,
    tools: body?.tools ?? null,
    tool_choice: body?.tool_choice ?? null,
    response_format: body?.response_format ?? null,
  };
  const serialized = JSON.stringify(keyParts);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

// 0.5.99 — Providers with backend session-state, per-account contextual routing,
// or heavy IDE-driven probe traffic that breaks a naive request-hash cache.
// User reports of duplicate/wrong replies on Antigravity + Gemini surface fell
// into this bucket: the Google IDE fires probes with identical bodies whose
// answers then leak into real user turns. Safest to skip caching entirely for
// this family.
//
// 0.5.101 — CRITICAL: the model string that reaches the cache uses the provider
// ALIAS, not the provider id (e.g. "ag/gemini-3-flash-agent", "gc/gemini-2.5").
// v0.5.99 only listed the ids, so the guard never fired and the user's
// Antigravity duplicate-reply bug persisted. Include BOTH ids and aliases:
//   antigravity → ag · gemini-cli → gc · gemini → gemini (id == alias)
const CACHE_UNSAFE_PROVIDERS = new Set([
  "antigravity", "ag",
  "gemini",
  "gemini-cli", "gc",
]);

// Extract provider slug from a modelStr like "antigravity/gemini-2.5-pro" or
// "kr/claude-sonnet-4.5-thinking". Falls back to null if unparseable.
function providerFromModel(model) {
  if (typeof model !== "string") return null;
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : null;
}

function isCacheable(body, model = null) {
  if (!body || typeof body !== "object") return false;
  // Streaming requests skipped — see file docstring.
  if (body.stream === true) return false;
  // Heuristic determinism: any temperature above 0.3 cannot be safely cached.
  if (typeof body.temperature === "number" && body.temperature > MAX_TEMPERATURE_FOR_CACHE) return false;
  // Tool calls with tool_choice: "required" generally indicate the model is
  // mid-conversation about a side effect — never serve from cache.
  if (body.tool_choice === "required") return false;
  // 0.5.99 — Provider blocklist. Antigravity/Gemini IDE probes were leaking
  // canned "warmup" replies into user turns because their bodies hash identically.
  const provider = providerFromModel(model);
  if (provider && CACHE_UNSAFE_PROVIDERS.has(provider)) return false;
  // 0.5.99 — Skip caching when max_tokens is tiny (< 32) — that's almost always
  // an IDE probe, not a real turn worth cache-hitting later.
  const maxTok = body.max_tokens ?? body.max_output_tokens ?? null;
  if (typeof maxTok === "number" && maxTok < 32) return false;
  return true;
}

export function lookupCache({ model, body }) {
  if (!isCacheable(body, model)) {
    stats.skipped++;
    return null;
  }
  const key = hashRequest({ model, body });
  const entry = cache.get(key);
  if (!entry) {
    stats.misses++;
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    stats.misses++;
    return null;
  }
  // LRU touch: move to end
  cache.delete(key);
  cache.set(key, entry);
  stats.hits++;
  stats.bytesSaved += entry.bodyBytes || 0;
  stats.tokensSaved += entry.estimatedTokens || 0;
  return entry;
}

export function saveToCache({ model, body, status, contentType, responseBody, estimatedTokens = 0, ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES }) {
  if (!isCacheable(body, model)) return false;
  if (status !== 200) return false;
  if (!responseBody) return false;
  // 0.5.99 — Also skip caching sub-100-byte responses. Those are almost always
  // error stubs, empty completions, or probe pings; keeping them poisons the
  // cache with worthless hits.
  if (typeof responseBody === "string" && responseBody.length < 100) return false;

  const key = hashRequest({ model, body });
  const serialized = typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody);
  const entry = {
    key,
    status,
    contentType: contentType || "application/json",
    body: serialized,
    bodyBytes: Buffer.byteLength(serialized, "utf-8"),
    estimatedTokens,
    expiresAt: Date.now() + ttlMs,
    storedAt: Date.now(),
    model,
  };
  cache.set(key, entry);
  // LRU evict oldest if over capacity
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
  return true;
}

export function getCacheStats() {
  const total = stats.hits + stats.misses;
  return {
    enabled: true,
    entries: cache.size,
    hits: stats.hits,
    misses: stats.misses,
    skipped: stats.skipped,
    hitRate: total > 0 ? stats.hits / total : 0,
    bytesSaved: stats.bytesSaved,
    tokensSaved: stats.tokensSaved,
    lastResetAt: stats.lastResetAt,
  };
}

export function resetCache() {
  cache.clear();
  stats.hits = 0;
  stats.misses = 0;
  stats.skipped = 0;
  stats.bytesSaved = 0;
  stats.tokensSaved = 0;
  stats.lastResetAt = Date.now();
}

// Test helper — purge expired entries on demand.
export function purgeExpired() {
  const now = Date.now();
  let removed = 0;
  for (const [k, v] of cache) {
    if (v.expiresAt < now) {
      cache.delete(k);
      removed++;
    }
  }
  return removed;
}
