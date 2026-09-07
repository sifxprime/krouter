import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Next.js middleware runs BEFORE rewrites, so dashboardGuard sees the literal request
 * path. A root-level rewrite whose top-level prefix is absent from PUBLIC_PREFIXES
 * matches no branch of the guard -- not isPublicLlmApi, not the /api/* deny-by-default,
 * not /dashboard -- and falls through with no auth at all, then gets rewritten to its
 * destination.
 *
 * That is exactly what happened to /codex, which rewrites to /api/v1/responses. From
 * off-machine with no credentials, POST /v1/responses returned 401 while
 * POST /codex/responses returned 200 and a real streaming completion, spending provider
 * quota. Being listed in PUBLIC_PREFIXES is what routes a path into
 * canAccessPublicLlmApi, which is what demands the key from a remote caller.
 *
 * This test asserts the invariant rather than the single fix: every root-level rewrite
 * source must have its top-level prefix guarded.
 */

const config = readFileSync("next.config.mjs", "utf8");
const guard = readFileSync("src/dashboardGuard.js", "utf8");

const publicPrefixes = (() => {
  const m = guard.match(/const PUBLIC_PREFIXES = \[([^\]]+)\]/);
  if (!m) throw new Error("PUBLIC_PREFIXES not found in dashboardGuard.js");
  return m[1].split(",").map((x) => x.trim().replace(/["']/g, "")).filter(Boolean);
})();

/** Top-level segment of every rewrite `source:` in the Next config. */
const rewriteRoots = (() => {
  const roots = new Set();
  const re = /source:\s*["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = re.exec(config))) {
    roots.add("/" + m[1].replace(/^\//, "").split("/")[0]);
  }
  return [...roots];
})();

const isGuarded = (root) =>
  root.startsWith("/api") || publicPrefixes.some((p) => root === p || root.startsWith(`${p}/`));

describe("rewrite prefixes are reachable by the guard", () => {
  it("finds the rewrites and the prefix list", () => {
    expect(rewriteRoots.length).toBeGreaterThan(0);
    expect(publicPrefixes.length).toBeGreaterThan(0);
  });

  it("guards every root-level rewrite source", () => {
    const unguarded = rewriteRoots.filter((r) => !isGuarded(r));
    expect(unguarded).toEqual([]);
  });

  it("still lists /codex specifically", () => {
    // The one that was actually exploitable; keep it pinned by name.
    expect(publicPrefixes).toContain("/codex");
  });

  it("keeps the LLM API prefixes listed", () => {
    for (const p of ["/v1", "/v1beta", "/api/v1", "/api/v1beta"]) {
      expect(publicPrefixes).toContain(p);
    }
  });
});
