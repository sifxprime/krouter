/**
 * The project's source files, as git defines them.
 *
 * Two tests need to walk "all our source", and a filesystem walk cannot answer
 * that question: it has to be told which generated trees to skip, and the list
 * is never complete. `cli/app` -- the staging copy of the whole app, with its
 * compiled Next output under `.next-cli-build` -- was missing from one, which
 * made a scan report twenty bundles as drifting source on any machine that had
 * run the CLI build. Adding that one path left `cli/.build-home` behind it,
 * generated and ignored and inside the same reach, harmless only because it
 * happens to hold no `.js`.
 *
 * git already knows. `--cached --others --exclude-standard` is tracked files
 * plus new ones that are not ignored: a brand-new file is still checked before
 * it is staged, and nothing ignored is ever returned. On a clean checkout this
 * agrees exactly with the walk it replaced; on a built machine it returns 547
 * where the walk returned 1247.
 *
 * Lives here rather than in one of the two tests so there is one copy. The
 * release this was written for removed eight hand-kept copies of a function
 * for exactly that reason.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

const SOURCE_EXTENSIONS = /\.(js|mjs|cjs|jsx|ts|tsx)$/;

/**
 * @param {string[]} roots directories to list, relative to the repo root
 * @param {{ extensions?: RegExp, absolute?: boolean }} [options]
 *   `extensions` narrows the filter (for example to what `node --check` parses);
 *   `absolute` returns resolved paths rather than repo-relative ones.
 * @returns {string[]}
 */
export function trackedSourceFiles(roots, { extensions = SOURCE_EXTENSIONS, absolute = true } = {}) {
  let listing;
  try {
    listing = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...roots],
      { encoding: "utf8" },
    );
  } catch (cause) {
    // Deliberately no filesystem fallback. The walk is the thing being removed,
    // and a fallback carrying its bug would fire exactly where nobody is looking.
    throw new Error(
      `these checks define "source" as what git tracks, and git could not be run here: ${cause.message}`,
    );
  }

  const files = listing.split("\0").filter((f) => extensions.test(f));
  return absolute ? files.map((f) => path.resolve(f)) : files;
}

export { SOURCE_EXTENSIONS };
