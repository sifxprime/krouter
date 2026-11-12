/**
 * 0.5.174 — a tool MITM cannot fully intercept must say so on its own card.
 * 0.5.179 — and must STOP saying so once it can.
 *
 * Antigravity carried a note claiming chat could never route, because `agy`
 * "builds its own root pool and reads no TLS, CA or proxy environment
 * variables". That was wrong. agy honours SSL_CERT_FILE, and SSL_CERT_FILE
 * REPLACES the system trust store instead of adding to it -- so a certifi
 * bundle exported by the user's shell hid the System keychain where the kRouter
 * CA was trusted, and every call failed to verify. The 38 "x509: certificate
 * signed by unknown authority" lines that were taken as proof of pinning were
 * that variable.
 *
 * src/mitm/goCaCerts.js now writes a bundle of system roots + kRouter CA and
 * points SSL_CERT_FILE at it, and the chat routes end to end.
 *
 * The note is gone, and this test now guards the opposite property: a stale
 * limitation is worse than none, because it tells users not to try something
 * that works. The mechanism -- that a declared limitation reaches the card --
 * is still tested below with the tools that have one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

const card = readFileSync(
  "src/app/(dashboard)/dashboard/cli-tools/components/MitmToolCard.js",
  "utf8",
);

describe("Antigravity no longer claims chat cannot route", () => {
  it("carries no limitation note", () => {
    // It routes. A note saying otherwise would send users away from a working
    // feature -- the exact cost the original note was written to avoid.
    const note = MITM_TOOLS.antigravity.mitmLimitation;
    expect(note === undefined || note === "").toBe(true);
  });
});

describe("tools that DO intercept carry no note", () => {
  it.each(["kiro", "claude", "antigravity"])("%s has no limitation", (id) => {
    const note = MITM_TOOLS[id].mitmLimitation;
    expect(note === undefined || note === "").toBe(true);
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
