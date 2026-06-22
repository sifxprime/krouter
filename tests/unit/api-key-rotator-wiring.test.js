// Integration test for the base.js executor wiring (0.5.28).
// Verifies the rotator's contract: cycle through valid keys, skip invalid ones,
// record success / failure based on response status.
import { describe, expect, it, beforeEach } from "vitest";
import {
  getValidApiKey,
  recordKeyFailure,
  recordKeySuccess,
  getKeyHealth,
  trackConnectionExtraKeys,
  clearAllKeyState,
} from "../../open-sse/services/apiKeyRotator.js";

describe("apiKeyRotator wiring contract (base.js → rotator)", () => {
  beforeEach(() => clearAllKeyState());

  it("trackConnectionExtraKeys registers the connection BEFORE first rotation", () => {
    trackConnectionExtraKeys("conn-A", ["E0", "E1"]);
    const r = getValidApiKey("conn-A", "PRIMARY", ["E0", "E1"]);
    expect(["primary", "extra_0", "extra_1"]).toContain(r.keyId);
  });

  it("base.js's 401 handler → recordKeyFailure → marks invalid after 2 failures", () => {
    trackConnectionExtraKeys("conn-B", ["E0"]);
    let r = getValidApiKey("conn-B", "P", ["E0"]);
    expect(r).not.toBeNull();
    recordKeyFailure("conn-B", "primary");
    expect(getKeyHealth("conn-B", "primary").status).toBe("warning");
    recordKeyFailure("conn-B", "primary");
    expect(getKeyHealth("conn-B", "primary").status).toBe("invalid");

    // Now rotator must NOT return primary
    const seen = [];
    for (let i = 0; i < 4; i++) seen.push(getValidApiKey("conn-B", "P", ["E0"]).key);
    expect(seen).not.toContain("P");
    expect(seen.every(k => k === "E0")).toBe(true);
  });

  it("base.js's 200 handler → recordKeySuccess → resets to active", () => {
    trackConnectionExtraKeys("conn-C", ["E0"]);
    recordKeyFailure("conn-C", "primary");
    recordKeyFailure("conn-C", "primary"); // invalid
    recordKeySuccess("conn-C", "primary"); // recovery
    expect(getKeyHealth("conn-C", "primary").status).toBe("active");
    // Rotator now picks primary again
    const r = getValidApiKey("conn-C", "P", ["E0"]);
    expect(["P", "E0"]).toContain(r.key);
  });

  it("returns null when all keys invalidated → base.js should bail with 401 from connection", () => {
    trackConnectionExtraKeys("conn-D", ["E0"]);
    recordKeyFailure("conn-D", "primary");
    recordKeyFailure("conn-D", "primary");
    recordKeyFailure("conn-D", "extra_0");
    recordKeyFailure("conn-D", "extra_0");
    expect(getValidApiKey("conn-D", "P", ["E0"])).toBeNull();
  });
});
