/**
 * Every source file is valid JavaScript to Node.
 *
 * Written because the suite went green over a file Node refuses to load. A
 * commit added `import { execFileSync } from "node:child_process"` to a test
 * that already imported it two lines above, and:
 *
 *     SyntaxError: Identifier 'execFileSync' has already been declared
 *         at checkSyntax (node:internal/main/check_syntax:72:5)
 *
 * Vitest reported 24/24 on that file, and CI agreed, because esbuild's
 * transform merges the two declarations before V8 ever sees them. So the thing
 * being measured was esbuild's output and the thing that has to run is Node's
 * input, and nothing in the repo compared them.
 *
 * `node --check` is the only tool here that parses a file the way the runtime
 * will. Not esbuild, which is what hid it; not a linter, which has its own
 * parser and its own opinions.
 *
 * Cost is about eight seconds -- one process per file, bounded concurrency.
 * That is real, and worth it for a class of defect that reaches main looking
 * green on two separate checks.
 *
 * Measured safe on every runtime in play before being added: Node 22.11,
 * 22.21, 24.14 and 26.0 each parse all of these cleanly and each reject the
 * duplicate import above. The root package.json has no "type", so ESM under
 * src/ is a CommonJS parse on paper -- Node reparses on detected module
 * syntax, so it is clean there too. No version caveat applies.
 */
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { trackedSourceFiles } from "../helpers/tracked-sources.js";

const run = promisify(execFile);

// node --check parses JavaScript, so this filter is here for .ts/.tsx/.jsx.
// Today it narrows the set by nothing: all 941 tracked source files under
// these roots are .js/.mjs/.cjs, and the project has no TypeScript anywhere --
// no tsc, no typecheck script, nothing in CI.
//
// Which means the first .ts anyone adds leaves this guard silently, and what
// catches it then depends on where it lands. `next build` runs in CI and would
// parse a .tsx under src/. A .ts under scripts/ or tests/ would be handled by
// esbuild, which is precisely the transform that hid the defect this test was
// written for.
//
// Left as a known gap rather than a tripwire: guarding a file type the project
// does not use is speculative. It is written down here instead, because the
// previous version of this comment said TypeScript was someone else's job and
// implied that someone was doing it.
const PARSEABLE = /\.(js|mjs|cjs)$/;
const ROOTS = ["src", "cli", "scripts", "tests"];

// One `node` process per file, so some limit is needed. Eight and sixteen
// measured within a second of each other, so the ceiling is process startup
// rather than the machine; eight leaves the box usable while the suite runs.
const CONCURRENCY = 8;

/** @param {string[]} items @param {(item: string) => Promise<unknown>} work */
async function mapWithLimit(items, work) {
  const queue = [...items];
  const results = [];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      results.push(await work(next));
    }
  });
  await Promise.all(workers);
  return results;
}

describe("every source file is valid JavaScript to Node", () => {
  it(
    "node --check accepts all of them",
    async () => {
      const files = trackedSourceFiles(ROOTS, { extensions: PARSEABLE });

      // A scan that stops seeing files passes quietly, so assert it found a
      // plausible number before trusting that it found no problems.
      expect(files.length, "the source scan returned almost nothing").toBeGreaterThan(500);

      const failures = await mapWithLimit(files, async (file) => {
        try {
          await run(process.execPath, ["--check", file]);
          return null;
        } catch (e) {
          const detail = String(e.stderr || e.message)
            .split("\n")
            .find((l) => /Error/.test(l));
          return `${path.relative(process.cwd(), file)}: ${detail ?? "failed to parse"}`;
        }
      });

      expect(
        failures.filter(Boolean).sort(),
        "these parse under esbuild but not under Node, so the suite can pass while the runtime cannot load them",
      ).toEqual([]);
    },
    60_000, // ~8s in practice; the default 5s would fail on timing alone
  );
});
