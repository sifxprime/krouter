import { describe, it, expect } from "vitest";
import { selectAnthropicBeta } from "../../open-sse/config/providers.js";

describe("0.5.123 13ed1456 — per-model anthropic-beta (replaces the leaking global cache)", () => {
  const HEAVY = ["advanced-tool-use-2025-11-20", "effort-2025-11-24"];
  const BASE_SAMPLE = ["claude-code-20250219", "oauth-2025-04-20", "interleaved-thinking-2025-05-14"];

  it("opus/sonnet get the heavy-agent flags", () => {
    for (const m of ["claude-opus-4-8", "claude-sonnet-4-6", "cc/claude-opus-4-6"]) {
      const beta = selectAnthropicBeta(m);
      for (const f of HEAVY) expect(beta).toContain(f);
    }
  });

  it("haiku / fable / unknown do NOT get heavy-agent flags", () => {
    for (const m of ["claude-haiku-4-5", "claude-fable-5", "gpt-4o", ""]) {
      const beta = selectAnthropicBeta(m);
      for (const f of HEAVY) expect(beta).not.toContain(f);
    }
  });

  it("every model still gets the base flags", () => {
    for (const m of ["claude-opus-4-8", "claude-haiku-4-5"]) {
      const beta = selectAnthropicBeta(m);
      for (const f of BASE_SAMPLE) expect(beta).toContain(f);
    }
  });

  it("is a pure function of the model — no shared/global state to leak across calls", () => {
    // The whole point of the fix: two different callers never affect each other.
    const a = selectAnthropicBeta("claude-opus-4-8");
    const b = selectAnthropicBeta("claude-haiku-4-5");
    expect(a).not.toBe(b);
    expect(selectAnthropicBeta("claude-opus-4-8")).toBe(a); // deterministic
  });
});
