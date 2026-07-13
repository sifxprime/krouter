import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { extractThinking } = require("../../src/mitm/handlers/kiro.js");

// 0.5.101 — Regression: extractThinking was dropping the recursive thinking
// payload, so multiple <thinking> blocks in a single chunk lost all but the
// first. Surfaced via codebase-memory unguarded_recursion audit.
describe("kiro extractThinking", () => {
  it("returns null/null for empty input", () => {
    expect(extractThinking("", { inThink: false, thinkBuf: "" })).toEqual({ thinking: null, text: null });
  });

  it("passes plain text through untouched", () => {
    const r = extractThinking("just some text", { inThink: false, thinkBuf: "" });
    expect(r.thinking).toBeNull();
    expect(r.text).toBe("just some text");
  });

  it("extracts a single thinking block and keeps surrounding text", () => {
    const r = extractThinking("before<thinking>reasoning</thinking>after", { inThink: false, thinkBuf: "" });
    expect(r.thinking).toBe("reasoning");
    expect(r.text).toBe("beforeafter");
  });

  it("captures BOTH thinking blocks when two appear in one chunk (the bug)", () => {
    const r = extractThinking(
      "<thinking>first reasoning</thinking>hello<thinking>second reasoning</thinking>world",
      { inThink: false, thinkBuf: "" },
    );
    expect(r.thinking).toContain("first reasoning");
    expect(r.thinking).toContain("second reasoning");
    expect(r.text).toBe("helloworld");
  });

  it("handles <think> short-tag variant", () => {
    const r = extractThinking("a<think>x</think>b", { inThink: false, thinkBuf: "" });
    expect(r.thinking).toBe("x");
    expect(r.text).toBe("ab");
  });

  it("buffers an unclosed opening tag for the next chunk", () => {
    const state = { inThink: false, thinkBuf: "" };
    const r = extractThinking("visible<thinking>partial reasoning", state);
    expect(r.text).toBe("visible");
    expect(state.inThink).toBe(true);
    expect(state.thinkBuf).toContain("partial reasoning");
  });
});
