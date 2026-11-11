import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The PATCH handler for /api/cli-tools/antigravity-mitm serves three actions:
 * enable and disable (per-tool DNS) and trust-cert (global, no tool).
 *
 * Its guard required BOTH `tool` and `action`, so trust-cert -- which correctly
 * sends no tool -- was rejected with 400 "tool and action required" before it
 * could reach its own branch further down. That branch was unreachable, and
 * since Trust Cert is the first step of MITM setup, the server could never be
 * started from a clean install. Reported by a user as "MITM won't start".
 */

const SRC = readFileSync("src/app/api/cli-tools/antigravity-mitm/route.js", "utf8");

describe("MITM PATCH guard", () => {
  it("does not require a tool for trust-cert", () => {
    // The old guard. If it comes back, trust-cert is dead again.
    expect(SRC).not.toMatch(/if\s*\(\s*!tool\s*\|\|\s*!action\s*\)/);
  });

  it("still requires an action", () => {
    expect(SRC).toMatch(/if\s*\(\s*!action\s*\)/);
  });

  it("still requires a tool for the per-tool actions, and exempts the tool-less ones", () => {
    // 0.5.175 — This used to match the guard expression verbatim, which broke the
    // moment a second tool-less action (proxy-start/proxy-stop) was added even
    // though the behaviour was unchanged. Read the guard and check what it
    // exempts instead, so a new tool-less action is not a false regression.
    const at = SRC.indexOf("!tool)");
    expect(at).toBeGreaterThan(-1);
    const guard = SRC.slice(SRC.lastIndexOf("if (", at), at + "!tool)".length);
    expect(guard).toMatch(/action\s*!==\s*["']trust-cert["']/); // global: no tool
    expect(guard).toMatch(/proxy-/); // proxy capture is global too, not per tool
  });

  it("keeps the trust-cert branch reachable", () => {
    const guardAt = SRC.indexOf("action required");
    const branchAt = SRC.indexOf('action === "trust-cert"');
    expect(guardAt).toBeGreaterThan(-1);
    expect(branchAt).toBeGreaterThan(-1);
    // The branch must exist after the guard, and the guard must not block it.
    expect(branchAt).toBeGreaterThan(guardAt);
  });
});
