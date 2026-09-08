/**
 * Antigravity's backend flags competing-client branding in the system prompt and
 * answers 429 Quota Exhausted, so the account looks rate-limited from that client
 * while working fine from another. We already stripped Zed's Claude Agent SDK line;
 * OpenCode's naming went upstream verbatim.
 *
 * The ZWJ obfuscation in services/antigravityObfuscation.js does not cover this:
 * obfuscateBodyStrings is applied to `contents` only, never systemInstruction.
 *
 * Ported from upstream dff64849.
 */
import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_PROMPT_REWRITES } from "../../open-sse/config/appConstants.js";

// Mirrors the executor's loop over systemInstruction.parts.
const rewrite = (text) => {
  let out = text;
  for (const { from, to } of ANTIGRAVITY_PROMPT_REWRITES) out = out.replaceAll(from, to);
  return out;
};

describe("Antigravity system-prompt rewrites", () => {
  it("still strips the Zed Claude Agent SDK line", () => {
    const out = rewrite("Intro. You are a Claude agent, built on Anthropic's Claude Agent SDK. Rest.");
    expect(out).not.toContain("Claude Agent SDK");
    expect(out).toContain("Intro.");
    expect(out).toContain("Rest.");
  });

  it("renames OpenCode branding, preserving casing", () => {
    expect(rewrite("You are OpenCode.")).toBe("You are Antigravity.");
    expect(rewrite("running opencode now")).toBe("running antigravity now");
    expect(rewrite("OPENCODE MODE")).toBe("ANTIGRAVITY MODE");
  });

  it("rewrites every occurrence, not just the first", () => {
    const out = rewrite("OpenCode talks to OpenCode via opencode");
    expect(out).toBe("Antigravity talks to Antigravity via antigravity");
    expect(out.toLowerCase()).not.toContain("opencode");
  });

  it("leaves an unrelated prompt untouched", () => {
    const text = "You are a helpful assistant working on a Rust codebase.";
    expect(rewrite(text)).toBe(text);
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = rewrite("You are OpenCode, built on Anthropic's Claude Agent SDK.");
    expect(rewrite(once)).toBe(once);
  });
});

describe("executor wiring", () => {
  it("applies the rules to systemInstruction, which obfuscation never reaches", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("open-sse/executors/antigravity.js", "utf-8");
    expect(src).toContain("ANTIGRAVITY_PROMPT_REWRITES");
    expect(src).toContain("requestWithoutTools.systemInstruction?.parts");
    // The old single-marker form must be gone, or OpenCode naming still ships.
    expect(src).not.toContain('const marker = "You are a Claude agent');
  });
});
