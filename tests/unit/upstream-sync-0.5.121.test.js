import { describe, it, expect } from "vitest";
import { UNSUPPORTED_SCHEMA_CONSTRAINTS, cleanJSONSchemaForAntigravity } from "../../open-sse/translator/helpers/geminiHelper.js";
import { hasValidContent } from "../../open-sse/translator/helpers/claudeHelper.js";
import { stripUnsupportedParams } from "../../open-sse/translator/helpers/paramSupport.js";
import { detectClientTool } from "../../open-sse/utils/clientDetector.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("0.5.121 2abe8b85 — Gemini unsupported schema keywords", () => {
  it("blocklists the 6 keywords Gemini has no field for", () => {
    for (const kw of ["multipleOf", "uniqueItems", "contains", "unevaluatedProperties", "unevaluatedItems", "contentSchema"]) {
      expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain(kw);
    }
  });
  it("strips uniqueItems/multipleOf from a real tool schema (was a hard 400)", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { tags: { type: "array", uniqueItems: true, items: { type: "string" } }, n: { type: "number", multipleOf: 2 } },
    });
    const s = JSON.stringify(cleaned);
    expect(s).not.toContain("uniqueItems");
    expect(s).not.toContain("multipleOf");
  });
});

describe("0.5.121 e3e3e235 — empty schema node after $ref strip", () => {
  it("promotes an orphan {} to object + reason placeholder", () => {
    // $ref gets stripped, leaving {} — Vertex/Antigravity reject the empty node.
    const cleaned = cleanJSONSchemaForAntigravity({ type: "object", properties: { x: { $ref: "#/$defs/Foo" } } });
    expect(cleaned.properties.x.type).toBe("object");
    expect(cleaned.properties.x.properties.reason.type).toBe("string");
  });
});

describe("0.5.121 a7941dda — image-only user message is valid content", () => {
  it("keeps an image-only turn", () => {
    expect(hasValidContent({ role: "user", content: [{ type: "image", source: {} }] })).toBe(true);
  });
  it("keeps a document-only turn", () => {
    expect(hasValidContent({ role: "user", content: [{ type: "document", source: {} }] })).toBe(true);
  });
  it("still rejects an empty turn", () => {
    expect(hasValidContent({ role: "user", content: [{ type: "text", text: "  " }] })).toBe(false);
    expect(hasValidContent({ role: "user", content: [] })).toBe(false);
  });
});

describe("0.5.121 9173c29b — strip temperature for ALL Claude models", () => {
  it("strips temperature for claude-sonnet / haiku (not just opus-4)", () => {
    for (const m of ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-opus-4-8"]) {
      const out = stripUnsupportedParams("anthropic", m, { temperature: 0.7, max_tokens: 100 });
      expect(out.temperature).toBeUndefined();
      expect(out.max_tokens).toBe(100); // untouched
    }
  });
  it("leaves a non-Claude model's temperature alone", () => {
    const out = stripUnsupportedParams("openai", "gpt-4o", { temperature: 0.7 });
    expect(out.temperature).toBe(0.7);
  });
});

describe("0.5.121 cd13d904 — detect current Codex clients", () => {
  it("codex-tui UA → codex", () => {
    expect(detectClientTool({ "user-agent": "codex-tui/0.4.1" })).toBe("codex");
  });
  it("Codex Desktop UA → codex", () => {
    expect(detectClientTool({ "user-agent": "Codex Desktop/1.0" })).toBe("codex");
  });
  it("originator codex_work_desktop → codex", () => {
    expect(detectClientTool({ "user-agent": "unknown/1", "originator": "codex_work_desktop" })).toBe("codex");
  });
  it("legacy codex-cli still works", () => {
    expect(detectClientTool({ "user-agent": "codex-cli/2.0" })).toBe("codex");
  });
});

describe("0.5.121 c97963c4 — forward service_tier OpenAI→Responses", () => {
  it("forwards service_tier instead of dropping it", () => {
    const out = openaiToOpenAIResponsesRequest("gpt-5", { messages: [{ role: "user", content: "hi" }], service_tier: "flex" }, false, {});
    expect(out.service_tier).toBe("flex");
  });
  it("omits service_tier when the client didn't send one", () => {
    const out = openaiToOpenAIResponsesRequest("gpt-5", { messages: [{ role: "user", content: "hi" }] }, false, {});
    expect(out.service_tier).toBeUndefined();
  });
});
