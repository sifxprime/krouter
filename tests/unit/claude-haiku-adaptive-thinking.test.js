// normalizeClaudePassthrough() downgraded thinking.type "adaptive" to
// enabled/budget_tokens for every id matching /haiku/i. That is right for Haiku 3.x/4.x,
// which reject adaptive — but Haiku 5.5 accepts ONLY adaptive, so the downgrade made
// Anthropic answer 400 "thinking.type.enabled is not supported for this model".
// `claude-haiku-5-5` is in the catalog (config/providerModels.js), so this was reachable
// for any client sending thinking on the Claude passthrough. Upstream 0ad0a722, #5183.
import { describe, expect, it } from "vitest";
import { normalizeClaudePassthrough } from "../../open-sse/translator/helpers/claudeHelper.js";

const adaptive = () => ({
  model: "x",
  messages: [{ role: "user", content: "hi" }],
  thinking: { type: "adaptive" },
});

describe("Haiku 5+ keeps adaptive thinking", () => {
  // The id shape the catalog actually ships.
  it("leaves claude-haiku-5-5 alone", () => {
    const body = normalizeClaudePassthrough(adaptive(), "claude-haiku-5-5");
    expect(body.thinking).toEqual({ type: "adaptive" });
  });

  it("leaves a dotted, prefixed and date-suffixed Haiku 5 alone", () => {
    for (const model of [
      "claude-haiku-5.5",
      "anthropic/claude-haiku-5-5",
      "claude-haiku-5-5-20251001",
      "claude-5.5-haiku",
    ]) {
      const body = normalizeClaudePassthrough(adaptive(), model);
      expect(body.thinking, model).toEqual({ type: "adaptive" });
    }
  });

  // The regression guard: whatever Anthropic ships next must not be downgraded either.
  it("leaves a future haiku-6 alone", () => {
    const body = normalizeClaudePassthrough(adaptive(), "claude-haiku-6");
    expect(body.thinking).toEqual({ type: "adaptive" });
  });
});

describe("Haiku below 5 still gets the downgrade", () => {
  it("downgrades every pre-5 id shape in the registries", () => {
    for (const model of [
      "claude-haiku-4-5",
      "claude-haiku-4.5",
      "claude-4.5-haiku",
      "claude-3-5-haiku-20241022",
      "claude-3-haiku-20240307",
      "github/claude-haiku-4-5",
    ]) {
      const body = normalizeClaudePassthrough(adaptive(), model);
      expect(body.thinking, model).toEqual({ type: "enabled", budget_tokens: 10000 });
    }
  });

  // A date suffix must not be read as the version: claude-3-5-haiku-20241022 is
  // version 3, not 20241022, and 20241022 >= 5 would have kept adaptive.
  it("does not read a date suffix as the version", () => {
    const body = normalizeClaudePassthrough(adaptive(), "claude-haiku-3-5-20241022");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
  });

  // No version to read means no basis to keep adaptive, so stay with the old behaviour.
  it("downgrades an unversioned haiku", () => {
    const body = normalizeClaudePassthrough(adaptive(), "haiku");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
  });
});

describe("non-Haiku models are untouched", () => {
  it("keeps adaptive for Sonnet, Opus and an empty model", () => {
    for (const model of ["claude-sonnet-4-6", "claude-opus-4-5", ""]) {
      const body = normalizeClaudePassthrough(adaptive(), model);
      expect(body.thinking, model).toEqual({ type: "adaptive" });
    }
  });

  it("leaves a non-adaptive thinking shape alone on a pre-5 Haiku", () => {
    const body = normalizeClaudePassthrough(
      { model: "x", messages: [], thinking: { type: "enabled", budget_tokens: 2048 } },
      "claude-haiku-4-5",
    );
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
  });
});
