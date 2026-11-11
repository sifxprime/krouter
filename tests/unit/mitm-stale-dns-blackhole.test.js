/**
 * 0.5.171 — DNS redirects must never outlive the server that answers them.
 *
 * The redirects are what make MITM work and what breaks the machine when the server
 * is gone: every redirected host resolves to 127.0.0.1, and with nothing on :443 the
 * request does not fall back to the real vendor, it fails to connect. A clean stop
 * removes them (server.js shutdown -> removeAllDNSEntriesSync, which works because the
 * MITM server runs as root). A SIGKILL, crash, force-quit or power cut does not.
 *
 * Reproduced on a real machine:
 *   kill -9 <mitm pid>
 *   :443 listener        0
 *   hosts entries left   5
 *   curl daily-cloudcode-pa.googleapis.com -> Couldn't connect to server
 *   curl runtime.us-east-1.kiro.dev        -> Couldn't connect to server
 *
 * Two defects made this stick:
 *   1. the repair ran ONLY at app startup, so a crash meant no provider traffic until
 *      the user worked out why and restarted kRouter;
 *   2. it called removeAllDNSEntries() with NO password, so it needed a passwordless
 *      sudo. On a machine with a normal sudo it silently did nothing — precisely the
 *      machines that get stuck — and the user was told to run a sed command by hand.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/shared/services/initializeApp.js", "utf8");
const server = readFileSync("src/mitm/server.js", "utf8");
const dns = readFileSync("src/mitm/dns/dnsConfig.js", "utf8");

describe("a clean stop already removes the redirects", () => {
  it("the MITM server strips them in its own shutdown", () => {
    const i = server.indexOf("const shutdown");
    expect(i).toBeGreaterThan(-1);
    expect(server.slice(i, i + 500)).toContain("removeAllDNSEntriesSync()");
  });

  it("that path needs no sudo, because the server runs as root", () => {
    const i = dns.indexOf("function removeAllDNSEntriesSync");
    const body = dns.slice(i, i + 800);
    expect(body).toContain("writeFileSync");
    expect(body).not.toContain("sudo");
  });
});

describe("a crash is repaired without waiting for a restart", () => {
  it("the watchdog checks for stale DNS on every tick", () => {
    const i = src.indexOf("g.watchdogInterval = setInterval");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 400)).toContain("healStaleMitmDns(");
  });

  it("the healer only acts when the server is really gone", () => {
    const i = src.indexOf("async function healStaleMitmDns");
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, i + 1400);
    // Never remove redirects out from under a running server.
    expect(body).toMatch(/if \(status\.running \|\| !status\.staleDns\) return false/);
  });

  it("it verifies the removal instead of trusting the call", () => {
    const body = src.slice(src.indexOf("async function healStaleMitmDns"));
    expect(body.slice(0, 1400)).toContain("const after = await getMitmStatus()");
  });
});

describe("the repair supplies the sudo password it already has", () => {
  it.each([
    ["the watchdog healer", "async function healStaleMitmDns"],
    ["the startup repair", "MITM is DOWN but DNS redirects are still active"],
  ])("%s passes a password to removeAllDNSEntries", (_label, anchor) => {
    const i = src.indexOf(anchor);
    expect(i).toBeGreaterThan(-1);
    const body = src.slice(i, i + 1600);
    const call = body.match(/removeAllDNSEntries\(([^)]*)\)/);
    expect(call, "removeAllDNSEntries call not found").toBeTruthy();
    // The bug was an empty argument list.
    expect(call[1].trim()).not.toBe("");
    expect(body).toContain("loadEncryptedPassword");
  });

  it("removeAllDNSEntries does take a password", () => {
    expect(dns).toMatch(/async function removeAllDNSEntries\(sudoPassword\)/);
  });
});
