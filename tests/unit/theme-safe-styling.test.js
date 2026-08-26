import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * The Providers page styled a button `!bg-white !text-black`. Because Tailwind's `!`
 * compiles to `!important`, the dark theme could not override it and the button
 * rendered stark white on a dark page. Utilities that force a literal colour are
 * unthemeable by construction; the variant system already supplies theme-aware
 * equivalents (`secondary` = bg-surface-2 / text-text-main / border-border).
 */

const files = execSync(
  "git ls-files 'src/**/*.js' | grep -E '(dashboard|shared)' || true",
  { encoding: "utf8" }
).split("\n").filter(Boolean);

// `!important` on a hardcoded light or dark colour -- the combination that locks a
// theme out. Non-important utilities are fine: a theme can still override them.
const FORCED_COLOR = /!(?:bg|text|border)-(?:white|black|gray-\d{2,3}|slate-\d{2,3}|zinc-\d{2,3})\b/;

describe("theme-safe styling", () => {
  it("has no !important hardcoded colours in dashboard or shared UI", () => {
    const offenders = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      src.split("\n").forEach((line, i) => {
        const m = line.match(FORCED_COLOR);
        if (m) offenders.push(`${f}:${i + 1}  ${m[0]}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
