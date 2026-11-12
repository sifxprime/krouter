/**
 * A production build must not depend on fonts.googleapis.com.
 *
 * `next/font/google` resolves its CSS during `next build`, so the build only
 * succeeds while Google answers the machine doing the building. It did not,
 * twice in one day:
 *
 *   src/app/layout.js
 *   An error occurred in `next/font`.
 *   TypeError: Cannot read properties of null (reading '1')
 *       at .../@next/font/dist/google/loader.js:122:78
 *
 * That killed the first v0.5.183 npm publish and the v0.5.185 Docker image. Both
 * recovered on a blind re-run, which is the worst shape for a release step: it
 * fails for a reason nothing in the diff explains, and retrying looks like a fix.
 *
 * The fonts are committed and read with `next/font/local`. Nothing changed for
 * the browser — next/font/google already self-hosted the same woff2 — so this
 * guards the build, not the output.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const FONT_DIR = "src/app/fonts";
const EXPECTED = [
  { file: "Inter-latin-variable.woff2", weight: "100 900", variable: "--font-inter" },
  { file: "SpaceGrotesk-latin-variable.woff2", weight: "300 700", variable: "--font-space-grotesk" },
];

describe("fonts are self-hosted", () => {
  it("no source file imports next/font/google", () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules" && e.name !== ".next") walk(full);
          continue;
        }
        if (!/\.(js|jsx|ts|tsx)$/.test(e.name)) continue;
        // Comments stripped first: the explanation of this fix names the very
        // import it bans, and matching raw text fails on the prose rather than
        // on an actual import.
        const code = fs.readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        if (code.includes("next/font/google")) {
          offenders.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(
      offenders,
      `these make the build fetch from Google: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  it("ships the font files it declares", () => {
    const layout = read("src/app/layout.js");
    expect(layout, "fonts must come from disk").toContain("next/font/local");

    for (const { file, weight, variable } of EXPECTED) {
      const onDisk = path.join(process.cwd(), FONT_DIR, file);
      expect(fs.existsSync(onDisk), `${file} is declared but not committed`).toBe(true);

      // A truncated or HTML-error-page download would still "exist". woff2
      // starts with the signature wOF2.
      const head = fs.readFileSync(onDisk).subarray(0, 4).toString("latin1");
      expect(head, `${file} is not a woff2`).toBe("wOF2");

      expect(layout, `${file} must be referenced by layout.js`).toContain(file);
      expect(layout, `the declared axis for ${file}`).toContain(`"${weight}"`);
      expect(layout, `${variable} is what globals.css reads`).toContain(variable);
    }
  });

  it("keeps the display-font variable the stylesheet depends on", () => {
    // --font-display reads --font-space-grotesk, so a rename in layout.js
    // silently drops every wordmark to a fallback with nothing erroring.
    const css = read("src/app/globals.css");
    expect(css, "--font-display must still read the Space Grotesk variable").toContain("var(--font-space-grotesk)");
  });

  it("keeps the body font reachable by the name the build emits", () => {
    // --font-sans names the literal 'Inter' rather than var(--font-inter), and
    // that has to keep matching the @font-face the build generates.
    //
    // It does, but by a thread worth pinning. next/font/local names the family
    // after the binding it is assigned to, so `const inter = localFont(...)`
    // emits `@font-face{font-family:inter}` — verified in .next/static/css —
    // and CSS matches family names ASCII case-insensitively, so 'Inter' finds
    // `inter`. Rename that const to something that is not "inter" and the body
    // silently drops to -apple-system with nothing erroring.
    //
    // (`next/font/google` used to emit the real `Inter`, confirmed in the
    // shipped 0.5.184 CSS, so the rendered typeface is unchanged by this move.)
    const css = read("src/app/globals.css");
    const sans = css.split("\n").find((l) => l.includes("--font-sans:"));
    expect(sans, "--font-sans must exist").toBeTruthy();
    expect(sans).toContain("'Inter'");

    const layout = read("src/app/layout.js");
    const binding = layout.match(/const\s+(\w+)\s*=\s*localFont\(\{\s*\n\s*src:\s*"\.\/fonts\/Inter/);
    expect(binding, "could not find the Inter localFont binding").toBeTruthy();
    expect(
      binding[1].toLowerCase(),
      "the emitted family comes from this binding name and must match --font-sans"
    ).toBe("inter");
  });

  it("does not regress into shipping a heavy font", () => {
    // v0.5.182 removed a 3,870 KB icon webfont from this package. Two latin
    // subsets are ~70 KB together; anything far past that means a full
    // multi-subset file got committed by mistake.
    for (const { file } of EXPECTED) {
      const kb = fs.statSync(path.join(process.cwd(), FONT_DIR, file)).size / 1024;
      expect(kb, `${file} is ${Math.round(kb)} KB — expected a latin subset`).toBeLessThan(200);
    }
  });
});
