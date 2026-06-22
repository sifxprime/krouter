// toolLimitDetector (0.5.30)
//
// Automatically recover from "too many tools" or "tool schema too large"
// errors. When an upstream model (especially DeepSeek or smaller OSS models)
// rejects a request because the tools block is too big, this module strips
// non-essential tools and retries.

const TOOL_ERROR_KEYWORDS = [
  "too many tools",
  "tool count exceeds",
  "tools array too large",
  "schema too large",
  "maximum number of tools",
  "function declarations exceed",
];

// High-confidence check if a 400 error is caused by the tools array size
export function isToolLimitError(status, errorBody) {
  if (status !== 400) return false;
  if (!errorBody || typeof errorBody !== "string") return false;
  const lower = errorBody.toLowerCase();
  return TOOL_ERROR_KEYWORDS.some(kw => lower.includes(kw));
}

// Strip non-essential tools from the request.
// Preserves core C‍laude Code / C‍ursor tools (bash, read, edit, etc.) while
// dropping niche MCP tools if we have to fit under a limit.
export function stripNonEssentialTools(body) {
  if (!body || !Array.isArray(body.tools) || body.tools.length === 0) return body;

  const CORE_TOOLS = new Set([
    "bash",
    "str_replace_editor",
    "read_file",
    "edit",
    "run_terminal_cmd",
    "list_dir",
    "grep",
    "file_search",
  ]);

  const strippedTools = body.tools.filter(t => {
    const name = t?.function?.name || t?.name;
    if (!name) return false;
    // Keep core tools
    if (CORE_TOOLS.has(name)) return true;
    // Drop known heavy MCP tools if we are trying to recover
    if (name.includes("mcp__") || name.startsWith("github_")) return false;
    // Keep others by default (might just be standard agent tools)
    return true;
  });

  return { ...body, tools: strippedTools };
}
