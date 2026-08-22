import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * The published CLI runs app/custom-server.js as its entry point. Anything that
 * file requires relatively must be copied into the package by
 * cli/scripts/build-cli.js — Next's standalone output does not include it,
 * because custom-server.js is not part of the app graph.
 *
 * v0.5.143 shipped without server-peer-patch.js and crash-looped on every start:
 *   Cannot find module './server-peer-patch.js'
 * That was invisible to every check that inspected the tarball's contents
 * without executing it.
 */

const ROOT = process.cwd();

function relativeRequiresOf(file) {
  const src = readFileSync(path.join(ROOT, file), "utf8");
  return [...src.matchAll(/require\(\s*["'](\.\/[^"']+)["']\s*\)/g)]
    .map((m) => m[1].replace(/^\.\//, ""))
    // server.js is emitted by the Next standalone build, not copied by us.
    .filter((n) => n !== "server.js");
}

function entryFilesCopiedByBuild() {
  const src = readFileSync(path.join(ROOT, "cli/scripts/build-cli.js"), "utf8");
  const m = src.match(/const ENTRY_FILES\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

describe("published CLI ships everything its entry point requires", () => {
  it("custom-server.js is itself copied", () => {
    expect(entryFilesCopiedByBuild()).toContain("custom-server.js");
  });

  it("every relative require of custom-server.js is copied by the build", () => {
    const copied = entryFilesCopiedByBuild();
    const missing = relativeRequiresOf("custom-server.js").filter((dep) => !copied.includes(dep));
    expect(
      missing,
      "cli/scripts/build-cli.js ENTRY_FILES is missing these, so the packaged " +
        "CLI will crash-loop on start with MODULE_NOT_FOUND",
    ).toEqual([]);
  });

  it("every file the build claims to copy actually exists in the repo", () => {
    for (const name of entryFilesCopiedByBuild()) {
      expect(existsSync(path.join(ROOT, name)), `${name} is listed but absent`).toBe(true);
    }
  });
});
