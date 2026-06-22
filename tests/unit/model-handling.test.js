// Tests for modelDeprecation and modelStrip (0.5.31)
import { describe, expect, it } from "vitest";
import { resolveDeprecatedModel } from "../../open-sse/services/modelDeprecation.js";
import { findOffendingField, stripUnsupportedFields } from "../../open-sse/services/modelStrip.js";

describe("modelDeprecation — resolveDeprecatedModel", () => {
  it("leaves current models unchanged", () => {
    expect(resolveDeprecatedModel("ag/gemini-2.5-pro")).toBe("ag/gemini-2.5-pro");
    expect(resolveDeprecatedModel("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("upgrades bare deprecated models", () => {
    expect(resolveDeprecatedModel("gemini-pro")).toBe("gemini-2.5-pro");
    expect(resolveDeprecatedModel("gemini-1.5-flash")).toBe("gemini-2.5-flash");
    expect(resolveDeprecatedModel("mistral-large")).toBe("mistral-large-latest");
  });

  it("upgrades prefixed deprecated models and preserves the prefix", () => {
    expect(resolveDeprecatedModel("ag/gemini-pro")).toBe("ag/gemini-2.5-pro");
    expect(resolveDeprecatedModel("openai-compatible-foo/gpt-4-1106-preview")).toBe("openai-compatible-foo/gpt-4-turbo");
  });

  it("handles replacements that already include a slash (e.g. Fireworks to Moonshot)", () => {
    // kimi-k2p5 maps to moonshotai/Kimi-K2.5
    expect(resolveDeprecatedModel("kimi-k2p5")).toBe("moonshotai/Kimi-K2.5");
    // Even if it had a generic provider prefix, the hardcoded replacement wins fully
    expect(resolveDeprecatedModel("fw/kimi-k2p5")).toBe("moonshotai/Kimi-K2.5");
  });

  it("handles null/undefined gracefully", () => {
    expect(resolveDeprecatedModel(null)).toBeNull();
    expect(resolveDeprecatedModel(undefined)).toBeUndefined();
    expect(resolveDeprecatedModel("")).toBe("");
  });
});

describe("modelStrip — findOffendingField", () => {
  it("finds known fields in 400 error bodies (quoted)", () => {
    // single quotes — xAI style
    expect(findOffendingField('{"error": "Unsupported param \'logprobs\'"}')).toBe("logprobs");
    // double quotes — unescaped
    expect(findOffendingField('Invalid field "reasoning_budget" provided')).toBe("reasoning_budget");
    // backticks
    expect(findOffendingField("Unknown property `presence_penalty`")).toBe("presence_penalty");
  });

  it("finds bare unquoted field names (Groq / OpenRouter shape)", () => {
    // Groq: bare field after colon
    expect(findOffendingField('{"error":{"message":"Unknown parameter: logprobs"}}')).toBe("logprobs");
    // OpenRouter: bare field after `field`
    expect(findOffendingField('{"error":"unrecognized field reasoning_content"}')).toBe("reasoning_content");
    // Bare in plain prose
    expect(findOffendingField("frequency_penalty is not supported by this model")).toBe("frequency_penalty");
  });

  it("finds field names inside escaped-quote JSON bodies", () => {
    // raw response body where the field appears inside an escaped double-quote
    // (\"presence_penalty\") — common when upstream returns the field name
    // embedded inside another JSON string field.
    const escapedBody = '{"detail":"Field \\"presence_penalty\\" invalid"}';
    expect(findOffendingField(escapedBody)).toBe("presence_penalty");
  });

  it("does NOT match when the field name is part of another word", () => {
    // Word-boundary check should prevent over-matching. `xlogprobs` is not
    // `logprobs`; `reasoning_budget_v2` is not `reasoning_budget`.
    expect(findOffendingField("xlogprobs is fine")).toBeNull();
    expect(findOffendingField("the reasoning_budget_v2 field passed")).toBeNull();
  });

  it("returns null if no known offending field is named", () => {
    expect(findOffendingField('{"error": "Bad Request"}')).toBeNull();
  });

  it("handles non-string/missing body gracefully", () => {
    expect(findOffendingField(null)).toBeNull();
    expect(findOffendingField({})).toBeNull();
    expect(findOffendingField("")).toBeNull();
    expect(findOffendingField(undefined)).toBeNull();
  });
});

describe("modelStrip — stripUnsupportedFields", () => {
  it("strips logprobs from groq requests", () => {
    const body = {
      model: "llama3",
      messages: [],
      logprobs: true,
      top_logprobs: 5,
      temperature: 0.7,
    };
    const stripped = stripUnsupportedFields(body, "groq");
    expect(stripped.logprobs).toBeUndefined();
    expect(stripped.top_logprobs).toBeUndefined();
    expect(stripped.temperature).toBe(0.7); // untouched
  });

  it("does NOT strip logprobs from regular openai requests", () => {
    const body = { logprobs: true };
    const stripped = stripUnsupportedFields(body, "openai");
    expect(stripped.logprobs).toBe(true);
  });

  it("strips unexpected 'name' fields from non-tool messages", () => {
    const body = {
      messages: [
        { role: "user", content: "hi", name: "User" }, // Invalid for some providers
        { role: "function", content: "ok", name: "fetch" }, // Valid
      ],
    };
    const stripped = stripUnsupportedFields(body, "any-provider");
    expect(stripped.messages[0].name).toBeUndefined();
    expect(stripped.messages[1].name).toBe("fetch");
  });
});
