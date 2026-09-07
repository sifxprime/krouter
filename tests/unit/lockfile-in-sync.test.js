import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * The Docker build ran `npm install` with no lockfile in the build context, so every
 * build resolved the dependency graph fresh. v0.5.148 built cleanly and v0.5.149 failed
 * five days later with npm's arborist crashing on "Cannot read properties of null
 * (reading 'edgesOut')" — with no source change between the two tags beyond the version
 * string. A transitive dependency published in between was enough to break a release.
 *
 * The lockfile is committed and the build uses `npm ci`, so what gets installed is what
 * was pinned. These guard the arrangement: a lockfile that drifts out of sync with
 * package.json makes `npm ci` fail outright, which turns a silent supply-chain shift
 * into a loud, local one.
 */

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const cliPkg = JSON.parse(readFileSync("cli/package.json", "utf8"));
const cliLock = JSON.parse(readFileSync("cli/package-lock.json", "utf8"));

const tracked = new Set(execSync("git ls-files", { encoding: "utf8" }).split("\n"));

describe("lockfiles are committed", () => {
  it("tracks both lockfiles", () => {
    expect(tracked.has("package-lock.json")).toBe(true);
    expect(tracked.has("cli/package-lock.json")).toBe(true);
  });
});

describe("lockfiles match their package.json", () => {
  it("root version agrees", () => {
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
  });

  it("cli version agrees", () => {
    expect(cliLock.version).toBe(cliPkg.version);
  });

  it("root lockfile pins every declared dependency", () => {
    // npm ci fails hard on a missing entry; catching it here says which one.
    const declared = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
    const missing = declared.filter((d) => !lock.packages[`node_modules/${d}`]);
    expect(missing).toEqual([]);
  });
});

describe("the Docker build installs from the lockfile", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");

  it("copies the lockfile into the build context", () => {
    expect(dockerfile).toMatch(/COPY package\.json package-lock\.json/);
  });

  it("uses npm ci, not npm install", () => {
    expect(dockerfile).toMatch(/npm ci/);
    expect(dockerfile).not.toMatch(/^\s*&&\s*npm install\s*$/m);
  });

  it("keeps the npm pin that works around the arborist crash", () => {
    // node:22-alpine ships npm 10.9.x, which crashed on this graph.
    expect(dockerfile).toMatch(/npm install -g npm@11/);
  });
});
