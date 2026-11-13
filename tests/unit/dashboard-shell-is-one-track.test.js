/**
 * The header bar and the page content sit on ONE track.
 *
 * They were siblings carrying separate geometry — the header `px-4 lg:px-8`
 * full-bleed, the content `p-6 lg:p-10` capped at `max-w-7xl` — so at 1440px
 * the title block landed at x=284 and the content at x=292. An 8px step under
 * every page title in the app.
 *
 * Pages then set their own widths on top, and the step became a gulf. Measured
 * in a browser at 1440x900, before the fix:
 *
 *   width  left   offset from header   pages
 *   1102   292                   8px   dashboard, providers, usage, combos, ...
 *   1024   334                  50px   cli-tools, proxy-pools, cli-tools/[id]
 *    896   395                 111px   skills, presidio
 *    768   462                 178px   token-saver
 *    672   507                 223px   profile, providers/new
 *
 * On Settings the heading sat 223px left of the form it labelled with ~430px of
 * dead grid either side. Six widths for one shell, and five pages additionally
 * stacked their own `p-6`/`p-8` on the layout's 40px so their content was inset
 * 64-72px instead of 40.
 *
 * These tests pin the two halves of the fix: the geometry has exactly one
 * definition, and no page may reintroduce its own.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SHELL_GUTTER_X,
  SHELL_GUTTER_X_HEADER,
  SHELL_WIDTH,
  NARROW_ROUTES,
  FULL_BLEED_ROUTES,
  isFullBleed,
  shellWidthFor,
  shellTrackClass,
} from "../../src/shared/constants/pageShell.js";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const HEADER = "src/shared/components/Header.js";
const LAYOUT = "src/shared/components/layouts/DashboardLayout.js";
const DASH = "src/app/(dashboard)";

/** Every page / client component under the dashboard route group. */
function dashboardPageFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (/^(page|.*(?:PageClient|Client))\.js$/.test(e.name)) {
        out.push(path.relative(process.cwd(), full));
      }
    }
  };
  walk(path.join(process.cwd(), DASH));
  return out;
}

