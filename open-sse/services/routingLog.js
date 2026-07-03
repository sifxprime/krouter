// 0.5.91 — Routing Decision Log.
//
// In-memory ring buffer of the last N routing decisions. Emitted by
// recordOutcome() where the routing loop already knows what happened.
// Never persisted — a diagnostic view, not an audit log.
//
// Consumed by /api/providers/zenith/log for the dashboard's decision panel.

const RING_SIZE = 200;

// Kept on globalThis so the buffer survives Next.js dev hot reloads.
const g = (globalThis.__krouterRoutingLog ??= { entries: [], head: 0 });

/**
 * Append a decision. Called from recordOutcome() or the routing loop.
 * All fields optional except connectionId + success — makes it safe to
 * call from many places without breaking older callers.
 *
 * @param {object} entry
 * @param {string} entry.connectionId
 * @param {boolean} entry.success
 * @param {number} [entry.latencyMs]
 * @param {string} [entry.provider]
 * @param {string} [entry.model]
 * @param {number} [entry.score]
 * @param {string} [entry.strategy]
 */
export function logRoutingDecision(entry) {
  if (!entry || !entry.connectionId) return;
  const record = {
    at: Date.now(),
    connectionId: entry.connectionId,
    provider: entry.provider || null,
    model: entry.model || null,
    success: !!entry.success,
    latencyMs: entry.latencyMs ?? null,
    score: entry.score ?? null,
    strategy: entry.strategy || null,
  };
  if (g.entries.length < RING_SIZE) {
    g.entries.push(record);
  } else {
    g.entries[g.head] = record;
    g.head = (g.head + 1) % RING_SIZE;
  }
}

/**
 * Return the log oldest-first (chronological).
 * @param {number} [limit]
 */
export function readRoutingLog(limit) {
  const chronological = g.entries.length < RING_SIZE
    ? [...g.entries]
    : [...g.entries.slice(g.head), ...g.entries.slice(0, g.head)];
  const out = chronological.slice().reverse(); // newest first
  return typeof limit === "number" ? out.slice(0, limit) : out;
}

/**
 * Clear the ring buffer. Test-only utility.
 */
export function clearRoutingLog() {
  g.entries = [];
  g.head = 0;
}
