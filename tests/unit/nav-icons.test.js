// The nav ran on a ligature font: `<span class="material-symbols-outlined">
// settings</span>`, with the literal word in the DOM until the font loaded —
// which is why globals.css still carries an `opacity: 0` rule on that class to
// hide the flash. The nav is drawn SVG now.
//
// Icon falls back to the font for a name it does not have, on purpose: the rest
// of the app is still mid-migration and an icon that silently disappears is
// worse than one that looks old for a release. The cost of that fallback is
// that a missing nav icon is invisible, so these pin the nav's own names.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { ICON_PATHS } = require("../../src/shared/components/icons/paths.js");
const { NAV_SECTIONS, NAV_HREFS, isNavItemActive } = require("../../src/shared/components/nav/navSections.js");
const { MEDIA_PROVIDER_KINDS } = require("../../src/shared/constants/providers.js");

const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];

describe("nav icon coverage", () => {
  it("every nav item names a drawn icon", () => {
    const missing = NAV_SECTIONS.flatMap((s) => s.items)
      .filter((i) => !ICON_PATHS[i.icon])
      .map((i) => `${i.label} -> ${i.icon}`);
    expect(missing, `these would fall back to the font: ${missing}`).toEqual([]);
  });

  it("every media kind shown in the nav names a drawn icon", () => {
    // These come from the provider constants, not from navSections, so adding
    // a kind there is the easy way to reintroduce a font glyph in the sidebar.
    const missing = MEDIA_PROVIDER_KINDS
      .filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id))
      .filter((k) => !ICON_PATHS[k.icon])
      .map((k) => `${k.label} -> ${k.icon}`);
    expect(missing).toEqual([]);
  });

  it("every page-title icon the header can show is drawn", () => {
    // getPageInfo returns Material Symbols names per route. Two of them
    // (vpn_key, monitor) were not in the set and fell back to the font, which
    // is invisible on a page you do not happen to open.
    const src = fs.readFileSync(path.join(process.cwd(), "src/shared/components/Header.js"), "utf8");
    const names = [...new Set([...src.matchAll(/icon: "([a-z_]+)"/g)].map((m) => m[1]))];
    expect(names.length, "no page icons found — did the shape of getPageInfo change?").toBeGreaterThan(5);
    const missing = names.filter((n) => !ICON_PATHS[n]);
    expect(missing, `header page icons falling back to the font: ${missing}`).toEqual([]);
  });

  it("the nav chrome has no Material Symbols spans left", () => {
    for (const f of [
      "src/shared/components/Sidebar.js",
      "src/shared/components/Header.js",
      "src/shared/components/layouts/DashboardLayout.js",
    ]) {
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      expect(src, `${f} still renders a font glyph`).not.toContain("material-symbols-outlined");
    }
  });
});

describe("icon paths", () => {
  it("every icon paints in currentColor — no hardcoded colour anywhere", () => {
    // One hand across the set, and one colour. A literal colour breaks the active
    // state, which works by setting `color` on the element.
    //
    // `fill="currentColor"` is allowed, and is not what that rule was about: a few
    // icons are only readable as a solid — toggle_on's knob is what separates it
    // from toggle_off, and contrast is a half-filled disc by definition. It still
    // follows `color` like every stroke does.
    for (const [name, d] of Object.entries(ICON_PATHS)) {
      const fills = [...d.matchAll(/fill="([^"]*)"/g)].map((m) => m[1]);
      for (const f of fills) {
        expect(["none", "currentColor"], `${name} fills with ${f}`).toContain(f);
      }
      expect(d, `${name} hardcodes a stroke colour`).not.toMatch(/stroke="(?!none|currentColor)/);
    }
  });

  it("a filled element turns its own stroke off", () => {
    // A shape that is both filled and stroked sits a half-stroke wider than the
    // rest of the set, so it reads bolder at nav size for no reason.
    for (const [name, d] of Object.entries(ICON_PATHS)) {
      for (const el of d.match(/<[a-z]+\b[^>]*fill="currentColor"[^>]*>/g) || []) {
        expect(el, `${name}: a filled element must set stroke="none"`).toContain('stroke="none"');
      }
    }
  });

  it("no icon is empty", () => {
    for (const [name, d] of Object.entries(ICON_PATHS)) {
      expect(d.length, `${name} is empty`).toBeGreaterThan(10);
      expect(d, `${name} has no drawable element`).toMatch(/<(path|circle|rect|polyline|line|ellipse)\b/);
    }
  });

  it("every element is closed — an unclosed tag swallows the rest of the icon", () => {
    for (const [name, d] of Object.entries(ICON_PATHS)) {
      const opens = (d.match(/<[a-z]+\b/g) || []).length;
      const closes = (d.match(/\/>/g) || []).length;
      expect(closes, `${name}: ${opens} elements but ${closes} self-closed`).toBe(opens);
    }
  });
});

describe("active-route matching", () => {
  it("lights up Endpoint on /dashboard, which renders the endpoint page", () => {
    // Without this, the page you land on has nothing highlighted at all.
    expect(isNavItemActive("/dashboard/endpoint", "/dashboard")).toBe(true);
    expect(isNavItemActive("/dashboard/endpoint", "/dashboard/endpoint")).toBe(true);
  });

  it("does not light up every item on /dashboard", () => {
    const lit = NAV_HREFS.filter((h) => isNavItemActive(h, "/dashboard"));
    expect(lit).toEqual(["/dashboard/endpoint"]);
  });

  it("matches the deepest page of a section", () => {
    expect(isNavItemActive("/dashboard/providers", "/dashboard/providers/anthropic")).toBe(true);
    expect(isNavItemActive("/dashboard/usage", "/dashboard/providers")).toBe(false);
  });
});

describe("nav routes exist", () => {
  it("every nav href resolves to a page in the app directory", () => {
    // A regroup is the easy moment to typo an href, and the result is a 404
    // reachable only by clicking the thing you just moved.
    const missing = NAV_HREFS.filter((href) => {
      const dir = path.join(process.cwd(), "src/app/(dashboard)", href);
      return !fs.existsSync(path.join(dir, "page.js")) && !fs.existsSync(path.join(dir, "page.jsx"));
    });
    expect(missing, `no page.js for: ${missing}`).toEqual([]);
  });
});
