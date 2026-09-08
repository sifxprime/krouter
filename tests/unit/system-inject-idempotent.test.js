/**
 * Injecting the same persona twice used to append it twice — doubling the prompt
 * and billing the user for it, in a feature whose purpose is saving tokens.
 *
 * Not reachable today (chatCore refuses Caveman and Ponytail together, and the
 * credential-refresh retry reuses the already-injected body), so this closes a
 * latent footgun rather than a live bug. Upstream cadef6c4 fixes the same class,
 * but for a naive OpenAI-only injector we never had — ours is already format-aware.
 */
import { describe, expect, it } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const PROMPT = "CAVEMAN RULES: short words only";
const count = (body) => (JSON.stringify(body).match(/CAVEMAN RULES/g) || []).length;

describe("system prompt injection is idempotent", () => {
  it("openai chat shape", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);
    const once = JSON.stringify(body);
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);
    expect(count(body)).toBe(1);
    expect(JSON.stringify(body)).toBe(once);
  });

  it("claude shape", () => {
    const body = { system: "base", messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT);
    injectSystemPrompt(body, FORMATS.CLAUDE, PROMPT);
    expect(count(body)).toBe(1);
  });

  it("gemini shape", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    injectSystemPrompt(body, FORMATS.GEMINI, PROMPT);
    injectSystemPrompt(body, FORMATS.GEMINI, PROMPT);
    expect(count(body)).toBe(1);
  });

  it("still injects the first time on every shape", () => {
    for (const [fmt, body] of [
      [FORMATS.OPENAI, { messages: [{ role: "user", content: "hi" }] }],
      [FORMATS.CLAUDE, { system: "base", messages: [{ role: "user", content: "hi" }] }],
      [FORMATS.GEMINI, { contents: [{ role: "user", parts: [{ text: "hi" }] }] }],
    ]) {
      injectSystemPrompt(body, fmt, PROMPT);
      expect(count(body), String(fmt)).toBe(1);
    }
  });

  it("a different persona still injects alongside the first", () => {
    // Dedup must key on the prompt, not on "something was already injected".
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);
    injectSystemPrompt(body, FORMATS.OPENAI, "PONYTAIL RULES: minimal code");
    const json = JSON.stringify(body);
    expect(json).toContain("CAVEMAN RULES");
    expect(json).toContain("PONYTAIL RULES");
  });
});