describe("the shell's geometry has one definition", () => {
  it("gives the header and the content area the same gutter", () => {
    // Not cosmetic: unequal gutters ARE the 8px step. Both must read the shared
    // constant rather than each spelling a value out.
    for (const file of [HEADER, LAYOUT]) {
      const src = read(file);
      expect(src, `${file} must import the shared gutter`).toContain("SHELL_GUTTER_X");
      expect(src, `${file} must not spell a gutter out`).not.toMatch(/px-\d+ lg:px-\d+/);
    }
  });

  it("reserves the content area's scrollbar in the header", () => {
    // The content area is a scroll container and its styled scrollbar is real
    // layout width, so equal padding still leaves its usable box narrower and a
    // centred narrow track 3px to the left. The header compensates because it
    // never scrolls.
    const css = read("src/app/globals.css");
    expect(css, "the gutter and the scrollbar width must be variables").toMatch(
      /--shell-gutter:/
    );
    expect(css).toMatch(/--shell-scrollbar:/);
    expect(css, `${SHELL_GUTTER_X_HEADER} must add the scrollbar to its end padding`).toMatch(
      /\.shell-gutter-x-header\s*\{[^}]*padding-inline-end:\s*calc\(\s*var\(--shell-gutter\)\s*\+\s*var\(--shell-scrollbar\)\s*\)/
    );
    // The scrollbar's own width must come from the same variable, or the
    // reserve above silently stops matching it.
    expect(css).toMatch(/::-webkit-scrollbar\s*\{\s*width:\s*var\(--shell-scrollbar/);
  });

  it("keeps the scrollbar gutter reserved even when nothing overflows", () => {
    // Otherwise a page shifts 3px sideways the moment its content grows past
    // one screen.
    expect(read("src/app/globals.css")).toMatch(
      /\.shell-scroll\s*\{[^}]*scrollbar-gutter:\s*stable/
    );
    expect(read(LAYOUT), "the layout must use the shared scroll class").toContain("SHELL_SCROLL");
    expect(read(LAYOUT), "and not spell the overflow out").not.toContain("overflow-y-auto");
  });

  it("puts both on the same width track", () => {
    for (const file of [HEADER, LAYOUT]) {
      expect(read(file), `${file} must use shellTrackClass`).toContain("shellTrackClass(pathname)");
    }
  });

  it("does not leave a hardcoded max-w on the content area", () => {
    // The layout used to pin max-w-7xl inline, which is how a narrow page's
    // header could not follow it.
    expect(read(LAYOUT)).not.toContain("max-w-7xl");
  });

  it("keeps the header's bottom border full width", () => {
    // The track is an INNER element. Centring the <header> itself would pull
    // the rule in from the edges and look like a floating bar.
    const src = read(HEADER);
    const tag = src.slice(src.indexOf("<header"), src.indexOf(">", src.indexOf("<header")));
    expect(tag, "the border belongs on the full-width header").toContain("border-b");
    expect(tag, "the header element itself must not be a centred track").not.toContain("mx-auto");
  });
});

describe("routes resolve to a width", () => {
  it("offers exactly two widths", () => {
    // Six was the bug. Adding a third needs a reason and a test, not a page
    // reaching for max-w-5xl on its own.
    expect(Object.keys(SHELL_WIDTH).sort()).toEqual(["narrow", "wide"]);
  });

  it("defaults to wide", () => {
    for (const p of ["/dashboard", "/dashboard/usage", "/dashboard/skills", "/dashboard/cli-tools"]) {
      expect(shellWidthFor(p), `${p} should be wide`).toBe(SHELL_WIDTH.wide);
    }
  });

  it("narrows single-column forms", () => {
    for (const p of NARROW_ROUTES) {
      expect(shellWidthFor(p), `${p} should be narrow`).toBe(SHELL_WIDTH.narrow);
    }
  });

  it("matches narrow routes exactly, not by prefix", () => {
    // /dashboard/providers/new is a form and is narrow; /dashboard/providers
    // and a provider detail page are not. A `startsWith` or `includes` match
    // would drag both to 768px.
    expect(shellWidthFor("/dashboard/providers/new")).toBe(SHELL_WIDTH.narrow);
    expect(shellWidthFor("/dashboard/providers")).toBe(SHELL_WIDTH.wide);
    expect(shellWidthFor("/dashboard/providers/anthropic")).toBe(SHELL_WIDTH.wide);
  });

  it("always produces a centred, full-width track", () => {
    for (const p of ["/dashboard", "/dashboard/profile"]) {
      expect(shellTrackClass(p)).toMatch(/\bmx-auto\b/);
      expect(shellTrackClass(p)).toMatch(/\bw-full\b/);
    }
  });

  it("treats only the chat page as full bleed", () => {
    expect(FULL_BLEED_ROUTES).toEqual(["/dashboard/basic-chat"]);
    expect(isFullBleed("/dashboard/basic-chat")).toBe(true);
    expect(isFullBleed("/dashboard")).toBe(false);
  });
});

describe("no page sets its own geometry", () => {
  const files = dashboardPageFiles();

  it("found the pages to check", () => {
    // A rename that silently emptied this list would turn the checks below into
    // vacuous passes.
    expect(files.length).toBeGreaterThan(15);
  });

  it("never centres its own width track", () => {
    // `max-w-<size>` together with `mx-auto` is the page-track pattern the
    // shell now owns. Inner uses are unaffected: max-w-full, an arbitrary
    // max-w-[220px], or mx-auto on its own all stay legal.
    const offenders = [];
    for (const file of files) {
      // basic-chat is full bleed by design and lays out its own chat column.
      if (file.includes("basic-chat")) continue;
      for (const m of read(file).matchAll(/className="([^"]*)"/g)) {
        const cls = m[1];
        if (/\bmax-w-(?:sm|md|lg|xl|[2-7]xl)\b/.test(cls) && /\bmx-auto\b/.test(cls)) {
          // A centred run of prose inside an empty state is not a page track.
          if (/\btext-(?:sm|xs|center)\b/.test(cls)) continue;
          offenders.push(`${file}: ${cls}`);
        }
      }
    }
    expect(offenders, `pages must take their width from the shell:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("never stacks its own padding on the shell's", () => {
    // The shell already applies 40px. A page-level p-6/p-8 on the outermost
    // element made it 64-72px on five pages, which is the inset that read as a
    // gap. Only the OUTERMOST element is checked — cards and modals inside a
    // page legitimately have their own padding.
    const offenders = [];
    for (const file of files) {
      if (file.includes("basic-chat")) continue;
      const src = read(file);
      // The outermost element of the last top-level `return (` block.
      const ret = src.lastIndexOf("return (");
      if (ret === -1) continue;
      const first = src.slice(ret, ret + 400).match(/className="([^"]*)"/);
      if (first && /\bp-[4-9]\b|\bp-1[0-9]\b/.test(first[1])) {
        offenders.push(`${file}: ${first[1]}`);
      }
    }
    expect(offenders, `the shell owns page padding:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});

describe("the gutter itself", () => {
  it("is a CSS class, so one definition drives both halves", () => {
    expect(SHELL_GUTTER_X).toBe("shell-gutter-x");
    expect(SHELL_GUTTER_X_HEADER).toBe("shell-gutter-x-header");
    expect(SHELL_GUTTER_X_HEADER).not.toBe(SHELL_GUTTER_X);
  });
});
