import { describe, it, expect } from "vitest";
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

describe("v0.5.114 GitHub Copilot /v1/messages for Claude", () => {
  const ex = new GithubExecutor();

  it("detects Claude models by name (catches live-catalog variants)", () => {
    expect(ex.isClaudeModel("claude-opus-4.8")).toBe(true);
    expect(ex.isClaudeModel("claude-sonnet-4.5")).toBe(true);
    expect(ex.isClaudeModel("gpt-5.4")).toBe(false);
    expect(ex.isClaudeModel("gemini-2.5-pro")).toBe(false);
    expect(ex.isClaudeModel("grok-4")).toBe(false);
    expect(ex.isClaudeModel("")).toBe(false);
    expect(ex.isClaudeModel(null)).toBe(false);
  });

  it("config exposes the messages shim url", () => {
    expect(PROVIDERS.github.messagesUrl).toBe("https://api.githubcopilot.com/v1/messages");
  });

  it("buildHeaders carries anthropic-version (required by /v1/messages)", () => {
    const h = ex.buildHeaders({ apiKey: "tok" }, true);
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(h.Accept).toBe("text/event-stream");
  });

  it("executeWithMessagesEndpoint exists and is wired into execute()", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("open-sse/executors/github.js", "utf8");
    expect(src).toMatch(/if \(this\.isClaudeModel\(model\)\)\s*\{[\s\S]*?executeWithMessagesEndpoint/);
    // translateResponse is (targetFormat=PROVIDER, sourceFormat=CLIENT): the shim
    // returns CLAUDE to an OPENAI client, so this must be (CLAUDE, OPENAI).
    expect(src).toMatch(/translateResponse\(FORMATS\.CLAUDE, FORMATS\.OPENAI, parsed, state\)/);
    // Request translation is (source, target) = (OPENAI, CLAUDE).
    expect(src).toMatch(/translateRequest\(FORMATS\.OPENAI, FORMATS\.CLAUDE, model, body, true/);
  });
});
