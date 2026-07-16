// Quota auto-ping scheduler (0.5.105, generalizes the 0.5.x Claude-only version).
//
// Warms a provider's 5h window by sending a tiny request around reset so the
// user's next real request starts on a fresh window instead of a half-spent one.
//
// Two providers, two window models:
//   - Claude: window resets at a FIXED resetAt. We ping once, just after the
//     window flips (now >= resetAt - pingLeadMs). Adapted from upstream
//     740093d + 79df34c.
//   - Codex: the 5h window only STARTS after a completed response, and its
//     resetAt slides forward while the account is idle. So we ping when the
//     window looks inactive (resetAt drifted since we last saw it) to kick a
//     fresh window off. Ported from upstream b66b5c68 (quotaAutoPing).
//
// Public entry `startClaudeAutoPing` is kept (initializeApp imports it) as a
// thin alias so nothing else has to change.
import "open-sse/index.js";

import { getSettings, getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { getClaudeUsage, getCodexUsage } from "open-sse/services/usage.js";
import { CLAUDE_CLI_SPOOF_HEADERS } from "open-sse/config/providers.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { CLAUDE_AUTOPING_CONFIG, CODEX_AUTOPING_CONFIG } from "@/shared/constants/config";

const CLAUDE_PING_URL = "https://api.anthropic.com/v1/messages?beta=true";
const DISABLED_RECHECK_MS = 3600000;

const g = (global.__quotaAutoPing ??= {
  interval: null,
  running: false,
  resetCache: {},          // key `${provider}:${connId}` -> last-seen resetAt
  disabledUntil: {},       // claude only — billing-disabled skip window
  loggedDisabledReason: {},
});

function cacheKey(provider, id) { return `${provider}:${id}`; }

function buildProxyOptions(cfg) {
  return {
    connectionProxyEnabled: cfg.connectionProxyEnabled === true,
    connectionProxyUrl: cfg.connectionProxyUrl || "",
    connectionNoProxy: cfg.connectionNoProxy || "",
    vercelRelayUrl: cfg.vercelRelayUrl || "",
    strictProxy: false,
  };
}

// ── Claude ping (fixed reset) ─────────────────────────────────────────────
async function sendClaudePing(connection, cfg, proxyOptions) {
  const res = await proxyAwareFetch(CLAUDE_PING_URL, {
    method: "POST",
    headers: {
      ...CLAUDE_CLI_SPOOF_HEADERS,
      "Authorization": `Bearer ${connection.accessToken}`,
      "content-type": "application/json",
      "x-request-source": "local",
    },
    body: JSON.stringify({
      model: cfg.pingModel,
      max_tokens: cfg.pingMaxTokens,
      messages: [{ role: "user", content: cfg.pingText }],
    }),
  }, proxyOptions);
  return res.ok;
}

// Claude: only ping right after the fixed window flips.
function claudeShouldPing(cachedReset, resetAt, now, cfg) {
  const resetMs = new Date(resetAt).getTime();
  return now >= resetMs - cfg.pingLeadMs;
}

// ── Codex ping (sliding window) ───────────────────────────────────────────
function buildCodexPingInput(text) {
  return [{ type: "message", role: "user", content: [{ type: "input_text", text }] }];
}

async function drainResponseBody(response) {
  if (typeof response?.text === "function") { await response.text(); return; }
  const reader = response?.body?.getReader?.();
  if (!reader) return;
  try {
    for (;;) { const { done } = await reader.read(); if (done) return; }
  } finally { reader.releaseLock?.(); }
}

async function sendCodexPing(connection, cfg, proxyOptions) {
  const executor = getExecutor("codex");
  const { response } = await executor.execute({
    model: cfg.pingModel,
    stream: true,
    credentials: {
      accessToken: connection.accessToken,
      connectionId: connection.id,
      providerSpecificData: connection.providerSpecificData,
    },
    proxyOptions,
    log: console,
    body: {
      model: cfg.pingModel,
      input: buildCodexPingInput(cfg.pingText),
      store: false,
      stream: true,
    },
  });
  if (!response?.ok) {
    try { await response?.body?.cancel?.(); } catch { /* noop */ }
    return false;
  }
  // Codex only starts the 5h window once the streaming response completes.
  await drainResponseBody(response);
  return true;
}

// Codex: window is inactive when resetAt drifts forward vs the last value we
// saw. Ping to kick a fresh window off. First observation (no cachedReset)
// also pings so an idle account gets warmed.
function codexShouldPing(cachedReset, resetAt, now, cfg) {
  if (!cachedReset) return true;
  return new Date(resetAt).getTime() !== new Date(cachedReset).getTime();
}

// ── Provider handler table ────────────────────────────────────────────────
const HANDLERS = {
  claude: {
    provider: "claude",
    config: CLAUDE_AUTOPING_CONFIG,
    getUsage: getClaudeUsage,
    sendPing: sendClaudePing,
    shouldPing: claudeShouldPing,
    checksDisabled: true,
  },
  codex: {
    provider: "codex",
    config: CODEX_AUTOPING_CONFIG,
    getUsage: getCodexUsage,
    sendPing: sendCodexPing,
    shouldPing: codexShouldPing,
    checksDisabled: false,
  },
};

async function pingConnection(handler, conn) {
  const { provider, config: cfg } = handler;
  const key = cacheKey(provider, conn.id);

  if (handler.checksDisabled) {
    const disabledUntil = g.disabledUntil[key];
    if (disabledUntil && Date.now() < disabledUntil) return;
  }

  const cachedReset = g.resetCache[key];
  // Claude: cached reset is stable for the whole 5h window; skip usage poll
  // until near reset. Codex: resetAt slides, so re-poll every tick.
  if (provider === "claude" && cachedReset && Date.now() < new Date(cachedReset).getTime() - cfg.refreshAheadMs) return;

  const proxyCfg = await resolveConnectionProxyConfig(conn.providerSpecificData);
  const proxyOptions = buildProxyOptions(proxyCfg);

  let connection = conn;
  try {
    const r = await refreshAndUpdateCredentials(connection, false, proxyOptions);
    connection = r.connection;
  } catch (e) {
    console.warn(`[AutoPing] ${provider}:${conn.id}: refresh failed: ${e.message}`);
    return;
  }

  const usage = await handler.getUsage(connection.accessToken, proxyOptions);

  if (handler.checksDisabled) {
    const disabledReason = usage?.extraUsage?.disabled_reason;
    if (disabledReason) {
      g.disabledUntil[key] = Date.now() + DISABLED_RECHECK_MS;
      if (g.loggedDisabledReason[key] !== disabledReason) {
        console.warn(`[AutoPing] ${provider}:${conn.id}: skipping — disabled_reason="${disabledReason}". Re-check in ${DISABLED_RECHECK_MS / 60000}m.`);
        g.loggedDisabledReason[key] = disabledReason;
      }
      return;
    } else if (g.loggedDisabledReason[key]) {
      console.log(`[AutoPing] ${provider}:${conn.id}: account recovered — auto-ping resumed.`);
      delete g.loggedDisabledReason[key];
      delete g.disabledUntil[key];
    }
  }

  const resetAt = usage?.quotas?.[cfg.fiveHourKey]?.resetAt;
  if (!resetAt) return;

  const now = Date.now();
  if (!handler.shouldPing(cachedReset, resetAt, now, cfg)) {
    g.resetCache[key] = resetAt;
    return;
  }
  if (connection.lastPingedResetAt === resetAt) { g.resetCache[key] = resetAt; return; }

  const ok = await handler.sendPing(connection, cfg, proxyOptions);
  g.resetCache[key] = resetAt;
  await updateProviderConnection(connection.id, {
    lastPingedResetAt: resetAt,
    lastPingAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  console.log(`[AutoPing] ${provider}:${connection.id}: ping ${ok ? "sent" : "failed"} (reset ${resetAt})`);
}

async function tickProvider(handler) {
  const settings = await getSettings();
  const enabledMap = settings[handler.config.settingsKey]?.connections || {};
  if (Object.keys(enabledMap).length === 0) return;

  const conns = await getProviderConnections({ provider: handler.provider, isActive: true });
  const targets = conns.filter((c) => c.authType === "oauth" && enabledMap[c.id] === true);
  for (const conn of targets) {
    try { await pingConnection(handler, conn); }
    catch (e) { console.warn(`[AutoPing] ${handler.provider}:${conn.id}: ${e.message}`); }
  }
}

async function tick() {
  if (g.running) return;
  g.running = true;
  try {
    for (const handler of Object.values(HANDLERS)) {
      try { await tickProvider(handler); }
      catch (e) { console.warn(`[AutoPing] ${handler.provider} tick error:`, e.message); }
    }
  } finally {
    g.running = false;
  }
}

export function startQuotaAutoPing() {
  if (g.interval) return;
  // Both configs share the 60s tick interval.
  g.interval = setInterval(() => { tick().catch(() => {}); }, CLAUDE_AUTOPING_CONFIG.tickIntervalMs);
  if (g.interval.unref) g.interval.unref();
}

// Backward-compat alias — initializeApp still calls this name.
export const startClaudeAutoPing = startQuotaAutoPing;
