import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";

const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  requireLogin: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  enableObservability: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  dnsToolEnabled: {},
  rtkEnabled: true,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  // 0.5.115 (upstream b55cf36d + f1f9d270 + 74d5fedf) — Headroom: optional
  // external Python proxy (pip install headroom) that compresses conversation
  // context. Off by default; fail-open when the proxy isn't running.
  headroomEnabled: false,
  headroomUrl: "http://localhost:8787",
  headroomCompressUserMessages: false,
  // 0.5.111 (upstream dcf1927f) — PXPIPE: render bulky Claude context as dense
  // PNGs via the lazily-installed pxpipe-proxy library. Off by default; the
  // package installs on demand into the data dir (never bundled).
  pxpipeEnabled: false,
  pxpipeAutoInstall: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
  // Model families PXPIPE may image. The package defaults to claude-fable-5
  // ONLY, so without this the feature never fires for real traffic. Limited to
  // vision-capable Claude-family bases (imaging needs a model that reads images).
  pxpipeModels: ["claude-fable-5", "claude-opus-4", "claude-sonnet-4", "claude-haiku-4"],
  responseCacheEnabled: false,
  responseCacheTtlSec: 300,
  // 0.5.28 — emergency fallback redirect on 402 / budget exhaustion
  emergencyFallbackEnabled: false,
  emergencyFallbackProvider: "nvidia",
  emergencyFallbackModel: "openai/gpt-oss-120b",
  emergencyFallbackSkipForTools: true,
  // 0.5.33 — cache-control preservation mode for Claude-shape upstreams.
  //   "auto"   = (default) skip mutations only in Claude direct passthrough
  //              (clientTool === "claude" && provider === "claude"). Other
  //              translation paths still apply prepareClaudeRequest as before.
  //   "always" = paranoid mode. Skip cache_control mutations everywhere a
  //              Claude-shape request flows through, including the explicit
  //              translator path (prepareClaudeRequest preserveCacheControl).
  //              Use when routing through `anthropic-compatible-cc-*` resellers
  //              or any upstream you want byte-stable.
  //   "never"  = legacy behaviour from before 0.5.32. Always strip and rewrite
  //              cache_control. Available as an escape hatch if a future
  //              upstream rejects ttl="1h" markers we want to remove.
  cacheControlMode: "auto",
};

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? parseJson(row.data, {}) : {};
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        merged[key] = true;
      } else {
        merged[key] = defVal;
      }
    }
  }
  return merged;
}

export async function getSettings() {
  const raw = await readRaw();
  return mergeWithDefaults(raw);
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    next = { ...current, ...updates };
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
  return mergeWithDefaults(next);
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

export async function exportSettings() {
  return await readRaw();
}
