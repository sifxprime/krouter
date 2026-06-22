// Tests for apiKeyRotator (0.5.28).
import { describe, expect, it, beforeEach } from "vitest";
import {
  getValidApiKey,
  getRotatingApiKey,
  recordKeyFailure,
  recordKeySuccess,
  getKeyHealth,
  trackConnectionExtraKeys,
  connectionHasExtraKeys,
  clearAllKeyState,
} from "../../open-sse/services/apiKeyRotator.js";

describe("apiKeyRotator", () => {
  beforeEach(() => clearAllKeyState());

  describe("getValidApiKey — round-robin among healthy keys", () => {
    it("returns primary when no extras", () => {
      const r = getValidApiKey("c1", "PRIMARY", []);
      expect(r).toEqual({ key: "PRIMARY", keyId: "primary" });
    });

    it("cycles through primary + extras", () => {
      const seen = [];
      for (let i = 0; i < 6; i++) {
        seen.push(getValidApiKey("c2", "P", ["E0", "E1"]).key);
      }
      // Should hit each key twice
      const counts = seen.reduce((a, k) => ({ ...a, [k]: (a[k] || 0) + 1 }), {});
      expect(counts.P).toBe(2);
      expect(counts.E0).toBe(2);
      expect(counts.E1).toBe(2);
    });

    it("skips keys marked invalid", () => {
      recordKeyFailure("c3", "extra_0");
      recordKeyFailure("c3", "extra_0"); // 2 failures → invalid
      const seen = [];
      for (let i = 0; i < 4; i++) {
        seen.push(getValidApiKey("c3", "P", ["E0", "E1"]).key);
      }
      expect(seen).not.toContain("E0");
      expect(seen).toContain("P");
      expect(seen).toContain("E1");
    });

    it("returns null when all keys are invalid", () => {
      recordKeyFailure("c4", "primary");
      recordKeyFailure("c4", "primary");
      recordKeyFailure("c4", "extra_0");
      recordKeyFailure("c4", "extra_0");
      expect(getValidApiKey("c4", "P", ["E0"])).toBeNull();
    });
  });

  describe("recordKeyFailure / recordKeySuccess", () => {
    it("marks status warning after 1 failure, invalid after 2", () => {
      let h = recordKeyFailure("c5", "primary");
      expect(h.status).toBe("warning");
      expect(h.failures).toBe(1);
      h = recordKeyFailure("c5", "primary");
      expect(h.status).toBe("invalid");
      expect(h.failures).toBe(2);
    });

    it("resets to active on success", () => {
      recordKeyFailure("c6", "primary");
      recordKeyFailure("c6", "primary"); // invalid
      const h = recordKeySuccess("c6", "primary");
      expect(h.status).toBe("active");
      expect(h.failures).toBe(0);
    });

    it("tracks lifetime totalRequests + totalFailures", () => {
      recordKeyFailure("c7", "primary");
      recordKeySuccess("c7", "primary");
      recordKeyFailure("c7", "primary");
      const h = getKeyHealth("c7", "primary");
      expect(h.totalRequests).toBe(3);
      expect(h.totalFailures).toBe(2);
    });
  });

  describe("trackConnectionExtraKeys / connectionHasExtraKeys", () => {
    it("tracks whether a connection has extra keys", () => {
      trackConnectionExtraKeys("c8", ["E0", "E1"]);
      expect(connectionHasExtraKeys("c8")).toBe(true);
      trackConnectionExtraKeys("c9", []);
      expect(connectionHasExtraKeys("c9")).toBe(false);
    });

    it("direct argument takes precedence over cache", () => {
      expect(connectionHasExtraKeys("c10", ["E0"])).toBe(true);
    });
  });

  describe("getRotatingApiKey (legacy, no health check)", () => {
    it("returns primary alone when no extras", () => {
      expect(getRotatingApiKey("c11", "P", [])).toBe("P");
    });

    it("cycles even through unhealthy keys", () => {
      recordKeyFailure("c12", "extra_0");
      recordKeyFailure("c12", "extra_0"); // invalid via getValidApiKey, but legacy ignores
      const seen = [];
      for (let i = 0; i < 4; i++) seen.push(getRotatingApiKey("c12", "P", ["E0"]));
      expect(seen).toContain("E0"); // legacy doesn't skip
    });
  });
});
