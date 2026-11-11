// All intercepted domains + URL patterns per tool

const fs = require("fs");

const IS_DEV = process.env.NODE_ENV === "development";

// Resolve lsof absolute path — packaged apps / sudo secure_path may strip /usr/sbin from PATH
const LSOF_BIN = (() => {
  if (process.platform === "win32") return null;
  for (const p of ["/usr/sbin/lsof", "/usr/bin/lsof", "/sbin/lsof"]) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* try next */ }
  }
  return "lsof"; // last-resort fallback (depends on PATH)
})();

const TARGET_HOSTS = [
  "daily-cloudcode-pa.googleapis.com",
  "cloudcode-pa.googleapis.com",
  "api.individual.githubcopilot.com",
  "q.us-east-1.amazonaws.com",
  "codewhisperer.us-east-1.amazonaws.com",
  "runtime.us-east-1.kiro.dev",
  "api2.cursor.sh",
  "api.anthropic.com",
];

const URL_PATTERNS = {
  antigravity: [":generateContent", ":streamGenerateContent"],
  copilot: ["/chat/completions", "/v1/messages", "/responses"],
  // Legacy path form. Kiro IDE 1.0.228+ posts to `/` with x-amz-target instead —
  // see isChatRequest() for the header-based match.
  kiro: ["/generateAssistantResponse"],
  cursor: ["/BidiAppend", "/RunSSE", "/RunPoll", "/Run"],
  // /v1/messages is the chat endpoint; /v1/messages/count_tokens is the
  // pre-request token preview Claude Desktop fires before each send.
  // Anything else on api.anthropic.com (OAuth, settings, usage) falls through
  // to passthrough — those still need to reach real Anthropic.
  claude: ["/v1/messages"],
};

/**
 * Whether this request is a chat turn we should intercept (vs passthrough).
 *
 * Kiro Runtime moved GenerateAssistantResponse from the path
 * `/generateAssistantResponse` to `POST /` plus a
 * `x-amz-target: KiroRuntimeService.GenerateAssistantResponse` header in IDE
 * 1.0.228+. Matching on path alone therefore missed every chat turn and silently
 * passed it through to AWS — MITM looked enabled but routed nothing.
 */
function isChatRequest(tool, req) {
  const patterns = URL_PATTERNS[tool] || [];
  if (patterns.some((p) => (req.url || "").includes(p))) return true;
  if (tool === "kiro") {
    const target = String(req.headers?.["x-amz-target"] || "");
    return target.includes("GenerateAssistantResponse");
  }
  return false;
}

// Synonym map: rawModel from request → canonical alias key in mitmAlias DB
// 0.5.166 — repointed at the 3.8 ladder (upstream 24034f69). Google retired the
// 3.5 Flash tiers and gemini-3-flash-agent, but IDE builds in the field still send
// those ids, so the keys stay and the targets move to live models.
const MODEL_SYNONYMS = {
  antigravity: {
    "gemini-default": "gemini-3.8-flash-medium",
    "gemini-3.5-flash-high": "gemini-3.8-flash-high",
    "gemini-3.5-flash-medium": "gemini-3.8-flash-medium",
    "gemini-3.5-flash-low": "gemini-3.8-flash-low",
    "gemini-3.5-flash-extra-low": "gemini-3.8-flash-low",
    "gemini-3.8-flash": "gemini-3.8-flash-medium",
    "gemini-3.1-pro-high": "gemini-pro-agent",
    "gemini-3-pro-high": "gemini-pro-agent",
    "gemini-3-pro-low": "gemini-3.1-pro-low",
  },
};

