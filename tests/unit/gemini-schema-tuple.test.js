/**
 * Gemini and Antigravity reject two JSON Schema shapes outright:
 *   - prefixItems (2020-12 tuple validation) -> 400 "Unknown name prefixItems"
 *   - type:"array" with no items             -> 400, missing required field
 *
 * Zod's z.tuple() emits the first and a great many MCP server tool schemas emit the
 * second, so any client with MCP tools pointed at a Gemini or Antigravity connection
 * fails the whole turn rather than degrading.
 *
 * Ported from upstream f6c59d30 (their translator/formats/gemini.js is our
 * translator/helpers/geminiHelper.js).
 */
import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/helpers/geminiHelper.js";

describe("Gemini schema sanitiser: tuples and bare arrays", () => {
  it("turns a single-variant prefixItems into items", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { pair: { type: "array", prefixItems: [{ type: "string" }] } },
    });
    expect(out.properties.pair.prefixItems).toBeUndefined();
    expect(out.properties.pair.items).toEqual({ type: "string" });
  });

  it("turns a multi-variant prefixItems into an anyOf items", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        pair: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }] },
      },
    });
    const items = out.properties.pair.items;
    expect(out.properties.pair.prefixItems).toBeUndefined();
    // flattenAnyOfOneOf may collapse it; either shape is valid, a tuple is not.
    expect(items).toBeTruthy();
    expect(JSON.stringify(items)).not.toContain("prefixItems");
  });

  it("drops a null variant rather than offering it as the item type", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        maybe: { type: "array", prefixItems: [{ type: "string" }, { type: "null" }] },
      },
    });
    expect(JSON.stringify(out.properties.maybe)).not.toContain('"null"');
  });

  it("gives every bare array an items schema", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { tags: { type: "array" } },
    });
    expect(out.properties.tags.items).toEqual({ type: "string" });
  });

  it("reaches arrays nested inside properties and items", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        outer: {
          type: "array",
          items: { type: "object", properties: { inner: { type: "array" } } },
        },
      },
    });
    expect(out.properties.outer.items.properties.inner.items).toEqual({ type: "string" });
  });

  it("leaves an array that already declares items alone", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { nums: { type: "array", items: { type: "number" } } },
    });
    expect(out.properties.nums.items).toEqual({ type: "number" });
  });

  it("strips prefixItems and additionalItems even where they survive conversion", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        // items already present, so conversion leaves prefixItems for the stripper
        t: { type: "array", items: { type: "string" }, prefixItems: [{ type: "number" }], additionalItems: false },
      },
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain("prefixItems");
    expect(json).not.toContain("additionalItems");
  });
});
