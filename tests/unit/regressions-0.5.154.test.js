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

describe("the icon reveal does not override Tailwind utilities", () => {
  const css = () => read("src/app/globals.css");

  it("lives inside a cascade layer", () => {
    // Unlayered rules beat every layered one, so an unlayered .material-symbols
    // rule outranked .opacity-20 and .transition-transform from @layer utilities.
    const m = css().match(/@layer base \{[\s\S]*?\.material-symbols-outlined \{[\s\S]*?\}/);
    expect(m, "icon reveal must be wrapped in @layer base").toBeTruthy();
  });

  it("sets transition longhands rather than the shorthand", () => {
    // `transition: opacity ...` resets transition-property, which silently killed
    // transition-transform on every chevron that is also an icon.
    const start = css().indexOf("@layer base {");
    const block = css().slice(start, start + 600);
    expect(block).toContain("transition-property: opacity");
    expect(block).not.toMatch(/^\s*transition:\s/m);
  });
});
