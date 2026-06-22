// Tests for emergencyFallback (0.5.28).
import { describe, expect, it } from "vitest";
import {
  shouldUseEmergencyFallback,
  buildEmergencyFallbackConfig,
  EMERGENCY_FALLBACK_DEFAULTS,
} from "../../open-sse/services/emergencyFallback.js";

const ENABLED = { ...EMERGENCY_FALLBACK_DEFAULTS, enabled: true };

describe("shouldUseEmergencyFallback", () => {
  it("returns no-fallback when disabled (default)", () => {
    const r = shouldUseEmergencyFallback(402, "anything", false);
    expect(r.shouldFallback).toBe(false);
    expect(r.reason).toMatch(/disabled/);
  });

  it("triggers on HTTP 402 when enabled", () => {
    const r = shouldUseEmergencyFallback(402, "", false, ENABLED);
    expect(r.shouldFallback).toBe(true);
    expect(r.provider).toBe("nvidia");
    expect(r.model).toBe("openai/gpt-oss-120b");
  });

  it("triggers on budget keywords in error body", () => {
    const r = shouldUseEmergencyFallback(400, "Error: insufficient funds in wallet", false, ENABLED);
    expect(r.shouldFallback).toBe(true);
    expect(r.reason).toMatch(/insufficient funds/);
  });

  it("recognizes multiple budget keyword variants", () => {
    const variants = [
      "Insufficient funds",
      "out of credits",
      "quota exceeded",
      "Payment Required",
      "credit limit reached",
    ];
    for (const text of variants) {
      const r = shouldUseEmergencyFallback(400, text, false, ENABLED);
      expect(r.shouldFallback, text).toBe(true);
    }
  });

  it("does NOT trigger on normal errors", () => {
    const r = shouldUseEmergencyFallback(500, "Internal error", false, ENABLED);
    expect(r.shouldFallback).toBe(false);
  });

  it("skips when request has tools (default behavior)", () => {
    const r = shouldUseEmergencyFallback(402, "", true, ENABLED);
    expect(r.shouldFallback).toBe(false);
    expect(r.reason).toMatch(/tool/);
  });

  it("can be configured to ignore tools restriction", () => {
    const cfg = { ...ENABLED, skipForToolRequests: false };
    const r = shouldUseEmergencyFallback(402, "", true, cfg);
    expect(r.shouldFallback).toBe(true);
  });
});

describe("buildEmergencyFallbackConfig", () => {
  it("returns defaults when settings is null", () => {
    expect(buildEmergencyFallbackConfig(null)).toBe(EMERGENCY_FALLBACK_DEFAULTS);
  });

  it("respects emergencyFallbackEnabled from settings", () => {
    const c = buildEmergencyFallbackConfig({ emergencyFallbackEnabled: true });
    expect(c.enabled).toBe(true);
  });

  it("preserves default provider/model when not overridden", () => {
    const c = buildEmergencyFallbackConfig({ emergencyFallbackEnabled: true });
    expect(c.provider).toBe(EMERGENCY_FALLBACK_DEFAULTS.provider);
    expect(c.model).toBe(EMERGENCY_FALLBACK_DEFAULTS.model);
  });

  it("uses custom provider/model when set", () => {
    const c = buildEmergencyFallbackConfig({
      emergencyFallbackEnabled: true,
      emergencyFallbackProvider: "openrouter",
      emergencyFallbackModel: "google/gemini-flash-1.5",
    });
    expect(c.provider).toBe("openrouter");
    expect(c.model).toBe("google/gemini-flash-1.5");
  });
});
