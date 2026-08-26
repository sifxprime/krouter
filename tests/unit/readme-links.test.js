import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * README.md linked docs/REDACTION_SETUP.md four times and cli/README.md four more,
 * but .gitignore excluded docs/* -- so the file existed locally, was never pushed,
 * and every one of those links 404'd for anyone reading the project on GitHub.
 * Nothing failed, because a file present on the author's disk looks fine locally.
 *
 * cli/README.md ships inside the npm tarball, whose `files` list carries no docs/
 * directory, so a relative link there cannot resolve on npmjs.com even once the
 * file is tracked. It has to be an absolute URL.
 */

const LINK = /\]\(([^)]+)\)/g;
const isExternal = (t) => /^(https?:|mailto:|#)/.test(t);

const tracked = new Set(
  execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean)
);

/** Relative link targets in a markdown file, minus anchors and query strings. */
function localTargets(file) {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(LINK)]
    .map((m) => m[1].trim())
    .filter((t) => !isExternal(t))
    .map((t) => t.split("#")[0].split("?")[0])
    .filter(Boolean);
}

describe("README links", () => {
  it("README.md links only to files that are committed", () => {
    const broken = localTargets("README.md").filter(
      (t) => !existsSync(t) || !tracked.has(t)
    );
    expect(broken).toEqual([]);
  });

  it("cli/README.md links relatively only to files the npm tarball ships", () => {
    // A relative link is fine when the target travels with the package -- LICENSE does.
    // docs/ does not, which is why those four links had to become absolute URLs.
    const npmFiles = JSON.parse(readFileSync("cli/package.json", "utf8")).files || [];
    const shipped = (t) => npmFiles.some((f) => t === f || t.startsWith(`${f}/`));

    const unreachable = localTargets("cli/README.md").filter((t) => !shipped(t));
    expect(unreachable).toEqual([]);
  });

  it("keeps docs/REDACTION_SETUP.md tracked despite the docs/* ignore rule", () => {
    expect(tracked.has("docs/REDACTION_SETUP.md")).toBe(true);
  });
});
