import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const strip = (src) =>
  src.split("\n").filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

const guard = strip(readFileSync("src/dashboardGuard.js", "utf8"));

describe("LOCAL_ONLY_PATHS covers every privileged route", () => {
  // The list is documented as "routes that spawn child processes or read host secrets".
  // Three that plainly qualify were never added, so they fell back to the ordinary /api
  // gate, which is satisfied by a session rather than by being local.
  const cases = [
    ["/api/mitm/", "runs sudo against the OS trust store"],
    ["/api/pxpipe/", "shells out to npm install on the host"],
    ["/api/headroom/", "spawns a long-lived child process"],
  ];
  for (const [prefix, why] of cases) {
    it(`lists ${prefix} — ${why}`, () => {
      const list = guard.slice(guard.indexOf("LOCAL_ONLY_PATHS"), guard.indexOf("LOOPBACK_HOSTS"));
      expect(list).toContain(`"${prefix}"`);
    });
  }
});

describe("tunnel dashboard access", () => {
  it("is enforced on the dashboard API, not only the HTML routes", () => {
    // The host test lived inline inside the /dashboard branch, and /api/* returns
    // before reaching it. With requireLogin=false, isAuthenticated() is unconditionally
    // true, so /dashboard redirected over the tunnel while /api/keys served plaintext
    // API keys over the same public hostname.
    expect(guard).toContain("isTunnelDashboardBlocked");
    const apiBlock = guard.slice(guard.indexOf('pathname.startsWith("/api/")'));
    expect(apiBlock.slice(0, 600)).toContain("isTunnelDashboardBlocked");
  });

  it("checks the tunnel gate only after public paths, so /v1 still works", () => {
    // Blocking /v1 over the tunnel would defeat the reason the tunnel exists.
    const apiBlock = guard.slice(guard.indexOf('pathname.startsWith("/api/")'));
    const publicAt = apiBlock.indexOf("isPublicApi(pathname)");
    const gateAt = apiBlock.indexOf("isTunnelDashboardBlocked");
    expect(publicAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(publicAt);
  });

  it("treats a missing or unreadable setting as not-blocked, not as a lockout", () => {
    expect(guard).toMatch(/tunnelDashboardAccess === true\) return false/);
  });
});

describe("tunnel activation security gate", () => {
  for (const route of [
    "src/app/api/tunnel/enable/route.js",
    "src/app/api/tunnel/tailscale-enable/route.js",
  ]) {
    const src = strip(readFileSync(route, "utf8"));

    it(`${route.split("/").slice(-2)[0]} refuses while the dashboard is unsafe`, () => {
      // The interlock existed only in EndpointPageClient.js, so the CLI's
      // Settings -> Enable Tunnel produced a public URL with the default password.
      expect(src).toContain("tunnelSecurityBlock");
      expect(src).toContain("Security required");
      expect(src).toMatch(/status: 403/);
    });

    it(`${route.split("/").slice(-2)[0]} runs the gate before starting anything`, () => {
      const postAt = src.indexOf("export async function POST");
      const gateAt = src.indexOf("await tunnelSecurityBlock()", postAt);
      const startAt = Math.max(src.indexOf("enableTunnel()", postAt), src.indexOf("enableTailscale()", postAt));
      expect(gateAt).toBeGreaterThan(postAt);
      expect(startAt).toBeGreaterThan(gateAt);
    });

    it(`${route.split("/").slice(-2)[0]} does not call the gate from inside itself`, () => {
      // An earlier patch spliced the call into the helper's own try block, which is
      // unbounded recursion — the route answered with an empty body.
      const helperStart = src.indexOf("async function tunnelSecurityBlock");
      const helperEnd = src.indexOf("export async function POST");
      expect(src.slice(helperStart, helperEnd)).not.toContain("await tunnelSecurityBlock()");
    });
  }
});
