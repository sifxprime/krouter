/**
 * Every /api path the frontend fetches has a route handler behind it.
 *
 * Written because the Chat page never worked. BasicChatPageClient has posted to
 * /api/dashboard/chat/completions since it was written, and that route did not
 * exist anywhere -- not in a release, not in git history. Every send returned
 * 404, rendered in the UI as "Request failed (404)". 0.5.193 put the page in the
 * nav, which made it reachable and still not functional.
 *
 * Nothing could have caught it. The page compiles, the route list is correct,
 * the suite is green: the caller and the callee are just two strings that were
 * never compared. This compares them.
 *
 * It is the same family as the bundle filter that dropped /api/*\/logs in
 * 0.5.194 -- a route that exists in one artifact and not in the one that runs --
 * except here the route was never written at all.
 *
 * Matching follows Next's own rule: a path matches a registered route, with
 * `[seg]` covering one segment and `[...seg]` covering the rest. Deliberately
 * NOT a per-segment filesystem walk -- that reports /api/oauth/codex/stop-proxy
 * as missing, because a literal `codex/` directory exists beside the
 * `[provider]/[action]` route that actually serves it. Next matches whole paths
 * against the route set, so this does too.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { trackedSourceFiles } from "../helpers/tracked-sources.js";

const APP_PREFIX = "src/app/";

/** `fetch("/api/...")` / `fetch(`/api/...`)` — the literal paths only. */
const FETCH_CALL = /fetch\(\s*[`"']\s*(\/api\/[^`"'\s)]*)/g;

function registeredRoutes(files) {
  const routes = [];
  for (const f of files) {
    if (!/^src\/app\/(.*\/)?route\.(js|ts)$/.test(f)) continue;
    const url = "/" + f.slice(APP_PREFIX.length).replace(/\/route\.(js|ts)$/, "");
    // (group) folders organise files without appearing in the URL.
    routes.push(url.replace(/\/\([^)]+\)/g, ""));
  }
  return routes;
}

function toMatcher(route) {
  const body = route
    .replace(/^\//, "")
    .split("/")
    .map((seg) => {
      if (/^\[\.\.\..+\]$/.test(seg)) return ".+";
      if (/^\[.+\]$/.test(seg)) return "[^/]+";
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^/${body}$`);
}

describe("every /api path the frontend fetches has a route", () => {
  it("no fetch targets a route that does not exist", () => {
    const files = trackedSourceFiles(["src"], { absolute: false });

    const routes = registeredRoutes(files);
    const exact = new Set(routes.filter((r) => !r.includes("[")));
    const dynamic = routes.filter((r) => r.includes("[")).map(toMatcher);

    // A scan that has stopped seeing things reports no problems, which is the
    // failure this whole area keeps producing. Assert it found a real codebase.
    expect(routes.length, "found almost no API routes — the scan is broken").toBeGreaterThan(100);

    const missing = [];
    let fetchCount = 0;
    for (const f of files) {
      // The API routes are the callees; only callers are interesting here.
      if (!f.endsWith(".js") && !f.endsWith(".jsx")) continue;
      if (f.startsWith("src/app/api/")) continue;

      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(FETCH_CALL)) {
        fetchCount += 1;
        const raw = m[1].split("?")[0].replace(/\/$/, "");
        // `${id}` is one segment at runtime, so compare it as one.
        const normalised = raw.replace(/\$\{[^}]*\}/g, "X");
        const ok = exact.has(normalised) || dynamic.some((rx) => rx.test(normalised));
        if (!ok) missing.push(`${normalised}  (fetched in ${f})`);
      }
    }

    expect(fetchCount, "found no frontend fetches — the scan is broken").toBeGreaterThan(50);

    expect(
      [...new Set(missing)].sort(),
      "the frontend fetches these and nothing serves them, so they 404 at runtime",
    ).toEqual([]);
  });
});
