import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Replacing ssrfGuard.js with the hardened version is only half the port. It gains two
 * new functions, and the literal-only assertPublicUrl remains exported and unchanged —
 * so a call site that keeps using it stays vulnerable to the two classes the literal
 * checks cannot see:
 *
 *   - DNS: 127.0.0.1.nip.io passes every literal check and resolves to loopback.
 *     Confirmed against the ported guard: assertPublicUrl ALLOWED it,
 *     assertPublicUrlResolved blocked it.
 *   - Redirects: fetch() defaults to redirect:"follow", so a URL that passed the guard
 *     can 30x into loopback or the metadata range with only the first hop checked.
 *
 * The first port of this landed with the guard swapped and neither call site updated,
 * which read as "SSRF fixed" while both holes were open. These assert the wiring.
 */

describe("SSRF guards are wired into the call sites", () => {
  it("the client-supplied fetch handler resolves DNS before allowing a URL", () => {
    const src = readFileSync("src/sse/handlers/fetch.js", "utf8");
    expect(src).toContain("assertPublicUrlResolved");
    expect(src).toMatch(/await assertPublicUrlResolved\(targetUrl\)/);
    // The literal-only check must not be what guards this path.
    expect(src).not.toMatch(/^\s*assertPublicUrl\(targetUrl\);/m);
  });

  it("the search fetch validates redirects instead of following them blindly", () => {
    const src = readFileSync("open-sse/handlers/search/index.js", "utf8");
    expect(src).toContain("fetchPublic");
    expect(src).toMatch(/const resp = await fetchPublic\(url,/);
    expect(src).not.toMatch(/const resp = await fetch\(url,/);
  });

  it("the hardened guard still exports all three entry points", () => {
    const src = readFileSync("src/shared/utils/ssrfGuard.js", "utf8");
    for (const fn of ["assertPublicUrl", "assertPublicUrlResolved", "fetchPublic"]) {
      expect(src).toMatch(new RegExp(`export (async )?function ${fn}\\b`));
    }
  });
});

describe("the guard itself", () => {
  it("blocks a hostname that only resolves to loopback", async () => {
    const { assertPublicUrl, assertPublicUrlResolved } = await import(
      "../../src/shared/utils/ssrfGuard.js"
    );
    // Pins the exact gap: the literal check cannot see this, the resolving one can.
    expect(() => assertPublicUrl("http://127.0.0.1.nip.io/")).not.toThrow();
    await expect(assertPublicUrlResolved("http://127.0.0.1.nip.io/")).rejects.toThrow();
  });
});
