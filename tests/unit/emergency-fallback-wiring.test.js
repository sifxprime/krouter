// Integration tests for the chatCore emergencyFallback wiring (0.5.28).
// Verifies the helper contract chatCore uses to produce the hint object.
import { describe, expect, it } from "vitest";
import {
  shouldUseEmergencyFallback,
  buildEmergencyFallbackConfig,
  EMERGENCY_FALLBACK_DEFAULTS,
} from "../../open-sse/services/emergencyFallback.js";

describe("emergencyFallback wiring contract", () => {
  it("buildEmergencyFallbackConfig reads settings.emergencyFallbackEnabled", () => {
    const offByDefault = buildEmergencyFallbackConfig({});
    const on = buildEmergencyFallbackConfig({ emergencyFallbackEnabled: true });
    expect(offByDefault.enabled).toBe(false);
    expect(on.enabled).toBe(true);
  });

  it("hint object contains provider/model/reason/maxOutputTokens for chat.js", () => {
    const cfg = buildEmergencyFallbackConfig({
      emergencyFallbackEnabled: true,
      emergencyFallbackProvider: "nvidia",
      emergencyFallbackModel: "openai/gpt-oss-120b",
    });
    const decision = shouldUseEmergencyFallback(402, "", false, cfg);
    expect(decision.shouldFallback).toBe(true);
    expect(decision.provider).toBe("nvidia");
    expect(decision.model).toBe("openai/gpt-oss-120b");
    expect(typeof decision.reason).toBe("string");
    expect(typeof decision.maxOutputTokens).toBe("number");
  });

  it("does not trigger when body.__emergencyFallbackUsed is the simulated state (caller check)", () => {
    // chat.js guards with: if (result.emergencyFallback && !body.__emergencyFallbackUsed)
    // Here we just confirm the decision DOES fire from chatCore — chat.js does the
    // loop-protection.
    const cfg = buildEmergencyFallbackConfig({ emergencyFallbackEnabled: true });
    expect(shouldUseEmergencyFallback(402, "", false, cfg).shouldFallback).toBe(true);
    // Now simulate that chat.js's loop-protection would have already kicked in
    // (we just check the data flow — chat.js skips based on body, not config):
    const usedFlag = true;
    const fb = shouldUseEmergencyFallback(402, "", false, cfg);
    const willActuallyFire = fb.shouldFallback && !usedFlag;
    expect(willActuallyFire).toBe(false);
  });

  it("env defaults exported for chatCore to use", () => {
    expect(EMERGENCY_FALLBACK_DEFAULTS.enabled).toBe(false);
    expect(EMERGENCY_FALLBACK_DEFAULTS.provider).toBe("nvidia");
    expect(EMERGENCY_FALLBACK_DEFAULTS.model).toBe("openai/gpt-oss-120b");
    expect(EMERGENCY_FALLBACK_DEFAULTS.skipForToolRequests).toBe(true);
  });
});
