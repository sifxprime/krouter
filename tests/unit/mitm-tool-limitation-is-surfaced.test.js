/**
 * 0.5.174 — a tool MITM cannot fully intercept must say so on its own card.
 *
 * kRouter offers Antigravity 24 MITM model slots. On Antigravity 2.x none of them can
 * ever route a chat turn: the IDE's agent is a separate Go process (`agy`) that builds
 * its own root pool (NewCertPool/RootCAs, 22 bundled PEM blocks) and reads no TLS, CA or
 * proxy environment variables, so it rejects the kRouter CA however the machine is set up.
 * `antigravity.caCertificates` exists only in @vscode/proxy-agent — the Electron side —
 * which is why setting it fixes sign-in and never the chat.
 *
 * Measured with the DNS redirect verifiably held for a whole capture: in the same window
 * on the same host, curl reached the MITM and wrote request dumps while the agent wrote
 * none and logged 38 "x509: certificate signed by unknown authority".
 *
 * Without a note on the card the UI is indistinguishable from a broken setup — the DNS
 * toggle goes green, the slots invite mapping, and nothing routes. A day went into
 * chasing that. The point of this test is that the explanation ships with the feature.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

const card = readFileSync(
  "src/app/(dashboard)/dashboard/cli-tools/components/MitmToolCard.js",
  "utf8",
);

describe("Antigravity declares what MITM cannot do", () => {
  it("carries a limitation note", () => {
    expect(typeof MITM_TOOLS.antigravity.mitmLimitation).toBe("string");
    expect(MITM_TOOLS.antigravity.mitmLimitation.length).toBeGreaterThan(20);
  });

  it("the note says chat does not route", () => {
    expect(MITM_TOOLS.antigravity.mitmLimitation).toMatch(/chat/i);
  });

  it("and that the provider is unaffected, so nobody disables the wrong thing", () => {
    // ag/ over OAuth works normally; only the IDE-via-MITM path is blocked.
    expect(MITM_TOOLS.antigravity.mitmLimitation).toMatch(/provider/i);
  });
});

describe("tools that DO intercept carry no note", () => {
  it.each(["kiro", "claude", "copilot"])("%s has no limitation", (id) => {
    expect(MITM_TOOLS[id].mitmLimitation).toBeUndefined();
  });
});

describe("the card shows it", () => {
  it("renders tool.mitmLimitation", () => {
    expect(card).toContain("tool.mitmLimitation");
  });

  it("renders it only when present, so other tools are unchanged", () => {
    expect(card).toMatch(/\{tool\.mitmLimitation\s*&&/);
  });
});
