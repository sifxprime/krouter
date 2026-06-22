// antigravityProjectBootstrap (0.5.29) — slimmed port of OmniRoute's
// antigravityProjectBootstrap.
//
// Why this exists: Google's Cloud Code Assist API (used by Antigravity)
// requires a prior loadCodeAssist call to bind an OAuth token to a project
// id. Without it, the actual generateContent calls 404. Our existing
// `usage.js::getAntigravitySubscriptionInfo` does the loadCodeAssist call
// but ALWAYS hits upstream — no memoization.
//
// This module adds a per-token / per-connection memoization wrapper so we
// only hit loadCodeAssist ONCE per token (until it changes). Saves ~150ms
// of latency on every chat request and reduces our footprint on Google's
// rate limit for the discovery endpoint.

import { proxyAwareFetch } from "../utils/proxyFetch.js";

const LOAD_CODE_ASSIST_URLS = [
  "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
];
const BOOTSTRAP_TIMEOUT_MS = 8000;

// Memoization: cache the project id for the lifetime of an access token.
// Key: accessToken (changes on refresh → cache invalidates naturally).
// Value: { projectId, fetchedAt }
const _projectCache = new Map();
const MAX_CACHE_ENTRIES = 200;

function evictIfFull() {
  if (_projectCache.size < MAX_CACHE_ENTRIES) return;
  const oldest = _projectCache.keys().next().value;
  if (oldest !== undefined) _projectCache.delete(oldest);
}

function extractProjectId(data) {
  const raw = data?.cloudaicompanionProject;
  if (typeof raw === "string") return raw.trim() || null;
  if (raw && typeof raw === "object" && typeof raw.id === "string") {
    return raw.id.trim() || null;
  }
  return null;
}

// Ensure the access token has an assigned project id. Returns the project
// id (cached or freshly bootstrapped) or null on failure.
//
// Idempotent + dedupe: multiple concurrent calls for the same token share
// one upstream fetch via the in-flight map.
const _inFlight = new Map();

export async function ensureAntigravityProject(accessToken, opts = {}) {
  if (!accessToken) return null;
  const cached = _projectCache.get(accessToken);
  if (cached) return cached.projectId;

  // Dedupe concurrent bootstrap attempts for the same token
  const existing = _inFlight.get(accessToken);
  if (existing) return existing;

  const promise = (async () => {
    try {
      for (const url of LOAD_CODE_ASSIST_URLS) {
        try {
          const res = await proxyAwareFetch(url, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "User-Agent": opts.userAgent || "antigravity",
              "x-request-source": "local",
            },
            body: JSON.stringify({
              metadata: {
                ideType: "VSCODE",
                platform: opts.platform || process.platform,
                pluginType: "GEMINI",
              },
            }),
            signal: AbortSignal.timeout(BOOTSTRAP_TIMEOUT_MS),
          }, opts.proxyOptions || null);

          if (!res.ok) continue;
          const data = await res.json();
          const projectId = extractProjectId(data);
          if (projectId) {
            evictIfFull();
            _projectCache.set(accessToken, { projectId, fetchedAt: Date.now() });
            return projectId;
          }
        } catch {
          // Try next URL
        }
      }
      return null;
    } finally {
      _inFlight.delete(accessToken);
    }
  })();

  _inFlight.set(accessToken, promise);
  return promise;
}

// Invalidate the cache for a token — call after a 401 / token refresh so
// the next request re-bootstraps cleanly.
export function invalidateAntigravityProject(accessToken) {
  if (accessToken) _projectCache.delete(accessToken);
}

// For tests / debugging
export function _clearProjectCache() {
  _projectCache.clear();
  _inFlight.clear();
}

export function _getProjectCacheSize() {
  return _projectCache.size;
}
