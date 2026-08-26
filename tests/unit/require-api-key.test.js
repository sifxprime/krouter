import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * REQUIRE_API_KEY is catalogued in src/shared/constants/envVars.js and documented in
 * both READMEs as "Enforce Bearer API key on /v1/* routes" — but no code ever read it,
 * so an operator who set it on a shared machine believed they had turned on a control
 * that did not exist. Remote callers already required a key; the loopback exemption in
 * canAccessPublicLlmApi was unconditional, and that exemption is exactly what the flag
 * is asking to remove.
 *
 * Verified live in both states: unset, localhost 200 / LAN 401; set, localhost 401
 * without a key and 200 with one.
 */
const guard = readFileSync("src/dashboardGuard.js", "utf8");
const envVars = readFileSync("src/shared/constants/envVars.js", "utf8");

describe("REQUIRE_API_KEY", () => {
  it("is actually read by the guard, not only documented", () => {
    expect(guard).toContain("process.env.REQUIRE_API_KEY");
  });

  it("gates the loopback exemption rather than the key check", () => {
    // The exemption must be conditional; the key path must still run either way.
    expect(guard).toMatch(/if\s*\(\s*!requireKey\s*&&\s*isLocalRequest\(request\)\s*\)\s*return true;/);
    expect(guard).toContain("hasValidApiKey(request)");
  });

  it("stays off by default, so a local install keeps working untouched", () => {
    // Only the exact string "true" enables it; unset or anything else leaves the
    // loopback exemption in place.
    expect(guard).toMatch(/REQUIRE_API_KEY\s*===\s*"true"/);
    expect(envVars).toMatch(/REQUIRE_API_KEY[\s\S]{0,200}default:\s*"false"/);
  });

  it("does not tell a loopback caller their request was remote", () => {
    expect(guard).toContain("REQUIRE_API_KEY is enabled");
  });

  it("is still catalogued for the environment page", () => {
    expect(envVars).toContain("REQUIRE_API_KEY");
  });
});
