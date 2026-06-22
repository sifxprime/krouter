// Tests for the 3 routing-intelligence modules (0.5.29):
// intentClassifier, complexityRouter, taskAwareRouter.
import { describe, expect, it } from "vitest";
import { classifyPromptIntent, classifyWithConfig, DEFAULT_INTENT_CONFIG } from "../../open-sse/services/intentClassifier.js";
import { classifyRequestComplexity, escalateTier } from "../../open-sse/services/complexityRouter.js";
import { suggestComboForIntent, adviseRouting, buildTaskAwareRoutingMap } from "../../open-sse/services/taskAwareRouter.js";

describe("intentClassifier — classifyPromptIntent", () => {
  it("identifies code prompts (English keywords)", () => {
    expect(classifyPromptIntent("Write a TypeScript function that...")).toBe("code");
    expect(classifyPromptIntent("debug this Python script")).toBe("code");
    expect(classifyPromptIntent("```js\nfunction foo() {}\n```")).toBe("code");
  });

  it("identifies code prompts in other languages", () => {
    // Portuguese
    expect(classifyPromptIntent("Escrever uma função em JavaScript")).toBe("code");
    // Chinese
    expect(classifyPromptIntent("写一个函数")).toBe("code");
  });

  it("identifies creative prompts via explicit creative keyword", () => {
    expect(classifyPromptIntent("Tell a story about robots")).toBe("creative");
  });

  it("returns a deterministic IntentType from the union", () => {
    const valid = new Set(["code", "math", "reasoning", "creative", "simple", "medium"]);
    expect(valid.has(classifyPromptIntent("hello there"))).toBe(true);
    expect(valid.has(classifyPromptIntent("thanks!"))).toBe(true);
    expect(valid.has(classifyPromptIntent("Tell me about photosynthesis"))).toBe(true);
  });
});

describe("intentClassifier — classifyWithConfig", () => {
  it("respects disabled config", () => {
    expect(classifyWithConfig("write code", { enabled: false })).toBe("medium");
  });

  it("respects extra keywords", () => {
    const cfg = { ...DEFAULT_INTENT_CONFIG, extraMathKeywords: ["xyzmath"] };
    expect(classifyWithConfig("solve xyzmath", cfg)).toBe("math");
  });
});

describe("complexityRouter — classifyRequestComplexity", () => {
  it("trivial empty body", () => {
    const r = classifyRequestComplexity({});
    expect(r.score).toBe(0);
    expect(r.level).toBe("trivial");
    expect(r.recommendedTier).toBe("free");
  });

  it("scores up with longer user content", () => {
    const longText = "a".repeat(5000);
    const r = classifyRequestComplexity({ messages: [{ role: "user", content: longText }] });
    expect(r.score).toBeGreaterThan(15);
    expect(["simple", "moderate", "complex"]).toContain(r.level);
  });

  it("escalates to cheap when tools are present (even if prose is short)", () => {
    const r = classifyRequestComplexity({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "fetch" } }],
    });
    expect(r.hasToolUse).toBe(true);
    // tier was free, escalated to cheap
    expect(r.recommendedTier).toBe("cheap");
  });

  it("counts code blocks", () => {
    const c = "Here is code:\n```js\nx\n```\n```py\ny\n```";
    const r = classifyRequestComplexity({ messages: [{ role: "user", content: c }] });
    expect(r.signals.codeBlocks).toBe(2);
  });

  it("escalateTier never demotes", () => {
    expect(escalateTier("premium", "cheap")).toBe("premium");
    expect(escalateTier("free", "cheap")).toBe("cheap");
    expect(escalateTier("cheap", "premium")).toBe("premium");
  });
});

describe("taskAwareRouter — suggestComboForIntent", () => {
  it("returns the first matching combo from default map", () => {
    const avail = new Set(["claude-code", "deepseek"]);
    expect(suggestComboForIntent("code", avail)).toBe("deepseek");
  });

  it("returns null when no candidate is available", () => {
    const avail = new Set(["random-combo"]);
    expect(suggestComboForIntent("code", avail)).toBeNull();
  });

  it("handles array input", () => {
    expect(suggestComboForIntent("code", ["claude-code"])).toBe("claude-code");
  });

  it("returns null for unknown intent", () => {
    expect(suggestComboForIntent("xxx", new Set(["claude-code"]))).toBeNull();
  });

  it("respects custom map", () => {
    const customMap = { code: ["my-special"] };
    expect(suggestComboForIntent("code", new Set(["my-special"]), customMap)).toBe("my-special");
  });
});

describe("taskAwareRouter — buildTaskAwareRoutingMap", () => {
  it("returns default map when no override", () => {
    const m = buildTaskAwareRoutingMap({});
    expect(m.code).toBeDefined();
    expect(Array.isArray(m.code)).toBe(true);
  });

  it("merges user override on top of defaults", () => {
    const m = buildTaskAwareRoutingMap({ taskAwareRouterMap: { code: ["my-combo"] } });
    expect(m.code).toEqual(["my-combo"]);
    // others stay default
    expect(m.creative).toBeDefined();
  });
});

describe("taskAwareRouter — adviseRouting", () => {
  it("reports suggestedCombo when available", () => {
    const r = adviseRouting("code", {}, new Set(["claude-code"]));
    expect(r.intent).toBe("code");
    expect(r.suggestedCombo).toBe("claude-code");
    expect(r.reason).toMatch(/code/);
  });

  it("reports no_match when nothing matches", () => {
    const r = adviseRouting("code", {}, new Set(["random"]));
    expect(r.suggestedCombo).toBeNull();
    expect(r.reason).toBe("no_match");
  });
});
