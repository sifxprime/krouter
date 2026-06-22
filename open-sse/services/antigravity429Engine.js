// antigravity429Engine (0.5.29) — port of OmniRoute's antigravity429Engine.
//
// Classifies Google's 429 responses into 4 categories so the caller can
// make a nuanced retry decision instead of "exponential backoff every time".
//
// Categories:
//   unknown          → generic 429, default backoff
//   soft_rate_limit  → burst limit, instant retry on same auth
//   rate_limited     → RPM cap, short backoff or switch auth if long
//   quota_exhausted  → daily/plan quota gone, skip this account ~5h–24h
//
// Decisions (kind):
//   instant_retry_same_auth     wait ≤3s and retry
//   soft_retry                  short wait, retry same auth
//   short_cooldown_switch_auth  ~5min lock, rotate accounts
//   full_quota_exhausted        long lock, skip this account
//
// Pure functions — no I/O, no globals (except a per-process credits-failure
// counter that's used by the optional auto-disable feature).

const QUOTA_EXHAUSTED_KEYWORDS = [
  "quota_exhausted",
  "quota exhausted",
  "quota reached",
  "enable overages",
  "individual quota",
];

const CREDITS_EXHAUSTED_KEYWORDS = [
  "google_one_ai",
  "insufficient credit",
  "insufficient credits",
  "not enough credit",
  "not enough credits",
  "credit exhausted",
  "credits exhausted",
  "credit balance",
  "minimumcreditamountforusage",
  "minimum credit amount for usage",
  "minimum credit",
  "resource has been exhausted",
];

const SHORT_COOLDOWN_MS = 5 * 60 * 1000;
const FULL_QUOTA_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const INSTANT_RETRY_THRESHOLD_MS = 3 * 1000;

export function classify429(errorMessage) {
  const lower = (errorMessage || "").toLowerCase();
  for (const kw of QUOTA_EXHAUSTED_KEYWORDS) if (lower.includes(kw)) return "quota_exhausted";
  for (const kw of CREDITS_EXHAUSTED_KEYWORDS) if (lower.includes(kw)) return "quota_exhausted";

  if (
    lower.includes("per minute") ||
    lower.includes("rpm") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("too many requests")
  ) {
    return "rate_limited";
  }

  if (
    lower.includes("free tier") ||
    lower.includes("daily limit") ||
    lower.includes("exhausted your capacity")
  ) {
    return "quota_exhausted";
  }

  if (lower.includes("try again") || lower.includes("temporarily")) {
    return "soft_rate_limit";
  }

  return "unknown";
}

export function decide429(category, retryAfterMs) {
  switch (category) {
    case "soft_rate_limit":
      return {
        kind: retryAfterMs && retryAfterMs <= INSTANT_RETRY_THRESHOLD_MS
          ? "instant_retry_same_auth"
          : "soft_retry",
        retryAfterMs: retryAfterMs ?? 2000,
        reason: "Soft rate limit — brief backoff",
      };

    case "rate_limited":
      return {
        kind: retryAfterMs && retryAfterMs <= SHORT_COOLDOWN_MS
          ? "soft_retry"
          : "short_cooldown_switch_auth",
        retryAfterMs: retryAfterMs ?? 60_000,
        reason: "RPM rate limit — switch auth if cooldown is long",
      };

    case "quota_exhausted":
      return {
        kind: "full_quota_exhausted",
        retryAfterMs: retryAfterMs ?? FULL_QUOTA_COOLDOWN_MS,
        reason: "Quota exhausted — skip this account",
      };

    default:
      return {
        kind: "soft_retry",
        retryAfterMs: retryAfterMs ?? 5000,
        reason: "Unknown 429 — generic backoff",
      };
  }
}

// Per-account credits failure tracker. After CREDITS_DISABLE_THRESHOLD
// consecutive credits errors, recommend disabling that account for
// CREDITS_COOLDOWN_MS. Reset on any successful call.
const creditsFailureMap = new Map();
const CREDITS_DISABLE_THRESHOLD = 3;
const CREDITS_COOLDOWN_MS = 5 * 60 * 60 * 1000;

export function recordCreditsFailure(authKey) {
  if (!authKey) return false;
  const state = creditsFailureMap.get(authKey) ?? { count: 0, disabledUntil: 0 };
  state.count++;
  if (state.count >= CREDITS_DISABLE_THRESHOLD) {
    state.disabledUntil = Date.now() + CREDITS_COOLDOWN_MS;
    creditsFailureMap.set(authKey, state);
    return true;
  }
  creditsFailureMap.set(authKey, state);
  return false;
}

export function isCreditsDisabled(authKey) {
  if (!authKey) return false;
  const state = creditsFailureMap.get(authKey);
  if (!state) return false;
  if (state.disabledUntil > Date.now()) return true;
  creditsFailureMap.delete(authKey);
  return false;
}

export function resetCreditsFailure(authKey) {
  if (authKey) creditsFailureMap.delete(authKey);
}

// For tests
export function _clearCreditsState() { creditsFailureMap.clear(); }
export { SHORT_COOLDOWN_MS, FULL_QUOTA_COOLDOWN_MS };
