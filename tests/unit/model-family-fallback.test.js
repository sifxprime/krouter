// Tests for modelFamilyFallback (0.5.28).
import { describe, expect, it } from "vitest";
import {
  isModelUnavailableError,
  getNextFamilyFallback,
  isInModelFamily,
  getModelFamily,
} from "../../open-sse/services/modelFamilyFallback.js";

describe("isModelUnavailableError", () => {
  it("recognizes 404 as model-unavailable unconditionally", () => {
    expect(isModelUnavailableError(404, "")).toBe(true);
    expect(isModelUnavailableError(404, "anything")).toBe(true);
  });

  it("recognizes 400 with known fragments", () => {
    expect(isModelUnavailableError(400, "Model not found: gemini-x")).toBe(true);
    expect(isModelUnavailableError(400, "{\"error\":\"unknown model\"}")).toBe(true);
    expect(isModelUnavailableError(400, "Improperly formed request")).toBe(true);
    expect(isModelUnavailableError(400, "requested entity was not found")).toBe(true);
  });

  it("recognizes 403 with known fragments", () => {
    expect(isModelUnavailableError(403, "access to model denied")).toBe(true);
    expect(isModelUnavailableError(403, "not enabled for this account")).toBe(true);
  });

  it("does NOT match generic 400 errors", () => {
    expect(isModelUnavailableError(400, "Bad request")).toBe(false);
    expect(isModelUnavailableError(400, "Param Incorrect")).toBe(false);
  });

  it("does NOT match 429 or 500 even with matching text", () => {
    expect(isModelUnavailableError(429, "Model not found")).toBe(false);
    expect(isModelUnavailableError(500, "Model not found")).toBe(false);
  });

  it("handles missing/non-string body gracefully", () => {
    expect(isModelUnavailableError(400, null)).toBe(false);
    expect(isModelUnavailableError(400, undefined)).toBe(false);
    expect(isModelUnavailableError(400, "")).toBe(false);
  });
});

describe("getNextFamilyFallback", () => {
  it("returns the first family sibling for a known model", () => {
    const next = getNextFamilyFallback("ag/gemini-3-pro", new Set());
    expect(next).toBe("ag/gemini-3.1-pro-preview");
  });

  it("skips models already tried", () => {
    const tried = new Set(["ag/gemini-3.1-pro-preview", "ag/gemini-3-pro-preview"]);
    const next = getNextFamilyFallback("ag/gemini-3-pro", tried);
    expect(next).toBe("ag/gemini-3.1-pro-high");
  });

  it("returns null when family is exhausted", () => {
    const tried = new Set([
      "ag/gemini-3-pro",
      "ag/gemini-3.1-pro-preview", "ag/gemini-3-pro-preview",
      "ag/gemini-3.1-pro-high", "ag/gemini-3-pro-high",
      "ag/gemini-3.1-pro-low", "ag/gemini-3-pro-low",
    ]);
    expect(getNextFamilyFallback("ag/gemini-3-pro", tried)).toBeNull();
  });

  it("returns null for unknown models", () => {
    expect(getNextFamilyFallback("ag/some-fake-model", new Set())).toBeNull();
    expect(getNextFamilyFallback("nvidia/llama-3", new Set())).toBeNull();
  });

  it("preserves the provider prefix from the input", () => {
    expect(getNextFamilyFallback("ag/claude-opus-4-8", new Set())).toBe("ag/claude-opus-4-7");
    expect(getNextFamilyFallback("kr/claude-opus-4-8", new Set())).toBe("kr/claude-opus-4-7");
  });

  it("handles dot-separated model names (gemini-3.1-pro)", () => {
    // We normalize dots to hyphens in the lookup key
    const next = getNextFamilyFallback("ag/gemini-3.1-pro", new Set());
    expect(next).not.toBeNull();
  });

  it("safely handles null/undefined input", () => {
    expect(getNextFamilyFallback(null, new Set())).toBeNull();
    expect(getNextFamilyFallback(undefined, new Set())).toBeNull();
    expect(getNextFamilyFallback("", new Set())).toBeNull();
  });
});

describe("isInModelFamily", () => {
  it("returns true for registered models", () => {
    expect(isInModelFamily("ag/gemini-3-pro")).toBe(true);
    expect(isInModelFamily("ag/claude-opus-4-8")).toBe(true);
  });

  it("returns false for unknown models", () => {
    expect(isInModelFamily("ag/random-model")).toBe(false);
    expect(isInModelFamily(null)).toBe(false);
  });
});

describe("getModelFamily", () => {
  it("returns [self, ...siblings] for known models", () => {
    const f = getModelFamily("ag/gemini-3-pro");
    expect(f[0]).toBe("ag/gemini-3-pro");
    expect(f.length).toBeGreaterThan(1);
    expect(f.every(m => m.startsWith("ag/"))).toBe(true);
  });

  it("returns [self] for unknown models", () => {
    expect(getModelFamily("ag/unknown")).toEqual(["ag/unknown"]);
  });
});
