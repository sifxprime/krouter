import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CSS = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(p, out);
    } else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const SOURCES = walk(path.join(ROOT, "src")).map((f) => ({
  file: path.relative(ROOT, f),
  text: fs.readFileSync(f, "utf8"),
}));

/** Token names Tailwind can resolve, from the @theme block. */
const DEFINED = new Set(
  [...CSS.matchAll(/^\s*--color-([a-z0-9-]+):/gm)].map((m) => m[1])
);

// The app's own token namespaces. Tailwind's built-ins (red-500, white…) are
// not our problem; a name under one of these prefixes is ours to define.
const OURS = /\b(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|shadow|decoration|accent|caret|placeholder)-((?:text|surface|brand|border|bg|sidebar|vibrancy)(?:-[a-z0-9]+)*)\b/g;

// `bg-vibrancy` is written by hand in globals.css (it carries a backdrop-filter
// as well as a colour, which a token cannot), so it is a real class with no
// --color-* behind it. Anything else under these prefixes must be a token.
const HAND_WRITTEN = new Set(["vibrancy"]);

describe("design tokens", () => {
  it("every custom colour class names a token that exists", () => {
    // `text-text-primary` was used 29 times and never defined. Tailwind emits
    // no rule for an unknown token, so nothing errors and nothing is coloured —
    // the element quietly inherits. Where the parent happened to be the right
    // colour it looked correct, which is why it survived; inside a muted
    // container the same class silently dropped the emphasis it was asking for.
    const bad = [];
    for (const { file, text } of SOURCES) {
      for (const m of text.matchAll(OURS)) {
        const token = m[1];
        // Opacity suffixes (`text-text-muted/70`) and arbitrary values are fine.
        if (DEFINED.has(token) || HAND_WRITTEN.has(token)) continue;
        // Tolerate a prefix that resolves once a trailing segment is dropped,
        // e.g. `bg-surface-2` where only `surface-2` is defined.
        if ([...DEFINED].some((d) => d === token)) continue;
        bad.push(`${file}: ${m[0]}`);
      }
    }
    expect(
      [...new Set(bad)],
      "these classes name a --color-* token that globals.css never defines, so they paint nothing"
    ).toEqual([]);
  });

  it("the dark palette runs sidebar deeper than the canvas", () => {
    // The nav is a plane below the page, not a panel floating над it. When the
    // sidebar resolved lighter than the canvas the depth order inverted and the
    // cards lost their separation from their surroundings.
    const dark = CSS.slice(CSS.indexOf("Surfaces (dark"), CSS.indexOf("--color-danger", CSS.indexOf("Surfaces (dark")));
    const hex = (name) => dark.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();
    const lum = (h) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);

    const sidebar = hex("sidebar");
    const bg = hex("bg");
    const surface = hex("surface");
    expect([sidebar, bg, surface].every(Boolean), "dark surface tokens are not plain hex any more").toBe(true);
    expect(lum(sidebar), "sidebar must sit deeper than the canvas").toBeLessThan(lum(bg));
    expect(lum(bg), "cards must sit above the canvas").toBeLessThan(lum(surface));
  });
});
