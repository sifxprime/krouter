import { ERROR_RULES, BACKOFF_CONFIG, TRANSIENT_COOLDOWN_MS, ACCOUNT_VERIFY_COOLDOWN_MS } from "../config/errorConfig.js";
import { resolveProviderAlias } from "./model.js";

// 0.5.166 — statuses that speak about the credential. Any other 4xx no rule
// claims was caused by the request itself (upstream 20a43f5a).
const ACCOUNT_SCOPED_4XX = new Set([401, 402, 403, 429]);
// Executors whose 4xx status says nothing about the cause: cursor.js reports every
// non-rate-limit Connect error (auth, plan, quota) as 400. Keep the old default there.
const OPAQUE_4XX_PROVIDERS = new Set(["cursor"]);

/**
 * Calculate exponential backoff cooldown for rate limits (429)
 * Level 1: 1s, Level 2: 2s, Level 3: 4s... → max 4 min
 * @param {number} backoffLevel - Current backoff level
 * @returns {number} Cooldown in milliseconds
 */
export function getQuotaCooldown(backoffLevel = 0) {
  const level = Math.max(0, backoffLevel - 1);
  const cooldown = BACKOFF_CONFIG.base * Math.pow(2, level);
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

/**
 * Check if error should trigger account fallback (switch to next account)
 * Config-driven: matches ERROR_RULES top-to-bottom (text rules first, then status)
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message text
 * @param {number} backoffLevel - Current backoff level for exponential backoff
 * @param {string|null} provider - Provider id or alias; enables provider-scoped rules
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number, accountLock?: boolean, requestScoped?: boolean }}
 */
export function checkFallbackError(status, errorText, backoffLevel = 0, provider = null) {
  const lowerError = errorText
    ? (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase()
    : "";
  // 0.5.166 — provider-scoped rules (upstream 9f41ee75); accept "cx" as well as "codex".
  const providerId = provider ? resolveProviderAlias(provider) : null;

  for (const rule of ERROR_RULES) {
    if (rule.provider && rule.provider !== providerId) continue;
    // Text-based rule: match substring in error message
    if (rule.text && lowerError && lowerError.includes(rule.text)) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      // Deterministic error (e.g. model deleted upstream) — no point fanning out
      // through other accounts. Signal the caller to stop iterating; cooldownMs
      // still applies to this account so the picker won't keep selecting it.
      if (rule.shouldFallback === false) {
        return { shouldFallback: false, cooldownMs: rule.cooldownMs, accountLock: rule.accountLock || false, permanent: rule.permanent || false };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs, accountLock: rule.accountLock || false, permanent: rule.permanent || false };
    }

    // Status-based rule: match HTTP status code
    if (rule.status && rule.status === status) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      if (rule.shouldFallback === false) {
        return { shouldFallback: false, cooldownMs: rule.cooldownMs, accountLock: rule.accountLock || false, permanent: rule.permanent || false };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs, accountLock: rule.accountLock || false, permanent: rule.permanent || false };
    }
  }

  // 0.5.166 — a 4xx no rule above claimed is about the request (malformed body,
  // unsupported parameter, validation), not the credential (upstream 20a43f5a).
  // The old 30s default locked a healthy account, and with one connection every
  // request in that window failed with a copy of this error. No lock, no account
  // failover. requestScoped tells a combo it may still try its NEXT member: a
  // different model can accept what this one rejected. 404 keeps its status rule.
  if (status >= 400 && status < 500 && !ACCOUNT_SCOPED_4XX.has(status) && !OPAQUE_4XX_PROVIDERS.has(providerId)) {
    return { shouldFallback: false, cooldownMs: 0, requestScoped: true };
  }

  // Default: transient cooldown for any unmatched error
  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
}

/**
 * Check if account is currently unavailable (cooldown not expired)
 */
export function isAccountUnavailable(unavailableUntil) {
  if (!unavailableUntil) return false;
  return new Date(unavailableUntil).getTime() > Date.now();
}

/**
 * Calculate unavailable until timestamp
 */
export function getUnavailableUntil(cooldownMs) {
  return new Date(Date.now() + cooldownMs).toISOString();
}

/**
 * Get the earliest rateLimitedUntil from a list of accounts
 * @param {Array} accounts - Array of account objects with rateLimitedUntil
 * @returns {string|null} Earliest rateLimitedUntil ISO string, or null
 */
export function getEarliestRateLimitedUntil(accounts) {
  let earliest = null;
  const now = Date.now();
  for (const acc of accounts) {
    if (!acc.rateLimitedUntil) continue;
    const until = new Date(acc.rateLimitedUntil).getTime();
    if (until <= now) continue;
    if (!earliest || until < earliest) earliest = until;
  }
  if (!earliest) return null;
  return new Date(earliest).toISOString();
}

/**
 * 0.5.169 — which recorded status a "every account is parked" reply may report as-is.
 *
 * 0.5.166 pinned this reply to 503 + Retry-After because a stale 401 made Claude Code
 * treat a cooldown as a bad key (upstream 15687d19). That is right for a credential or
 * rate-limit status: the account really may recover, and 503 + Retry-After is what a
 * client should back off on.
 *
 * It is wrong for 404. A 404 says the thing asked for is not there, which no amount of
 * waiting changes, so "503, retry after 30m" sends the client to sleep over something
 * that will still be missing. Reproduced on a live install against a model kRouter's own
 * /v1/models advertises:
 *   attempt 1  404 model_not_found  1.71s   (the honest upstream answer)
 *   attempt 2  503 "reset after 30m" 0.04s  (locked)
 *   attempt 3  503 "reset after 30m" 0.04s
 * The user picked the id from our list, and after one request got half an hour of 503 on
 * it. The connection row had errorCode 404 and modelLock_* keys for nine models, two of
 * which serve fine, so healthy models reach this path too.
 *
 * imageGeneration, tts and videoGeneration already report the recorded code; chat and
 * embeddings hardcoded 503. This keeps them consistent without reopening 0.5.166.
 */
