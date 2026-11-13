/**
 * The CLI bundle must not delete API routes on the way into the package.
 *
 * build-cli.js copied the Next build into the published package through a
 * filter that matched on basename alone:
 *
 *   function shouldExclude(name) { ... return name === pattern; }
 *
 * One pattern is "logs", meaning a runtime log directory. Next compiles
 * `src/app/api/<x>/logs/route.js` to `server/app/api/<x>/logs/route.js` — a
 * directory named `logs`. The copy dropped it, every check stayed green, and
 * the published server threw on the first request:
 *
 *   Error: Cannot find module
 *   '.../app/.next-cli-build/server/app/api/pxpipe/logs/route.js'
 *   at Module._resolveFilename (node:internal/modules/cjs/loader)
 *
 * Diffing a local build against the installed 0.5.192 package found exactly
 * two casualties out of 188 routes:
 *
 *   ./api/pxpipe/logs/route.js    added in v0.5.111, broken ever since
 *   ./api/usage/logs/route.js     present since the initial release, so it
 *                                 has never shipped once, in any version
 *
 * Confirmed against the published 0.5.191 tarball: zero `logs` routes present,
 * against 304 other API files.
 *
 * Nothing compared the routes that exist against the routes that ship, which
 * is why a whole endpoint could be missing for the life of the project. These
 * tests do that comparison against the source tree, so a new route named after
 * a filtered word fails here rather than in a user's install.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  shouldExclude,
  isCompiledRouteDir,
  EXCLUDE_OUTSIDE_ROUTES,
} from "../../cli/scripts/exclude-patterns.js";

const API_DIR = path.join(process.cwd(), "src/app/api");

/** Every API route in the source tree, as the path segments Next will emit. */
function sourceRoutes(dir = API_DIR, prefix = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const next = `${prefix}/${e.name}`;
    if (fs.existsSync(path.join(dir, e.name, "route.js"))) out.push(next);
    out.push(...sourceRoutes(path.join(dir, e.name), next));
  }
  return out;
}

const routes = sourceRoutes();

describe("every API route survives the bundle filter", () => {
  it("found the routes to check", () => {
    // A rename that emptied this list would make the checks below vacuous.
    expect(routes.length).toBeGreaterThan(50);
  });

  it("keeps every segment of every route", () => {
    // Walks each route's directory chain the way copyRecursive does: the
    // segment is the entry name, its parent is the directory being copied.
    const dropped = [];
    for (const route of routes) {
      const segments = route.split("/").filter(Boolean);
      let dir = path.join(process.cwd(), ".next-cli-build/server/app/api");
      for (const segment of segments) {
        if (shouldExclude(segment, dir)) dropped.push(`${route} (segment "${segment}")`);
        dir = path.join(dir, segment);
      }
      if (shouldExclude("route.js", dir)) dropped.push(`${route} (route.js itself)`);
    }
    expect(dropped, `the bundle would ship without these:\n  ${dropped.join("\n  ")}`).toEqual([]);
  });

  it("still covers the two that were actually lost", () => {
    // Named explicitly: if the route tree is ever restructured, these must not
    // quietly stop being exercised.
    const dir = path.join(process.cwd(), ".next-cli-build/server/app/api/pxpipe");
    expect(shouldExclude("logs", dir), "/api/pxpipe/logs").toBe(false);
    expect(
      shouldExclude("logs", path.join(process.cwd(), ".next-cli-build/server/app/api/usage")),
      "/api/usage/logs"
    ).toBe(false);
  });
});

describe("the filter still does its job", () => {
  it("drops runtime artefacts outside the route output", () => {
    for (const name of EXCLUDE_OUTSIDE_ROUTES) {
      expect(shouldExclude(name, "/pkg/node_modules/whatever"), `${name} in node_modules`).toBe(true);
      expect(shouldExclude(name, "/pkg/app"), `${name} beside the app`).toBe(true);
    }
  });

  it("never ships the build's isolated HOME, wherever it appears", () => {
    // This one is a secret leak, not a missing feature: .build-home carried a
    // jwt-secret identical for every installer. It stays excluded everywhere,
    // route output included.
    for (const dir of ["/pkg/node_modules", "/pkg/.next-cli-build/server/app/api"]) {
      expect(shouldExclude(".build-home", dir)).toBe(true);
    }
    expect(shouldExclude("sharp", "/pkg/.next-cli-build/server/app/api")).toBe(true);
  });

  it("recognises route output, including its own top level", () => {
    expect(isCompiledRouteDir("/pkg/.next-cli-build/server/app/api/usage")).toBe(true);
    // A segment directly under server/app is still a route segment.
    expect(isCompiledRouteDir("/pkg/.next-cli-build/server/app")).toBe(true);
    expect(isCompiledRouteDir("/pkg/node_modules/next")).toBe(false);
    expect(isCompiledRouteDir("")).toBe(false);
  });
});

describe("build-cli.js uses the shared filter", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "cli/scripts/build-cli.js"), "utf8");

  it("passes the source directory, or route output cannot be spared", () => {
    expect(src, "the filter needs the directory, not just the name").toContain(
      "shouldExclude(entry.name, src)"
    );
  });

  it("has no second copy of the patterns to drift from", () => {
    expect(src).not.toContain("EXCLUDE_PATTERNS");
    expect(src, "the matcher lives in exclude-patterns.js now").not.toMatch(
      /function shouldExclude\s*\(/
    );
  });
});
