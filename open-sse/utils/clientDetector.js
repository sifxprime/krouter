/**
 * Detect CLI tool identity from request headers/body.
 * Used to determine if a request can be passed through losslessly.
 */

// Map of CLI tool identifiers to provider IDs they are "native" to
const NATIVE_PAIRS = {
  "claude": ["claude", "anthropic"],
  "gemini-cli": ["gemini-cli"],
  "antigravity": ["antigravity"],
  "codex": ["codex", "openai", "commandcode"],
  // 0.5.65 — Kiro IDE -> Kiro provider. Native passthrough keeps the request
  // body byte-for-byte identical (preserves AWS Bedrock prompt caching) and
  // skips the 500-line openai-to-kiro translator entirely.
  "kiro": ["kiro"],
};

/**
 * Detect which CLI tool is making the request.
 * Returns one of: "claude" | "gemini-cli" | "antigravity" | "codex" | null
 * @param {object} headers - Lowercase header key/value object
 * @param {object} body    - Parsed request body
 */
export function detectClientTool(headers = {}, body = {}) {
  const ua = (headers["user-agent"] || "").toLowerCase();
  const xApp = (headers["x-app"] || "").toLowerCase();
  const openaiIntent = (headers["openai-intent"] || "").toLowerCase();
  const initiator = (headers["x-initiator"] || headers["X-Initiator"] || "").toLowerCase();

  // Antigravity: detected via body field (not header)
  if (body.userAgent === "antigravity") return "antigravity";

  // GitHub Copilot / OAI compatible extension using Copilot chat headers
  if (ua.includes("githubcopilotchat") || openaiIntent === "conversation-panel" || initiator === "user") {
    return "github-copilot";
  }

  // Claude Code / Claude CLI
  if (ua.includes("claude-cli") || ua.includes("claude-code") || xApp === "cli") return "claude";

  // Gemini CLI
  if (ua.includes("gemini-cli")) return "gemini-cli";

  // Codex CLI
  if (ua.includes("codex-cli") || ua.includes("codex/")) return "codex";

  // DeepSeek TUI
  if (ua.includes("deepseek-tui")) return "deepseek-tui";

  // 0.5.65 — Kiro IDE detection. Kiro's desktop app and its CodeWhisperer
  // backend identify themselves with multiple stable signals; checking
  // any one of them is sufficient. We avoid relying on `aws-sdk-` alone
  // because that header also appears on Bedrock SDK clients we don't want
  // to passthrough.
  if (
    ua.includes("kiro") ||
    headers["x-amzn-codewhisperer-source"] === "kiro" ||
    headers["x-amz-target"]?.toLowerCase?.().startsWith("amazoncodewhispererservice.") ||
    body?.userInputMessage !== undefined ||
    body?.conversationState !== undefined
  ) {
    return "kiro";
  }

  return null;
}

/**
 * Check if this CLI tool + provider pair should be passed through losslessly.
 * @param {string|null} clientTool - Result of detectClientTool()
 * @param {string} provider        - Provider ID (e.g. "claude", "gemini-cli")
 */
export function isNativePassthrough(clientTool, provider) {
  if (!clientTool) return false;
  const nativeProviders = NATIVE_PAIRS[clientTool];
  if (!nativeProviders) return false;
  // Support anthropic-compatible-* variants
  const normalizedProvider = provider.startsWith("anthropic-compatible")
    ? "anthropic"
    : provider;
  return nativeProviders.includes(normalizedProvider);
}
