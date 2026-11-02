// GET /v1/models published context_length 1000000 for oc/deepseek-v4.1-flash-free,
// because the free lane has no static catalog here and the id fell through to the paid
// deepseek-v4.1-flash pattern row. The free backend rejects prompts above ~330k tokens,
// and clients (VS Code Copilot and friends) size their compaction budget from the
// published number — so a long session never compacted and hard-failed mid-run with a
// 400. Upstream 1da5b0d7, #5097.
//
// Note the argument order: getCapabilitiesForModel(provider, model). Getting it
// backwards silently returns DEFAULT_CAPABILITIES, which looks like a safe 200k window
// and hides exactly this bug.
import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const FREE_ID = "deepseek-v4.1-flash-free";
// The limit the free backend enforces. The published window must not exceed it.
const BACKEND_PROMPT_LIMIT = 330000;

describe("oc/deepseek-v4.1-flash-free publishes a window the backend accepts", () => {
  it("caps the context window at the backend limit", () => {
    const caps = getCapabilitiesForModel("opencode", FREE_ID);
    expect(caps.contextWindow).toBeLessThanOrEqual(BACKEND_PROMPT_LIMIT);
  });

  // A max_completion_tokens above the context window is itself rejected.
  it("keeps maxOutput within the context window", () => {
    const caps = getCapabilitiesForModel("opencode", FREE_ID);
    expect(caps.maxOutput).toBeLessThanOrEqual(caps.contextWindow);
  });

  // The cap is a limits fix, not a capability change: anything else moving means the
  // override drifted away from what the id resolved to before.
  it("leaves the model's other capabilities as they were", () => {
    const caps = getCapabilitiesForModel("opencode", FREE_ID);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("deepseek");
    expect(caps.tools).toBe(true);
  });
});

describe("the cap is scoped to the free lane only", () => {
  // The paid id is a different product with a genuine 1M window; capping it would
  // make every paid client compact a million tokens early.
  it("does not touch the paid deepseek-v4.1-flash", () => {
    const caps = getCapabilitiesForModel("deepseek", "deepseek-v4.1-flash");
    expect(caps.contextWindow).toBeGreaterThan(BACKEND_PROMPT_LIMIT);
  });

  it("does not touch the same id on another provider", () => {
    const caps = getCapabilitiesForModel("opencode-go", "deepseek-v4.1-flash");
    expect(caps.contextWindow).toBeGreaterThan(BACKEND_PROMPT_LIMIT);
  });
});
