// OpenAI-compatible error types mapping (client-facing)
export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout"
};

// Exponential backoff config for rate limits
export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15
};

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Hard cap for provider-reported rate limit cooldown (e.g. codex resets_at can be 5-6h)
export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

// Cooldown for Google "Verify your account" 403. The whole account needs human
// intervention — lock ALL models on the account for 1hr so no further requests
// are wasted on it. Auto-clears after 1hr OR when user clicks "Test connection".
export const ACCOUNT_VERIFY_COOLDOWN_MS = 60 * 60 * 1000;

// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
  // Until-end-of-month: rough 30-day lockout for monthly quota exhaustion.
  // Triggered by upstream-reported monthly billing-cycle errors (e.g. Kiro
  // ServiceQuotaExceededException reason=MONTHLY_REQUEST_COUNT). Retrying
  // before the next billing cycle just burns kRouter cycles and surfaces
  // the same 402 to the user's IDE.
  monthly: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Unified error classification rules.
 * Checked top-to-bottom: text rules first (by order), then status rules.
 * Each rule: { text?, status?, cooldownMs?, backoff? }
 *   - text: substring match (case-insensitive) on error message
 *   - status: HTTP status code match
 *   - cooldownMs: fixed cooldown duration
 *   - backoff: true = use exponential backoff (rate limit)
 */
export const ERROR_RULES = [
  // --- Text-based rules (checked first, order = priority) ---
  // "Verify your account" = Google anti-abuse 403. PERMANENT ban signal —
  // ported from OmniRoute v3.8.35: this account will NEVER auto-recover.
  // 0.5.46 raises cooldown 1h → 24h so we stop wasting requests retrying every
  // hour. User must click Google's verification URL OR add a fresh account.
  // Account is locked WHOLE (accountLock:true, modelLock___all).
  { text: "verify your account",       cooldownMs: 24 * 60 * 60 * 1000, accountLock: true, permanent: true },
  { text: "this service has been disabled in this account", cooldownMs: 24 * 60 * 60 * 1000, accountLock: true, permanent: true },
  { text: "your account has been suspended", cooldownMs: 24 * 60 * 60 * 1000, accountLock: true, permanent: true },
  { text: "this account is deactivated", cooldownMs: 24 * 60 * 60 * 1000, accountLock: true, permanent: true },
  { text: "no credentials",            cooldownMs: COOLDOWN.long },
  { text: "request not allowed",       cooldownMs: COOLDOWN.short },
  { text: "improperly formed request", cooldownMs: COOLDOWN.long },
  // Monthly quota exhaustion (Kiro/AWS Q Developer ServiceQuotaExceededException).
  // Reason text "MONTHLY_REQUEST_COUNT" + user-facing "You have reached the limit"
  // — both lock the WHOLE account for ~30 days until next billing cycle.
  { text: "monthly_request_count",     cooldownMs: COOLDOWN.monthly, accountLock: true },
  { text: "reached the limit",         cooldownMs: COOLDOWN.monthly, accountLock: true },
  { text: "servicequotaexceeded",      cooldownMs: COOLDOWN.monthly, accountLock: true },
  // Deterministic upstream "model deleted/renamed" errors. Google/Anthropic both
  // return 404 NOT_FOUND when the model id no longer exists. Retrying through
  // other accounts is guaranteed to fail the same way — burn no further accounts,
  // surface the error directly to the user. Model-locked for 30min so any retry
  // burst won't repeat the same dance.
  { text: "requested entity was not found", shouldFallback: false, cooldownMs: 30 * 60 * 1000 },
  { text: "404 page not found",             shouldFallback: false, cooldownMs: 30 * 60 * 1000 },
  { text: "not_found",                      shouldFallback: false, cooldownMs: 30 * 60 * 1000 },
  { text: "model_not_found",                shouldFallback: false, cooldownMs: 30 * 60 * 1000 },
  { text: "the model `",                    shouldFallback: false, cooldownMs: 30 * 60 * 1000 }, // OpenAI shape: "The model `x` does not exist"
  // 0.5.94 — Input-size errors. The REQUEST is the problem, not the account.
  // Fanning out through other accounts is guaranteed to hit the same limit and
  // burn every credential in the pool. Surface the 400 to the caller immediately
  // and DON'T lock the account (cooldownMs:0) — a smaller next request should
  // work fine on the same account. Reported: Kiro returning
  //   {"message":"Input content length exceeds threshold.",
  //    "reason":"CONTENT_LENGTH_EXCEEDS_THRESHOLD"}
  // which was burning all 5 accounts on every oversize prompt.
  { text: "content_length_exceeds_threshold", shouldFallback: false, cooldownMs: 0 },
  { text: "input content length exceeds",     shouldFallback: false, cooldownMs: 0 },
  { text: "context length exceeded",          shouldFallback: false, cooldownMs: 0 },
  { text: "maximum context length",           shouldFallback: false, cooldownMs: 0 },
  { text: "prompt is too long",               shouldFallback: false, cooldownMs: 0 },
  { text: "input is too long",                shouldFallback: false, cooldownMs: 0 },
  { text: "request too large",                shouldFallback: false, cooldownMs: 0 },
  { text: "payload too large",                shouldFallback: false, cooldownMs: 0 },
  { text: "tokens exceeds",                   shouldFallback: false, cooldownMs: 0 },
  { text: "too many tokens",                  shouldFallback: false, cooldownMs: 0 },
  { text: "rate limit",                backoff: true },
  { text: "too many requests",         backoff: true },
  { text: "quota exceeded",            backoff: true },
  // 503 Capacity unavailable. If one account says Google is out of capacity
  // for a specific model, hitting other accounts won't magically spawn GPUs.
  // Don't fan out, don't lock the account. Just cooldown the model.
  { text: "no capacity available",     shouldFallback: false, cooldownMs: COOLDOWN.short },
  { text: "capacity",                  backoff: true },
  { text: "overloaded",                backoff: true },

  // --- Status-based rules (fallback when text doesn't match) ---
  { status: 401, cooldownMs: COOLDOWN.long },
  { status: 402, cooldownMs: COOLDOWN.long },
  { status: 403, cooldownMs: COOLDOWN.long },
  { status: 404, cooldownMs: COOLDOWN.long },
  { status: 429, backoff: true },
];

// Backward compat: COOLDOWN_MS object (used by index.js re-export)
export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};
