import { describe, it, expect } from "vitest";
import { getClaudeUsage } from "../../open-sse/services/usage.js";

// upstream cd4003bc — several dashboard widgets ask for Claude quota at once;
// without dedup each fired its own upstream request and tripped Anthropic's 429.
// Promise identity is the observable contract: concurrent callers must receive the
// SAME promise, which is only true if the shared one is returned directly (an
// `async` wrapper would hand each caller a distinct wrapper and silently un-dedup).
describe("0.5.143 Claude quota in-flight dedup", () => {
  it("concurrent callers for the same token share one promise", async () => {
    const a = getClaudeUsage("tok-same");
    const b = getClaudeUsage("tok-same");
    const c = getClaudeUsage("tok-same");
    expect(a).toBe(b);
    expect(b).toBe(c);
    await Promise.allSettled([a, b, c]);
  });

  it("different tokens are not shared", async () => {
    const a = getClaudeUsage("tok-A");
    const b = getClaudeUsage("tok-B");
    expect(a).not.toBe(b);
    await Promise.allSettled([a, b]);
  });

  it("the entry is released after settle, so a later call refetches", async () => {
    const first = getClaudeUsage("tok-seq");
    await Promise.allSettled([first]);
    const second = getClaudeUsage("tok-seq");
    expect(second).not.toBe(first);
    await Promise.allSettled([second]);
  });

  it("always returns a promise (callers still await normally)", async () => {
    const p = getClaudeUsage("tok-shape");
    expect(typeof p.then).toBe("function");
    await Promise.allSettled([p]);
  });
});
