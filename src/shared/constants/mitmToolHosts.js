/**
 * Per-tool DNS hosts — written to hosts file as 127.0.0.1 when MITM DNS is enabled.
 * Kept in sync with MITM routing; shared by Node (dnsConfig) and dashboard UI.
 */
const TOOL_HOSTS = {
  antigravity: ["daily-cloudcode-pa.googleapis.com", "cloudcode-pa.googleapis.com"],
  copilot: ["api.individual.githubcopilot.com"],
  kiro: ["runtime.us-east-1.kiro.dev", "q.us-east-1.amazonaws.com", "codewhisperer.us-east-1.amazonaws.com"],
  cursor: ["api2.cursor.sh"],
  claude: ["api.anthropic.com"],
};

/**
 * How the MITM tells the router which tool a captured request came from.
 *
 * The MITM rewrites the model before forwarding (an Antigravity `gemini-*` turn
 * becomes whatever alias serves it), so by the time the router records usage the
 * only thing left to attribute by is the serving provider. That is why usage
 * read "kiro: 1 request, 18h ago" while Kiro was being captured on every turn —
 * the requests were real, they were just filed under `claude`. The tool is known
 * at interception time and this header carries it the one hop to the router.
 */
const MITM_TOOL_HEADER = "x-krouter-mitm-tool";

/** The tools the MITM can capture. The hosts map above is the definition. */
const MITM_TOOLS = Object.keys(TOOL_HOSTS);

/**
 * A header value turned into a tool name, or null.
 *
 * The value reaches the router as an ordinary request header, so anything that
 * can talk to /v1/* can set it. Accepting it verbatim would let a caller invent
 * tool buckets; checking it against the known list means the worst a forged
 * header can do is mislabel its own request as one of five existing tools.
 */
function normalizeMitmTool(value) {
  if (typeof value !== "string") return null;
  const tool = value.trim().toLowerCase();
  return MITM_TOOLS.includes(tool) ? tool : null;
}

module.exports = { TOOL_HOSTS, MITM_TOOL_HEADER, MITM_TOOLS, normalizeMitmTool };