const PARKED_REPORTABLE_STATUSES = new Set([404]);

export function parkedAccountStatus(lastErrorCode, defaultStatus) {
  const code = Number(lastErrorCode);
  return PARKED_REPORTABLE_STATUSES.has(code) ? code : defaultStatus;
}

/**
 * Format rateLimitedUntil to human-readable "reset after Xm Ys"
 * @param {string} rateLimitedUntil - ISO timestamp
 * @returns {string} e.g. "reset after 2m 30s"
 */
export function formatRetryAfter(rateLimitedUntil) {
  if (!rateLimitedUntil) return "";
  const diffMs = new Date(rateLimitedUntil).getTime() - Date.now();
  if (diffMs <= 0) return "reset after 0s";
  const totalSec = Math.ceil(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return `reset after ${parts.join(" ")}`;
}

/** Prefix for model lock flat fields on connection record */
export const MODEL_LOCK_PREFIX = "modelLock_";

/** Special key used when no model is known (account-level lock) */
export const MODEL_LOCK_ALL = `${MODEL_LOCK_PREFIX}__all`;

/** Build the flat field key for a model lock */
export function getModelLockKey(model) {
  return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

/**
 * Check if a model lock on a connection is still active.
 * Reads flat field `modelLock_${model}` (or `modelLock___all` when model=null).
 */
export function isModelLockActive(connection, model) {
  // 0.5.164 — locked until the LATER of the model's key and modelLock___all. The
  // old `connection[key] || connection[MODEL_LOCK_ALL]` let an expired per-model
  // key (only cleared on a success) hide an active account-wide monthly hold.
  const lockMs = (v) => (v ? new Date(v).getTime() || 0 : 0);
  const expiryMs = Math.max(lockMs(connection[getModelLockKey(model)]), lockMs(connection[MODEL_LOCK_ALL]));
  return expiryMs > Date.now();
}

/**
 * Get earliest active model lock expiry across all modelLock_* fields.
 * Used for UI cooldown display.
 */
export function getEarliestModelLockUntil(connection) {
  if (!connection) return null;
  let earliest = null;
  const now = Date.now();
  for (const [key, val] of Object.entries(connection)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
    const t = new Date(val).getTime();
    if (t <= now) continue;
    if (!earliest || t < earliest) earliest = t;
  }
  return earliest ? new Date(earliest).toISOString() : null;
}

/**
 * 0.5.166 — latest modelLock_* expiry still in the future, or null. The connection
 * card counts down to it: the earliest raw value can be an expired key (only a
 * success clears those), which hid an active month-long account hold's countdown.
 * @param {object|null} connection
 * @param {number} [now]
 * @returns {string|null} ISO timestamp
 */
export function getLatestModelLockUntil(connection, now = Date.now()) {
  if (!connection) return null;
  let latest = 0;
  for (const [key, val] of Object.entries(connection)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
    const t = new Date(val).getTime();
    if (Number.isFinite(t) && t > now && t > latest) latest = t;
  }
  return latest ? new Date(latest).toISOString() : null;
}

/**
 * Build update object to set a model lock on a connection.
 */
export function buildModelLockUpdate(model, cooldownMs) {
  const key = getModelLockKey(model);
  return { [key]: new Date(Date.now() + cooldownMs).toISOString() };
}

/**
 * Build update object to clear all model locks on a connection.
 */
export function buildClearModelLocksUpdate(connection) {
  const cleared = {};
  for (const key of Object.keys(connection)) {
    if (key.startsWith(MODEL_LOCK_PREFIX)) cleared[key] = null;
  }
  return cleared;
}

/**
 * Filter available accounts (not in cooldown)
 */
export function filterAvailableAccounts(accounts, excludeId = null) {
  const now = Date.now();
  return accounts.filter(acc => {
    if (excludeId && acc.id === excludeId) return false;
    if (acc.rateLimitedUntil) {
      const until = new Date(acc.rateLimitedUntil).getTime();
      if (until > now) return false;
    }
    return true;
  });
}

/**
 * Reset account state when request succeeds
 * Clears cooldown and resets backoff level to 0
 * @param {object} account - Account object
 * @returns {object} Updated account with reset state
 */
export function resetAccountState(account) {
  if (!account) return account;
  return {
    ...account,
    rateLimitedUntil: null,
    backoffLevel: 0,
    lastError: null,
    status: "active"
  };
}

/**
 * Apply error state to account
 * @param {object} account - Account object
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message
 * @returns {object} Updated account with error state
 */
export function applyErrorState(account, status, errorText) {
  if (!account) return account;

  const backoffLevel = account.backoffLevel || 0;
  const { cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel);

  return {
    ...account,
    rateLimitedUntil: cooldownMs > 0 ? getUnavailableUntil(cooldownMs) : null,
    backoffLevel: newBackoffLevel ?? backoffLevel,
    lastError: { status, message: errorText, timestamp: new Date().toISOString() },
    status: "error"
  };
}
