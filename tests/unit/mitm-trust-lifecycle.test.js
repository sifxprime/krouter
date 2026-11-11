/**
 * 0.5.169 — turning MITM on must be enough. No IDE restart, no manual cert step.
 *
 * The regression this prevents is subtle because it looks like correct cleanup: MITM stop
 * used to remove the CA trust it had installed. The consequence was that any tool LAUNCHED
 * while MITM was off had no trust, so the next time MITM came up that tool's TLS failed
 * until it was restarted — the "restart every IDE" dance. Trust is inert while MITM is off,
 * because nothing resolves to kRouter and the certificate is never presented, so removing
 * it buys nothing and costs a restart.
 *
 * The three tools need three different mechanisms, which is why "the CA is installed" was
 * never sufficient:
 *   Kiro           native/Chromium -> OS trust store. Nothing to do.
 *   Claude Desktop Electron + Node -> Node's own CA list, so NODE_EXTRA_CA_CERTS.
 *   Antigravity    Go language server -> neither of those; antigravity.caCertificates.
 *
 * These are source-level assertions on purpose. Exercising the real start path needs root
 * and port 443, which would mean displacing a MITM the user has running, so the lifecycle
 * is pinned by structure and the behaviour of the writer itself is covered by
 * ide-ca-trust-no-restart-needed.test.js.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const manager = readFileSync("src/mitm/manager.js", "utf8");
const certInstall = readFileSync("src/mitm/cert/install.js", "utf8");

// The stop function, isolated, so a match elsewhere in the file cannot mask a regression.
// stopMitm is an alias of stopServer (manager.js:913), which is the real body.
const STOP_START = manager.search(/async function stopServer/);
const stopBody = STOP_START < 0 ? "" : manager.slice(STOP_START, STOP_START + 6000);

describe("trust is established when MITM starts", () => {
  it("writes the Antigravity setting its Go client reads", () => {
    expect(manager).toContain('require("./ideCaTrust")');
    expect(manager).toContain("configureIdeCaTrust(");
  });

  it("still sets NODE_EXTRA_CA_CERTS for Electron/Node tools on all three platforms", () => {
    expect(manager).toMatch(/launchctl setenv NODE_EXTRA_CA_CERTS/); // macOS
    expect(manager).toMatch(/setx NODE_EXTRA_CA_CERTS/); // Windows
    expect(manager).toContain("setLinuxNodeExtraCaCerts("); // Linux
  });
});

describe("stopping MITM does NOT remove trust", () => {
  it("the stop function was located, so the assertions below mean something", () => {
    expect(STOP_START).toBeGreaterThan(-1);
    expect(stopBody).toContain("PID_FILE");
  });

  it.each([
    ["launchctl unsetenv", /launchctl unsetenv/],
    ["reg delete of the env var", /reg delete[^\n]*NODE_EXTRA_CA_CERTS/],
    ["the Linux rc-file unsetter", /unsetLinuxNodeExtraCaCerts/],
    ["the per-IDE setting remover", /removeIdeCaTrust/],
  ])("the stop path contains no %s", (_label, pattern) => {
    expect(stopBody).not.toMatch(pattern);
  });

  it("the whole manager never imports the rc-file unsetter", () => {
    // Importing it is the first step back toward the old behaviour.
    expect(manager).not.toContain("unsetLinuxNodeExtraCaCerts");
  });
});

describe("trust is removed when the root CA is uninstalled", () => {
  it("uninstallCert removes the per-IDE settings", () => {
    expect(certInstall).toContain("removeIdeCaTrust");
    const i = certInstall.search(/function uninstallCert|const uninstallCert/);
    expect(i).toBeGreaterThan(-1);
    expect(certInstall.slice(i)).toContain("removeIdeCaTrust");
  });
});

describe("MITM is not hardcoded off anywhere", () => {
  it("no literal disable of the MITM feature", () => {
    for (const re of [
      /MITM_DISABLED\s*=\s*true/,
      /mitmEnabled\s*=\s*false\s*;\s*\/\/\s*(force|hardcode)/i,
      /return\s+false;\s*\/\/\s*MITM\s+disabled/i,
    ]) {
      expect(manager).not.toMatch(re);
    }
  });

  it("every intercepted tool is driven by config, not a constant", () => {
    const { MITM_TOOLS } = require("../../src/shared/constants/cliTools.js");
    const tools = Object.keys(MITM_TOOLS);
    expect(tools).toEqual(expect.arrayContaining(["antigravity", "claude", "kiro"]));
    for (const t of tools) {
      expect(typeof MITM_TOOLS[t].mitmDomain).toBe("string");
      expect(MITM_TOOLS[t].mitmDomain.length).toBeGreaterThan(0);
    }
  });
});
