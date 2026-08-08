import { describe, it, expect } from "vitest";
import { LOAD_CODE_ASSIST_HEADERS, ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS } from "../../open-sse/config/appConstants.js";
import { rotateWorkingCreds } from "../../open-sse/handlers/chatCore.js";

describe("0.5.124 35f86e58 — Antigravity provisioning header fingerprint", () => {
  it("antigravity provisioning headers DROP the SDK fingerprint Google refuses on", () => {
    expect(ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS["X-Goog-Api-Client"]).toBeUndefined();
    expect(ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS["Client-Metadata"]).toBeUndefined();
  });
  it("antigravity provisioning headers carry Content-Type + the real Antigravity IDE UA", () => {
    expect(ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS["Content-Type"]).toBe("application/json");
    expect(ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS["User-Agent"]).toMatch(/^antigravity\//);
  });
  it("the generic (gemini-cli) headers still carry the SDK fingerprint", () => {
    expect(LOAD_CODE_ASSIST_HEADERS["X-Goog-Api-Client"]).toBeDefined();
    expect(LOAD_CODE_ASSIST_HEADERS["Client-Metadata"]).toBeDefined();
  });
});

describe("0.5.124 aa0448f7 — rotating refresh_token across retries (immutably)", () => {
  it("folds a rotated refresh_token into a NEW object, leaving the original untouched", () => {
    const original = { accessToken: "a0", refreshToken: "r0", provider: "xai" };
    const next = rotateWorkingCreds(original, { accessToken: "a1", refreshToken: "r1" });
    expect(next).not.toBe(original);           // new object
    expect(next.refreshToken).toBe("r1");
    expect(next.accessToken).toBe("a1");
    expect(next.provider).toBe("xai");         // preserved
    expect(original.refreshToken).toBe("r0");  // caller's object NOT mutated
    expect(original.accessToken).toBe("a0");
  });

  it("returns the SAME object when the refresh_token didn't rotate", () => {
    const creds = { accessToken: "a0", refreshToken: "r0" };
    expect(rotateWorkingCreds(creds, { accessToken: "a1", refreshToken: "r0" })).toBe(creds);
    expect(rotateWorkingCreds(creds, { accessToken: "a1" })).toBe(creds); // no RT in result
    expect(rotateWorkingCreds(creds, null)).toBe(creds);
  });

  it("across 3 retries each attempt uses the LATEST rotated RT (no stale-RT reuse)", () => {
    // Simulate refreshWithRetry calling the closure 3x with a provider that rotates the RT each time.
    const original = { accessToken: "a0", refreshToken: "r0" };
    let working = original;
    const seenRefreshTokens = [];
    for (let i = 1; i <= 3; i++) {
      seenRefreshTokens.push(working.refreshToken);           // what THIS attempt would send
      working = rotateWorkingCreds(working, { accessToken: `a${i}`, refreshToken: `r${i}` });
    }
    // attempt 1 sends r0, attempt 2 sends r1 (the rotation), attempt 3 sends r2 — never a consumed RT twice
    expect(seenRefreshTokens).toEqual(["r0", "r1", "r2"]);
    expect(original.refreshToken).toBe("r0"); // caller object still pristine
  });
});
