/**
 * What the CLI bundle must not copy — and, just as importantly, where.
 *
 * This lived inline in build-cli.js as one flat list matched against a bare
 * basename:
 *
 *   function shouldExclude(name) { ... return name === pattern; }
 *
 * One of those patterns is "logs", meaning a runtime log directory. Next
 * compiles an API route at `src/app/api/<x>/logs/route.js` to
 * `server/app/api/<x>/logs/route.js` — a directory named `logs`. So the copy
 * step deleted the route on its way into the package, the build stayed green,
 * and the published server threw on the first request to it:
 *
 *   Error: Cannot find module
 *   '.../app/.next-cli-build/server/app/api/pxpipe/logs/route.js'
 *
 * Two routes were affected. `/api/usage/logs` has existed since the initial
 * release and therefore never shipped once, in any version; `/api/pxpipe/logs`
 * broke when it was added in v0.5.111. Confirmed against the published
 * 0.5.191 tarball: zero of them present, against 304 other API routes.
 *
 * The names are split by where they are safe to apply. A generic word like
 * `logs` or `tmp` is a runtime artefact at the top of a package and a legitimate
 * URL segment inside compiled route output, so it cannot be matched in both
 * places by the same rule.
 */

const path = require("node:path");

/** Safe to drop wherever they appear: nothing here is ever a route segment. */
const EXCLUDE_ANYWHERE = [
  "@img", // Sharp image processing (not needed with unoptimized images)
  "sharp", // Sharp core lib (not needed with unoptimized images)
  "detect-libc", // Sharp dependency
  ".env", // Environment files
  ".env.local",
  ".env.*.local",
  "*.log", // Log files
  ".DS_Store", // macOS files
  // The Next build runs with HOME pointed at cli/.build-home so it cannot touch
  // the real ~/.krouter. Because that directory sits inside the workspace,
  // standalone tracing copied it into the bundle, and the package shipped a
  // generated jwt-secret, a machine-id and five SQLite databases -- the
  // jwt-secret identical for everyone who installed it. Never copy it.
  ".build-home",
  "*.nft.json", // Next trace manifests: build metadata, ~2.7 MB, unused at runtime
];

/**
 * Runtime artefacts whose names are ordinary words. Dropped everywhere EXCEPT
 * inside Next's compiled route output, where the same word is a URL segment.
 */
const EXCLUDE_OUTSIDE_ROUTES = [
  "logs", // Runtime logs -- and /api/pxpipe/logs, /api/usage/logs
  "tmp", // Temp files
];

/** Next emits compiled route handlers under `<dist>/server/app/...`. */
const COMPILED_ROUTES = `${path.sep}server${path.sep}app${path.sep}`;

/**
 * Is `srcDir` inside Next's compiled route output?
 *
 * The trailing separator matters: a directory that IS `server/app` holds route
 * segments as its immediate children, so `server/app/logs` must be protected
 * too.
 */
function isCompiledRouteDir(srcDir) {
  if (!srcDir) return false;
  return (path.resolve(srcDir) + path.sep).includes(COMPILED_ROUTES);
}

function matches(name, pattern) {
  if (pattern.includes("*")) {
    const regex = new RegExp(
      "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
    );
    return regex.test(name);
  }
  return name === pattern;
}

/**
 * @param {string} name     the entry's basename
 * @param {string} [srcDir] the directory being copied, so route output is spared
 */
function shouldExclude(name, srcDir = "") {
  if (EXCLUDE_ANYWHERE.some((p) => matches(name, p))) return true;
  if (isCompiledRouteDir(srcDir)) return false;
  return EXCLUDE_OUTSIDE_ROUTES.some((p) => matches(name, p));
}

module.exports = {
  EXCLUDE_ANYWHERE,
  EXCLUDE_OUTSIDE_ROUTES,
  COMPILED_ROUTES,
  isCompiledRouteDir,
  shouldExclude,
};
