// Account Semaphore (0.5.28) — port of OmniRoute's accountSemaphore.
//
// In-memory concurrency limiter per (provider, account). Prevents bursts of
// 5+ parallel requests from all hitting the same account simultaneously,
// which used to cause unnecessary 429s when the account's per-minute quota
// could only handle one request at a time.
//
// Usage:
//   const release = await acquire("antigravity:acct-1", { maxConcurrency: 2 });
//   try { await doRequest(); } finally { release(); }
//
// If a slot isn't immediately available, callers wait in a FIFO queue with
// a timeout. The release function is idempotent and safe in finally blocks.

const DEFAULT_TIMEOUT_MS = 30 * 1000;
const DEFAULT_MAX_QUEUE_SIZE = 20;

const gates = new Map();

export function buildAccountSemaphoreKey(provider, accountKey) {
  return `${String(provider)}:${String(accountKey)}`;
}

function ensureGate(key, maxConcurrency) {
  const existing = gates.get(key);
  if (existing) {
    existing.maxConcurrency = maxConcurrency;
    return existing;
  }
  const created = {
    running: 0,
    maxConcurrency,
    queue: [],
    blockedUntil: null,
  };
  gates.set(key, created);
  return created;
}

function isBlocked(gate) {
  if (!gate.blockedUntil) return false;
  if (Date.now() >= gate.blockedUntil) {
    gate.blockedUntil = null;
    return false;
  }
  return true;
}

function cleanupIfIdle(key) {
  const gate = gates.get(key);
  if (!gate) return;
  if (gate.running > 0 || gate.queue.length > 0 || isBlocked(gate)) return;
  gates.delete(key);
}

function drainQueue(key) {
  const gate = gates.get(key);
  if (!gate) return;
  while (gate.queue.length > 0 && gate.running < gate.maxConcurrency && !isBlocked(gate)) {
    const next = gate.queue.shift();
    if (!next) break;
    clearTimeout(next.timer);
    gate.running++;
    next.resolve(makeRelease(key));
  }
  if (gate.running === 0 && gate.queue.length === 0) cleanupIfIdle(key);
}

function makeRelease(key) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const gate = gates.get(key);
    if (!gate) return;
    if (gate.running > 0) gate.running--;
    if (gate.queue.length > 0) drainQueue(key);
    else cleanupIfIdle(key);
  };
}

function noopRelease() {
  let released = false;
  return () => { released = true; };
}

// Acquire a slot for (provider, account). Returns Promise<() => void> release fn.
// maxConcurrency <= 0 or null = bypass (always returns immediately).
export function acquire(key, opts = {}) {
  const maxConcurrency = opts.maxConcurrency;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxQueueSize = opts.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const signal = opts.signal || null;

  if (!maxConcurrency || maxConcurrency <= 0) return Promise.resolve(noopRelease());

  if (signal?.aborted) {
    return Promise.reject(new Error("Aborted"));
  }

  const gate = ensureGate(key, maxConcurrency);
  if (gate.running < gate.maxConcurrency && !isBlocked(gate)) {
    gate.running++;
    return Promise.resolve(makeRelease(key));
  }

  if (gate.queue.length >= maxQueueSize) {
    const err = new Error(`Semaphore queue full (${maxQueueSize}) for ${key}`);
    err.code = "SEMAPHORE_QUEUE_FULL";
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const g = gates.get(key);
      if (g) {
        const idx = g.queue.findIndex(q => q.timer === timer);
        if (idx !== -1) g.queue.splice(idx, 1);
      }
      const err = new Error(`Semaphore timeout after ${timeoutMs}ms for ${key}`);
      err.code = "SEMAPHORE_TIMEOUT";
      reject(err);
    }, timeoutMs);
    timer.unref?.();

    gate.queue.push({ resolve, reject, timer });
  });
}

// Block new acquisitions for a key for cooldownMs. In-flight requests finish normally.
// Used after a 429 to prevent new requests from piling onto the rate-limited account.
export function markBlocked(key, cooldownMs) {
  const ms = Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : 0;
  if (ms <= 0) return;
  const gate = ensureGate(key, gates.get(key)?.maxConcurrency ?? 1);
  gate.blockedUntil = Date.now() + ms;
}

export function getSemaphoreStats(key) {
  const gate = gates.get(key);
  if (!gate) return null;
  return {
    running: gate.running,
    queued: gate.queue.length,
    maxConcurrency: gate.maxConcurrency,
    blockedUntil: gate.blockedUntil ? new Date(gate.blockedUntil).toISOString() : null,
  };
}

// For tests
export function clearAllSemaphores() {
  for (const gate of gates.values()) {
    for (const q of gate.queue) clearTimeout(q.timer);
  }
  gates.clear();
}
