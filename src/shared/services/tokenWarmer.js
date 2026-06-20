// Token warmer: proactively refreshes OAuth tokens BEFORE they expire so a
// real user request never waits 1-3 seconds for a token-refresh round-trip
// while the spinner is spinning.
//
// Without this, the flow on a 5h-OAuth provider looks like:
//   t=0:00   user logs in, token expires at t=1:00
//   t=0:59   user sends a chat → request goes through fast
//   t=1:01   user sends a chat → token is expired → kRouter refreshes
//            mid-request (~1-3s) → THEN forwards → user sees a "freeze"
// With this warmer:
//   t=0:55   warmer wakes up, sees token expires in <10min, refreshes
//   t=1:01   user sends a chat → token is fresh → instant forward
//
// The warmer respects per-connection skip flags (disabled_reason,
// modelLock___all from the account-lock fix) so we never waste refresh
// calls on accounts that need human verification.

import "open-sse/index.js";

import { getProviderConnections } from "@/lib/localDb";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

// 60s tick — small enough to catch tokens about to expire, large enough that
// a typical 60-min token only triggers ~6 ticks per token cycle and the
// "needs refresh now" check skips 5 of them.
const TICK_INTERVAL_MS = 60_000;
// Refresh when remaining lifetime is below this. 10 min gives a comfortable
// safety margin even for accounts in the middle of a long-running stream.
const REFRESH_AHEAD_MS = 10 * 60 * 1000;
// Don't re-warm the same connection more than once per 5 minutes regardless
// of expiry — prevents accidental hot loops if a provider hands back a token
// with a wrong/zero expiresAt.
const MIN_GAP_PER_CONN_MS = 5 * 60 * 1000;

const g = (global.__krouterTokenWarmer ??= {
  interval: null,
  lastRefreshedAt: new Map(), // connectionId -> ms epoch
});

function shouldWarmConnection(conn, nowMs) {
  // Only OAuth providers carry refreshable tokens.
  if (conn.authType !== "oauth") return false;
  // Skip disabled connections — user toggled inactive.
  if (conn.isActive === false) return false;
  // Skip accounts that the per-account verify-lock has knocked out — a refresh
  // would succeed but the account itself needs human action (clicking Google's
  // verify link). Don't burn the call.
  if (typeof conn.modelLock___all === "string") {
    const until = new Date(conn.modelLock___all).getTime();
    if (until > nowMs) return false;
  }
  // Some providers store disabled_reason (out_of_credits, account_suspended).
  // No point refreshing an account that's billed-out.
  const psd = conn.providerSpecificData || {};
  if (psd.disabled_reason || psd.disabledReason) return false;

  // Need a refresh token to refresh.
  if (!conn.refreshToken) return false;

  // Need a known expiry to decide if it's worth refreshing.
  const expiresAt = conn.expiresAt || conn.tokenExpiresAt;
  if (!expiresAt) return false;

  let expiresAtMs;
  try {
    expiresAtMs = typeof expiresAt === "number" ? expiresAt : new Date(expiresAt).getTime();
  } catch {
    return false;
  }
  if (!Number.isFinite(expiresAtMs)) return false;

  const remaining = expiresAtMs - nowMs;
  // Already expired? Yes, refresh — the next user request would have anyway.
  // About to expire? Yes, refresh proactively.
  if (remaining > REFRESH_AHEAD_MS) return false;

  // Hot-loop guard: did we just refresh this connection?
  const last = g.lastRefreshedAt.get(conn.id);
  if (last && nowMs - last < MIN_GAP_PER_CONN_MS) return false;

  return true;
}

async function tick() {
  let nowMs = Date.now();
  let connections;
  try {
    connections = await getProviderConnections();
  } catch {
    return;
  }
  if (!Array.isArray(connections) || connections.length === 0) return;

  const due = connections.filter((c) => shouldWarmConnection(c, nowMs));
  if (due.length === 0) return;

  // Warm in parallel; failures are tolerated — the next real user request
  // will still try refresh on its own.
  await Promise.all(
    due.map(async (conn) => {
      g.lastRefreshedAt.set(conn.id, Date.now());
      try {
        const proxyOptions = await resolveConnectionProxyConfig(conn).catch(() => null);
        await refreshAndUpdateCredentials(conn, false, proxyOptions);
      } catch {
        // Silent — the warmer is best-effort. Real user-facing refresh path
        // will surface any genuine failure with its own log line.
      }
    })
  );
}

export function startTokenWarmer() {
  if (g.interval) return;
  g.interval = setInterval(() => {
    tick().catch(() => {});
  }, TICK_INTERVAL_MS);
  if (g.interval.unref) g.interval.unref();
  // Run once a few seconds after boot so the warmer doesn't wait a whole
  // tick interval for the first round — covers the case where a token
  // expired while the dev server was down.
  setTimeout(() => { tick().catch(() => {}); }, 5_000);
}

export function stopTokenWarmer() {
  if (g.interval) {
    clearInterval(g.interval);
    g.interval = null;
  }
}
