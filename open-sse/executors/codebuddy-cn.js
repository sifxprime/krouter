// 0.5.109 (upstream efd20be8) — CodeBuddy CN (Tencent) executor.
import { DefaultExecutor } from "./default.js";

const DEFAULT_REASONING_EFFORT = "medium";
// The gateway has no "none" tier — asking for it is an error, so we omit the
// param entirely and let CodeBuddy fall back to its own default.
const REASONING_OFF_VALUES = new Set(["none", "off"]);

/**
 * CodeBuddyExecutor — https://copilot.tencent.com/v2/chat/completions
 *
 * Two gateway quirks this exists to absorb:
 *
 * 1. Non-stream requests are rejected outright (HTTP 400, code 11101
 *    "Non-stream chat request is currently not supported"). The same-format
 *    openai->openai translator path passes body.stream through untouched, so a
 *    non-streaming client would fail. We force stream:true; kRouter still
 *    re-aggregates the SSE back into a single JSON response for those clients.
 *
 * 2. Reasoning only surfaces when the request carries the CLI's OpenAI-style
 *    params (reasoning_effort + reasoning_summary:"auto"). Our thinking
 *    pipeline sets reasoning_effort only on explicit client request and never
 *    sets reasoning_summary, so reasoning would silently never appear.
 */
export class CodeBuddyExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-cn");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    const effort = transformed.reasoning_effort;
    if (REASONING_OFF_VALUES.has(effort)) {
      delete transformed.reasoning_effort;
    } else {
      if (!effort) transformed.reasoning_effort = DEFAULT_REASONING_EFFORT;
      transformed.reasoning_summary = "auto";
    }
    return transformed;
  }
}

export default CodeBuddyExecutor;
