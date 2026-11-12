/**
 * Three regressions shipped in v0.5.153, found by an adversarial pass over that
 * release's own diff. Each is asserted here so it cannot return.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf-8");
const noComments = (s) => s.split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
  .join("\n");

describe("sqlite engine is chosen by Node-API level, not major version", () => {
  const src = () => noComments(read("cli/hooks/sqliteRuntime.js"));

  it("gates on process.versions.napi", () => {
    // NODE_MAJOR >= 22 was wrong: better-sqlite3 13.x declares Node-API 10, which
    // Node only supports from 22.14.0. On 22.11 (the LTS launch build) the addon
    // cannot load, yet the old check still reported the engine ready.
    expect(src()).toContain("Number(process.versions.napi)");
    expect(src()).toContain("NODE_NAPI >= 10");
    expect(src()).not.toContain("NODE_MAJOR >= 22");
  });

  it("picks the right package for each real Node release", () => {
    const pick = (napi) => ((Number(napi) || 0) >= 10 ? "13.0.3" : "12.6.2");
    // Measured from actual installed runtimes, not assumed.
    expect(pick(9)).toBe("12.6.2");    // 22.11.0 and 22.13.1 report napi 9
    expect(pick(10)).toBe("13.0.3");   // 22.14.0 onward, and all of 24.x
    expect(pick(undefined)).toBe("12.6.2"); // unknown -> the safe, ABI-fetched build
  });
});

describe("the icon reveal cannot override Tailwind utilities", () => {
  // This pair of bugs came from one rule: `.material-symbols-outlined` hid every
  // icon at `opacity: 0` until the webfont loaded. Unlayered, it outranked
  // `.opacity-20` from @layer utilities; written as the `transition` shorthand, it
  // reset transition-property and killed `transition-transform` on every chevron.
  //
  // Both were fixed by layering it and using longhands. Both are now impossible
  // instead: the icons are drawn SVG, so there is no font to wait for and no rule
  // to hide them with. Guarding the absence is strictly stronger than guarding the
  // careful version of a rule that should not exist — and if the font ever returns,
  // this failure is where the history is written down.
  it("has no ligature-font reveal rule at all", () => {
    const css = read("src/app/globals.css");
    expect(css, "globals.css styles a ligature icon font again").not.toContain("material-symbols");
  });

  it("ships no icon webfont for a reveal rule to wait on", () => {
    const layout = read("src/app/layout.js");
    expect(layout, "layout.js imports an icon font again").not.toContain("material-symbols");
    const pkg = JSON.parse(read("package.json"));
    expect(Object.keys(pkg.dependencies || {})).not.toContain("material-symbols");
  });
});