// Pattern fallback: rawModel regex → canonical alias key (when exact + prefix match fail)
// Order matters: more specific patterns first. Catches AG renamed variants (e.g. gemini-pro-agent)
const MODEL_PATTERNS = {
  antigravity: [
    { match: /flash.*extra.*low|extra.*low.*flash|flash.*low|low.*flash/i, alias: "gemini-3.8-flash-low" },
    { match: /flash.*medium|medium.*flash/i,                       alias: "gemini-3.8-flash-medium" },
    { match: /flash.*agent|agent.*flash|flash/i,                   alias: "gemini-3.8-flash-high" },
    { match: /pro.*low|low.*pro/i,                                 alias: "gemini-3.1-pro-low" },
    { match: /gemini.*pro|pro.*gemini/i,                           alias: "gemini-pro-agent" },
    // 0.5.166 — 5.5 before the 4.6 catch-alls, so an IDE asking for Opus 5.5 does
    // not silently land on Opus 4.6 (upstream 24034f69, a07ed95b).
    { match: /opus.*5[.-]5.*high|5[.-]5.*opus.*high/i,             alias: "claude-opus-5-5-high" },
    { match: /opus.*5[.-]5.*medium|5[.-]5.*opus.*medium/i,         alias: "claude-opus-5-5-medium" },
    { match: /opus.*5[.-]5.*low|5[.-]5.*opus.*low/i,               alias: "claude-opus-5-5-low" },
    { match: /opus.*5[.-]5|5[.-]5.*opus/i,                         alias: "claude-opus-5-5" },
    { match: /sonnet.*5[.-]5.*high|5[.-]5.*sonnet.*high/i,         alias: "claude-sonnet-5-5-high" },
    { match: /sonnet.*5[.-]5.*medium|5[.-]5.*sonnet.*medium/i,     alias: "claude-sonnet-5-5-medium" },
    { match: /sonnet.*5[.-]5.*low|5[.-]5.*sonnet.*low/i,           alias: "claude-sonnet-5-5-low" },
    { match: /sonnet.*5[.-]5|5[.-]5.*sonnet/i,                     alias: "claude-sonnet-5-5" },
    // fallback: a bare family word is a last resort, so it must not outrank a precise
    // prefix match on the model id the IDE actually sent (see modelMap.js).
    { match: /opus/i,                                              alias: "claude-opus-4-6-thinking", fallback: true },
    { match: /sonnet|claude/i,                                     alias: "claude-sonnet-4-6", fallback: true },
    { match: /gpt.*oss|oss/i,                                      alias: "gpt-oss-120b-medium", fallback: true },
  ],
  // 0.5.169 — Claude Desktop had NO ladder at all, so a model id outside the alias
  // map fell past the exact and prefix lookups and PASSED THROUGH to real Anthropic.
  // Verified live: with MITM on and api.anthropic.com redirected to us,
  //   claude-opus-4-7 -> routed through kRouter (served as cc/claude-opus-5)
  //   claude-opus-5-5 -> 401 "invalid x-api-key" FROM ANTHROPIC, request_id req_011Cgvs...
  // The request left the machine and billed the user's own Anthropic account instead
  // of the provider they mapped. Desktop ships a new flagship, the slot list lags, and
  // MITM silently stops intercepting the only models the app actually sends.
  //
  // Each family lists its newest alias key FIRST and older ones after: getMappedModel
  // skips an entry whose alias is absent from the user's map, so someone who mapped
  // only "claude-opus-4-7" still catches Opus 5.5 on that entry, and someone who has
  // mapped the 5.5 slot gets it exactly. Haiku precedes sonnet so "haiku" is not eaten
  // by a broader rule, and the bare /claude/ catch-all is last.
  claude: [
    { match: /opus.*5[.-]5|5[.-]5.*opus/i, alias: "claude-opus-5-5" },
    { match: /opus.*5[.-]5|5[.-]5.*opus/i, alias: "claude-opus-4-7" },
    { match: /opus.*5[.-]5|5[.-]5.*opus/i, alias: "claude-opus-4-6" },
    { match: /sonnet.*5[.-]5|5[.-]5.*sonnet/i, alias: "claude-sonnet-5-5" },
    { match: /sonnet.*5[.-]5|5[.-]5.*sonnet/i, alias: "claude-sonnet-4-6" },
    { match: /sonnet.*5[.-]5|5[.-]5.*sonnet/i, alias: "claude-sonnet-4-5" },
    { match: /haiku/i, alias: "claude-haiku-5-5" },
    { match: /haiku/i, alias: "claude-haiku-4-5" },
    { match: /fable/i, alias: "claude-fable-5-1" },
    { match: /fable/i, alias: "claude-sonnet-4-6" },
    { match: /opus/i, alias: "claude-opus-5-5", fallback: true },
    { match: /opus/i, alias: "claude-opus-4-7", fallback: true },
    { match: /opus/i, alias: "claude-opus-4-6", fallback: true },
    { match: /sonnet/i, alias: "claude-sonnet-5-5", fallback: true },
    { match: /sonnet/i, alias: "claude-sonnet-4-6", fallback: true },
    { match: /sonnet/i, alias: "claude-sonnet-4-5", fallback: true },
    { match: /claude/i, alias: "claude-opus-4-7", fallback: true },
    { match: /claude/i, alias: "claude-sonnet-4-6", fallback: true },
  ],
};

// Models that must NEVER be re-routed — always passthrough to the real upstream, even when
// the tool's other models are mapped. Antigravity's tab-autocomplete (`tab_jump_flash_lite_preview`,
// `tab_flash_lite_preview`, requestType tab/tab_jump) is latency-critical inline completion; routing
// it through kRouter to an external chat model makes typing laggy and burns provider quota per
// keystroke. Without this guard the broad `flash` pattern in MODEL_PATTERNS hijacks them onto the
// flash-agent slot. Verified via MITM dump capture of streamGenerateContent (see AI_JOURNAL).
const MODEL_NO_MAP = {
  antigravity: [/^tab[_-]/i],
};

// URL substrings whose request/response should NOT be dumped to file (telemetry, polling, empty)
const LOG_BLACKLIST_URL_PARTS = [
  "recordCodeAssistMetrics",
  "recordTrajectoryAnalytics",
  "fetchAdminControls",
  "listExperiments",
  "fetchUserInfo",
];

function getToolForHost(host) {
  const h = (host || "").split(":")[0];
  if (h === "api.individual.githubcopilot.com") return "copilot";
  if (h === "daily-cloudcode-pa.googleapis.com" || h === "cloudcode-pa.googleapis.com") return "antigravity";
  if (h === "q.us-east-1.amazonaws.com" || h === "codewhisperer.us-east-1.amazonaws.com" || h === "runtime.us-east-1.kiro.dev") return "kiro";
  if (h === "api2.cursor.sh") return "cursor";
  if (h === "api.anthropic.com") return "claude";
  return null;
}

module.exports = { IS_DEV, LSOF_BIN, TARGET_HOSTS, URL_PATTERNS, MODEL_SYNONYMS, MODEL_PATTERNS, MODEL_NO_MAP, LOG_BLACKLIST_URL_PARTS, getToolForHost, isChatRequest };
