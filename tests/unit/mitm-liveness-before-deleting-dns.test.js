/**
 * 0.5.173 — never delete a working DNS redirect because we failed to see the server.
 *
 * 0.5.171 added a watchdog that removes DNS redirects when MITM is down, because
 * redirects without a listener blackhole every intercepted host. The repair was right;
 * the liveness check feeding it was not.
 *
 * getMitmStatus decided `running` from an in-process handle plus the PID file. Both are
 * blind to a MITM server that outlives the app that spawned it — restart the app and
 * serverProcess is null while the real server, spawned through sudo and owned by root,
 * is still listening. `lsof` as an ordinary user cannot see a root-owned listener either,
 * which is the same blind spot that made a manual check report "MITM is down" while it
 * was demonstrably intercepting.
 *
 * So the watchdog read "DNS present + not running" as the blackhole and deleted live
 * redirects every 60 seconds. Observed on a real machine: antigravity and kiro confirmed
 * active and intercepting (TLS issuer = 9Router MITM Root CA) at 12:02; minutes later
 * /etc/hosts had no entries at all, the hosts resolved to the vendor again, and the IDEs
 * were quietly back on the vendor's own billing with MITM still "enabled" in the UI.
 *
 * A TCP connect does not care who owns the socket. Being wrong the other way is cheap:
 * we keep a redirect we could have cleaned and try again next tick.
 */
import { describe, it, expect } from "vitest";
import net from "node:net";
import { readFileSync } from "node:fs";

const manager = readFileSync("src/mitm/manager.js", "utf8");
const init = readFileSync("src/shared/services/initializeApp.js", "utf8");

describe("liveness is decided by the port, not only by a handle or a pid file", () => {
  it("getMitmStatus probes the port before declaring it down", () => {
    const i = manager.indexOf("async function getMitmStatus");
    expect(i).toBeGreaterThan(-1);
    const body = manager.slice(i, i + 2000);
    expect(body).toContain("isPortAccepting(");
    // and only as a fallback, after the cheaper checks
    expect(body.indexOf("PID_FILE")).toBeLessThan(body.indexOf("isPortAccepting("));
  });

  it("the probe is a TCP connect, which a root-owned listener cannot hide from", () => {
    const i = manager.indexOf("function isPortAccepting");
    const body = manager.slice(i, i + 900);
    expect(body).toContain("net.Socket");
    expect(body).toContain("connect(");
    // not lsof/ps, which is what was blind
    expect(body).not.toMatch(/lsof|execSync/);
  });

  it("the probe cannot hang the status call", () => {
    const body = manager.slice(manager.indexOf("function isPortAccepting"), manager.indexOf("function isPortAccepting") + 900);
    expect(body).toContain("setTimeout(");
    expect(body).toMatch(/timeoutMs\s*=\s*\d+/);
  });
});

describe("the probe behaves", () => {
  // Re-implemented here only to assert the semantics; the shipped copy is pinned above.
  const probe = (port) => new Promise((resolve) => {
    const s = new net.Socket();
    const done = (v) => { try { s.destroy(); } catch { /* ignore */ } resolve(v); };
    s.setTimeout(400);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
    s.connect(port, "127.0.0.1");
  });

  it("says true for a port that is accepting", async () => {
    const srv = net.createServer(() => {});
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    expect(await probe(port)).toBe(true);
    await new Promise((r) => srv.close(r));
  });

  it("says false once nothing is listening", async () => {
    const srv = net.createServer(() => {});
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    await new Promise((r) => srv.close(r));
    expect(await probe(port)).toBe(false);
  });
});

describe("the watchdog still only acts on a genuine blackhole", () => {
  it("it returns early while the server is running", () => {
    const body = init.slice(init.indexOf("async function healStaleMitmDns"));
    expect(body.slice(0, 1400)).toMatch(/if \(status\.running \|\| !status\.staleDns\) return false/);
  });
});
