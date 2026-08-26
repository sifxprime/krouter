import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * The type-hierarchy pass set secondary text to `text-text-muted/80`. The size step
 * (15px title / 13px body) already carried the de-emphasis; the alpha was redundant and
 * it pushed an already-marginal token under WCAG AA:
 *
 *   text-muted      on light bg      4.65  PASS
 *   text-muted/80   on light bg      3.20  FAIL
 *   text-muted/80   on light surface 3.28  FAIL
 *   text-muted/80   on dark surface  4.36  FAIL
 *
 * --color-text-muted (#6B7280 light, #9ca3af dark) has no headroom to be thinned, so
 * opacity modifiers on it are a contrast bug by construction. If a lighter secondary
 * tone is ever wanted, move the token itself rather than mixing it toward the surface.
 */

const files = execSync(
  "git ls-files 'src/**/*.js' | grep -E '(dashboard|shared)' || true",
  { encoding: "utf8" }
).split("\n").filter(Boolean);

// Tailwind alpha modifier applied to the muted/secondary text tokens.
const THINNED_TEXT = /\btext-(?:text-muted|text-secondary)\/(\d{1,3})\b/;

// WCAG 1.4.3 exempts text that is part of an inactive control, and /20-/30 on this
// token is the codebase's existing way of drawing a disabled arrow or chip button.
// Anything heavier than that is real, readable text and has to clear AA.
const DISABLED_STATE_ALPHA = new Set(["20", "30"]);

describe("secondary text contrast", () => {
  it("never thins the muted text token with an opacity modifier", () => {
    const offenders = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        const m = line.match(THINNED_TEXT);
        if (m && !DISABLED_STATE_ALPHA.has(m[1])) offenders.push(`${f}:${i + 1}  ${m[0]}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the muted token itself above AA on both light surfaces", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const grab = (name) => {
      const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
      return m && m[1];
    };
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4));
    const lum = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
    const ratio = (a, b) => {
      const [l1, l2] = [lum(rgb(a)), lum(rgb(b))];
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const muted = grab("--color-text-muted");
    const bg = grab("--color-bg");
    expect(muted).toBeTruthy();
    expect(bg).toBeTruthy();
    expect(ratio(muted, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
