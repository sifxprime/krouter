/**
 * Starting or stopping MITM moves both capture transports.
 *
 * They were independent, and the states that produced were worse than having
 * either one off. The proxy is spawned detached and unref'd so it outlives the
 * app: stop MITM, or kill the app, and the proxy kept listening on 20129 with
 * nothing behind it. Measured in exactly that state on a real machine —
 *
 *   router on 20128: DOWN | proxy on 20129: UP
 *   /_krouter_proxy_health -> {"ok":true,"pid":21535,"mode":"proxy","port":20129}
 *   intercepted request    -> HTTP 500 {"error":{"message":"fetch failed"}}
 *   proxy.log              -> ❌ [MITM] [claude] fetch failed
 *
 * — so anything pointed at HTTPS_PROXY failed, the health check said everything
 * was fine, and it presented as a network fault. The reported workaround was to
 * keep both on or both off by hand, which is what this makes automatic.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mgr = fs.readFileSync(path.join(process.cwd(), "src/mitm/manager.js"), "utf8");
const proxy = fs.readFileSync(path.join(process.cwd(), "src/mitm/proxy.js"), "utf8");

/** A function body from manager.js, comments stripped. */
function body(name) {
  const start = mgr.indexOf(`async function ${name}(`);
  expect(start, `${name} is gone`).toBeGreaterThan(-1);
  // To the next top-level declaration, which is close enough for these checks.
  const next = mgr.indexOf("\nasync function ", start + 1);
  const raw = mgr.slice(start, next === -1 ? undefined : next);
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("one switch for both transports", () => {
  it("starts the proxy on every success path of startServer", () => {
    const src = body("startServer");
    // Two paths return success: a fresh start, and reusing a server that was
    // already up. A MITM that was already running can still be missing its
    // proxy, so the toggle has to converge both.
    const returns = src.match(/return \{ running: true/g) || [];
    expect(returns.length, "expected both success paths").toBe(2);
    const starts = src.match(/startProxyWithMitm\(/g) || [];
    expect(starts.length, "every success path must bring the proxy up").toBe(returns.length);
  });

  it("stops the proxy when MITM stops", () => {
    const src = body("stopServer");
    expect(src, "stopServer must take the proxy down with it").toContain("stopProxyWithMitm(");
  });

  it("takes the proxy down before tearing MITM down", () => {
    // Not cosmetic: the bad state is a proxy listening with nothing behind it,
    // so it should be the first thing to go, not the last.
    const src = body("stopServer");
    expect(src.indexOf("stopProxyWithMitm(")).toBeLessThan(src.indexOf("killProcess("));
  });

  it("never lets a proxy failure fail a MITM start", () => {
    // The :443 transport is useful on its own. A proxy that will not come up
    // must not turn a successful toggle into an error.
    for (const name of ["startProxyWithMitm", "stopProxyWithMitm"]) {
      const start = mgr.indexOf(`async function ${name}(`);
      expect(start, `${name} is gone`).toBeGreaterThan(-1);
      const fn = mgr.slice(start, mgr.indexOf("\n}", start));
      expect(fn, `${name} must swallow its own errors`).toMatch(/catch\s*\(/);
    }
  });
});

describe("the proxy's health check", () => {
  it("reports its upstream, not its own socket", () => {
    // It answered {"ok":true} while every intercepted request failed, because
    // "ok" meant "the port is open".
    const start = proxy.indexOf("req.url === HEALTH_PATH");
    const block = proxy.slice(start, start + 1800);
    expect(block, "health must probe the router it forwards to").toContain("MITM_ROUTER_BASE");
    expect(block, "and report it").toContain("routerReachable");
    expect(block, "an unreachable upstream is not a 200").toContain("503");
    expect(block, "ok must follow the upstream").toMatch(/ok:\s*routerReachable/);
  });

  it("probes with a timeout so health cannot hang", () => {
    const start = proxy.indexOf("req.url === HEALTH_PATH");
    const block = proxy.slice(start, start + 1800);
    expect(block).toMatch(/AbortSignal\.timeout\(\s*\d+\s*\)/);
  });

  it("awaits inside an async request handler", () => {
    // The handler was a plain arrow function; adding the probe without making it
    // async is a syntax error that only shows up when the proxy is spawned.
    expect(proxy).toMatch(/http\.createServer\(async \(req, res\) =>/);
  });
});

describe("the dashboard offers one control, not two", () => {
  const CARD = "src/app/(dashboard)/dashboard/cli-tools/components/MitmToolCard.js";
  const card = fs.readFileSync(path.join(process.cwd(), CARD), "utf8");

  it("has no separate start/stop for proxy capture", () => {
    // Coupling the lifecycle in manager.js was only half the fix: the card still
    // rendered its own "Proxy capture · Start/Stop", so the two transports could
    // be driven apart again from the UI, and they still looked like independent
    // things. The MITM server owns both now.
    const code = card.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "the UI must not drive the proxy independently").not.toContain("proxy-start");
    expect(code, "the UI must not drive the proxy independently").not.toContain("proxy-stop");
    expect(code, "the toggle handler should be gone with it").not.toContain("toggleProxy");
  });

  it("still shows the state and the address, which are useful", () => {
    // Removing the control should not remove the information: nothing can point
    // an already-running app at the proxy, so the address has to be copyable.
    expect(card).toContain("Proxy capture");
    expect(card, "the HTTPS_PROXY line is the only way to use this transport").toContain("HTTPS_PROXY=");
    expect(card, "and it should say what drives it").toMatch(/[Ff]ollows the MITM server/);
  });

  it("leaves no dead proxy-control props behind", () => {
    // onProxyChange existed only to feed the removed button.
    const refs = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules" && e.name !== ".next") walk(full);
          continue;
        }
        if (/\.(js|jsx)$/.test(e.name) && fs.readFileSync(full, "utf8").includes("onProxyChange")) {
          refs.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(refs, `dead prop still referenced in: ${refs.join(", ")}`).toEqual([]);
  });
});
