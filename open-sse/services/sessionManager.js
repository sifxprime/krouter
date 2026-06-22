// sessionManager (0.5.29) — distilled from OmniRoute's sessionManager + sessionPool.
//
// Two distinct concepts:
//   1. SESSION ID — a stable fingerprint that identifies a "conversation"
//      based on (model, system prompt, tool list, first user message) +
//      provider + connection. Same conversation continuing from the same
//      account → same session id. Enables prompt caching on upstream and
//      sticky routing on our side. This is the high-value pure function.
//
//   2. SESSION POOL — in-memory state about active sessions (last used,
//      request count, connection bound). Used by the dashboard's "Active
//      sessions" view and by the API-key throttler to limit concurrent
//      sessions per key. Capped at MAX_SESSIONS (LRU eviction).
//
// All state is in-memory and rebuilt within a few minutes of restart — no
// persistence overhead.

import { createHash } from "node:crypto";

const sessions = new Map(); // sessionId -> { createdAt, lastActive, requestCount, connectionId, lastToolFinishAt? }
const activeSessionsByKey = new Map(); // apiKeyId -> Set<sessionId>

const MAX_SESSIONS = 200;
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 min

// Background cleanup of expired sessions + LRU cap. Safe under unref so
// the process can exit normally if everything else is idle.
const _cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessions) {
    if (now - entry.lastActive > SESSION_TTL_MS) {
      sessions.delete(key);
      for (const set of activeSessionsByKey.values()) set.delete(key);
    }
  }
  while (sessions.size > MAX_SESSIONS) {
    let oldest = null;
    let oldestTime = Infinity;
    for (const [k, v] of sessions) {
      if (v.lastActive < oldestTime) { oldestTime = v.lastActive; oldest = k; }
    }
    if (!oldest) break;
    sessions.delete(oldest);
    for (const set of activeSessionsByKey.values()) set.delete(oldest);
  }
}, 60_000);
_cleanupTimer.unref?.();

// Derive a deterministic session id from request body + (provider, connectionId).
// Same input → same id (sticky session for the same conversation). Pure.
export function generateSessionId(body, options = {}) {
  if (!body || typeof body !== "object") return null;
  const parts = [];

  // Model
  if (typeof body.model === "string") parts.push(`m:${body.model}`);

  // System prompt (Claude has body.system; OpenAI puts it in messages[0])
  if (typeof body.system === "string") {
    parts.push(`s:${body.system.slice(0, 200)}`);
  } else if (Array.isArray(body.system)) {
    parts.push(`s:${JSON.stringify(body.system).slice(0, 200)}`);
  }

  // Tools (just names, sorted, so order doesn't matter)
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const names = body.tools
      .map(t => t?.name || t?.function?.name || "")
      .filter(Boolean)
      .sort();
    parts.push(`t:${names.join(",")}`);
  }

  // First user message (defines the conversation start)
  const messages = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : [];
  const firstUser = messages.find(m => m?.role === "user");
  if (firstUser) {
    const content = typeof firstUser.content === "string"
      ? firstUser.content
      : Array.isArray(firstUser.content)
        ? firstUser.content.map(p => p?.text || "").join("")
        : "";
    parts.push(`u:${content.slice(0, 500)}`);
  }

  // Provider + connection scope
  if (options.provider) parts.push(`p:${options.provider}`);
  if (options.connectionId) parts.push(`c:${options.connectionId}`);

  if (parts.length === 0) return null;
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

// Touch a session as recently active. Idempotent. Also registers the
// (apiKey, session) link for per-key concurrency tracking.
export function touchSession(sessionId, connectionId = null, apiKeyId = null) {
  if (!sessionId) return;
  const now = Date.now();
  let entry = sessions.get(sessionId);
  if (!entry) {
    entry = { createdAt: now, lastActive: now, requestCount: 0, connectionId };
    sessions.set(sessionId, entry);
  } else {
    entry.lastActive = now;
    if (connectionId && !entry.connectionId) entry.connectionId = connectionId;
  }
  entry.requestCount++;
  if (apiKeyId) {
    let set = activeSessionsByKey.get(apiKeyId);
    if (!set) { set = new Set(); activeSessionsByKey.set(apiKeyId, set); }
    set.add(sessionId);
  }
}

// Mark a tool call as finishing — used by latency tracker to know when the
// next request from this session is a tool-result follow-up.
export function markToolFinish(sessionId) {
  if (!sessionId) return;
  const entry = sessions.get(sessionId);
  if (entry) entry.lastToolFinishAt = Date.now();
}

// Consume + clear the tool-finish timestamp (one-shot read).
export function consumeToolFinishTime(sessionId) {
  if (!sessionId) return null;
  const entry = sessions.get(sessionId);
  if (!entry || !entry.lastToolFinishAt) return null;
  const t = entry.lastToolFinishAt;
  entry.lastToolFinishAt = undefined;
  return t;
}

export function getSessionInfo(sessionId) {
  if (!sessionId) return null;
  const entry = sessions.get(sessionId);
  return entry ? { ...entry } : null;
}

export function getSessionConnection(sessionId) {
  return getSessionInfo(sessionId)?.connectionId || null;
}

export function getActiveSessionCount() {
  return sessions.size;
}

export function getActiveSessions() {
  const now = Date.now();
  const result = [];
  for (const [id, entry] of sessions) {
    if (now - entry.lastActive <= SESSION_TTL_MS) {
      result.push({ sessionId: id, ...entry, ageMs: now - entry.createdAt });
    }
  }
  return result;
}

export function clearSessions() {
  sessions.clear();
  activeSessionsByKey.clear();
}

export function getActiveSessionCountForKey(apiKeyId) {
  return activeSessionsByKey.get(apiKeyId)?.size || 0;
}

export function getAllActiveSessionCountsByKey() {
  const out = {};
  for (const [k, set] of activeSessionsByKey) out[k] = set.size;
  return out;
}

export function registerKeySession(apiKeyId, sessionId) {
  if (!apiKeyId || !sessionId) return;
  let set = activeSessionsByKey.get(apiKeyId);
  if (!set) { set = new Set(); activeSessionsByKey.set(apiKeyId, set); }
  set.add(sessionId);
}

export function isSessionRegisteredForKey(apiKeyId, sessionId) {
  return activeSessionsByKey.get(apiKeyId)?.has(sessionId) || false;
}

export function unregisterKeySession(apiKeyId, sessionId) {
  const set = activeSessionsByKey.get(apiKeyId);
  if (!set) return;
  set.delete(sessionId);
  if (set.size === 0) activeSessionsByKey.delete(apiKeyId);
}
