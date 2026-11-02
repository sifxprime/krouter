// The dashboard editor loads Monaco from a CDN, not from node_modules (see
// src/shared/constants/monaco.js). @monaco-editor/loader hardcodes monaco-editor@0.55.1,
// which bundles DOMPurify 3.2.7 — so without an explicit pin the browser fetches a build
// carrying the DOMPurify advisories no matter what the package.json range says, because
// nothing imports monaco-editor. Upstream 5883110b.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MONACO_VERSION, MONACO_VS_PATH } from "@/shared/constants/monaco.js";

// 0.57.0 is the first build carrying DOMPurify 3.4.15. Anything older reintroduces the
// advisory into the browser, so this is a floor, not a preference.
const MIN_SAFE_VERSION = [0, 57, 0];

const parse = (v) => v.split(".").map(Number);
const gte = (a, b) => {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
};

describe("Monaco CDN pin", () => {
  it("is a concrete three-part version, not a range", () => {
    expect(MONACO_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is at least the first build with the DOMPurify fix", () => {
    expect(gte(parse(MONACO_VERSION), MIN_SAFE_VERSION)).toBe(true);
  });

  it("loads that exact version's AMD build from jsdelivr", () => {
    expect(MONACO_VS_PATH).toBe(`https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`);
  });

  // The loader's own default is the thing being overridden. If it ever ships a version
  // at or above the floor, this pin becomes redundant — but until then it is the fix.
  it("does not silently fall back to the loader's bundled default", () => {
    const loaderConfig = readFileSync(
      new URL("../../node_modules/@monaco-editor/loader/lib/cjs/config/index.js", import.meta.url),
      "utf8",
    );
    const bundled = loaderConfig.match(/monaco-editor@(\d+\.\d+\.\d+)/)?.[1];
    expect(bundled, "loader no longer declares a jsdelivr default").toBeTruthy();
    expect(MONACO_VS_PATH).not.toContain(`monaco-editor@${bundled}/`);
  });
});

describe("the translator page applies the pin", () => {
  // The pin only takes effect if loader.config() actually runs, and it has to run inside
  // the dynamic import or the editor stops being lazy-loaded.
  it("configures the loader inside the dynamic import", () => {
    const src = readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/translator/page.js", import.meta.url),
      "utf8",
    );

    expect(src).toContain("MONACO_VS_PATH");
    expect(src).toContain("loader.config(");
    expect(src).toContain("{ ssr: false }");
    // The config call must sit between the dynamic() call and its options.
    const dynamicStart = src.indexOf("dynamic(");
    expect(src.indexOf("loader.config(")).toBeGreaterThan(dynamicStart);
  });
});
