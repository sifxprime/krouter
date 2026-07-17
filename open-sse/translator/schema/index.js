// 0.5.117 (upstream 706e6513) — minimal shared schema constants.
//
// Upstream keeps a full schema/ subsystem (roles/blocks/defaults). This fork
// only needs the three constants the direct claude:kiro translators reference,
// so they live here verbatim rather than porting the whole subsystem. Values
// mirror upstream's schema/{roles,blocks,defaults}.js exactly.

export const ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
  SYSTEM: "system",
  DEVELOPER: "developer",
};

export const CLAUDE_BLOCK = {
  TEXT: "text",
  IMAGE: "image",
  DOCUMENT: "document",
  TOOL_USE: "tool_use",
  TOOL_RESULT: "tool_result",
  THINKING: "thinking",
  REDACTED_THINKING: "redacted_thinking",
};

export const DEFAULT_IMAGE_MIME = "image/png";
