import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { describeSudoFailure } = require("../../src/mitm/cert/install.js");

/**
 * installCertMac collapsed every failure into the single string "Certificate install
 * failed". A user hit it after mistyping their sudo password and reasonably concluded
 * the certificate was broken -- the one thing the message did not say was "retype your
 * password". The stderr that would have told them was captured and then discarded.
 *
 * These are the real stderr strings, captured by running the actual command:
 *   sudo -S sh -c 'security delete-certificate ... && security add-trusted-cert ...'
 */
describe("cert install error messages", () => {
  it("names a wrong sudo password instead of blaming the certificate", () => {
    const real = "Password:Sorry, try again.\nPassword:\nsudo: no password was provided\nsudo: 1 incorrect password attempt\n";
    const msg = describeSudoFailure(new Error(real));
    expect(msg).toMatch(/incorrect sudo password/i);
    expect(msg).not.toBe("Certificate install failed");
  });

  it("recognises an empty password separately from a wrong one", () => {
    const msg = describeSudoFailure(new Error("sudo: no password was provided\n"));
    expect(msg).toMatch(/incorrect sudo password/i);
  });

  it("still reports a user cancellation as a cancellation", () => {
    expect(describeSudoFailure(new Error("The authorization was canceled by the user")))
      .toBe("User canceled authorization");
  });

  it("explains a non-sudoer account rather than showing a raw sudo error", () => {
    const msg = describeSudoFailure(new Error("user is not in the sudoers file. This incident will be reported."));
    expect(msg).toMatch(/not permitted to use sudo/i);
  });

  it("passes an unrecognised failure through with its real detail attached", () => {
    const msg = describeSudoFailure(new Error("SecTrustSettingsSetTrustSettings: The authorization was denied."));
    expect(msg).toMatch(/^Certificate install failed: /);
    expect(msg).toContain("SecTrustSettingsSetTrustSettings");
  });

  it("strips sudo's prompt noise out of the surfaced detail", () => {
    const msg = describeSudoFailure(new Error("Password:some real failure here\n"));
    expect(msg).not.toContain("Password:");
    expect(msg).toContain("some real failure here");
  });

  it("falls back to the generic message when there is nothing to report", () => {
    expect(describeSudoFailure(new Error(""))).toBe("Certificate install failed");
    expect(describeSudoFailure(null)).toBe("Certificate install failed");
  });
});
