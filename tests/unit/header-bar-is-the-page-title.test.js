/**
 * The header bar is the page's title. Pages do not paint a second one.
 *
 * The bar had no slot for a page action, so any page that needed a button
 * rebuilt the entire title row beneath it — title, description and all. That
 * put two titles on screen, and on several routes they disagreed. Measured in
 * a browser at 1440px:
 *
 *   route                      bar              page's own <h1>
 *   /dashboard/providers/new   "Providers"      "Add New Provider"
 *   /dashboard/presidio        "Presidio"       "Settings"
 *   /dashboard/combos          "Combos"         "Combos"
 *   /dashboard/proxy-pools     "Proxy Pools"    "Proxy Pools"
 *   /dashboard/environment     "Environment"    "Environment"
 *   /dashboard/translator      "Translator"     "Translator Debug"
 *
 * The providers/new case was a routing bug, not just duplication: the
 * `/providers/([^/]+)$` branch matches "new", fails to resolve it to a
 * provider, and falls through to the generic "Providers" entry.
 *
 * The bar also changed height as you moved around — 79px where a description
 * existed, 61px on the breadcrumb routes that have none.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HEADER_ACTIONS_SLOT_ID } from "../../src/shared/constants/pageShell.js";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const HEADER = "src/shared/components/Header.js";
const SLOT = "src/shared/components/HeaderActions.js";

/** The header's slot element, whole — it spans several lines. */
function slotElement() {
  const src = read(HEADER);
  const at = src.indexOf("HEADER_ACTIONS_SLOT_ID}");
  if (at === -1) return "";
  const open = src.lastIndexOf("<div", at);
  const close = src.indexOf("/>", at);
  return open === -1 || close === -1 ? "" : src.slice(open, close + 2);
}

describe("the header's actions slot", () => {
  it("exists in the header", () => {
    expect(read(HEADER)).toContain("HEADER_ACTIONS_SLOT_ID");
  });

  it("collapses when a page supplies no actions", () => {
    // Otherwise every page without an action carries its gap.
    const el = slotElement();
    expect(el, "the slot element is gone").toBeTruthy();
    expect(el).toContain("empty:hidden");
  });

  it("portals the children rather than storing an element", () => {
    // A stored React element is a snapshot: its handlers close over the page
    // state at the moment it was stored and go stale on the next render. A
    // portal leaves the children in the page's own render pass.
    expect(read(SLOT)).toContain("createPortal");
  });

  it("takes the slot node from the header, not from a lookup in an effect", () => {
    // Three ways to get the node, two of them wrong:
    //   getElementById in an effect  -> setState in an effect body, an extra
    //                                   render per mount (and a lint error)
    //   getElementById during render -> the header's DOM is not committed on
    //                                   the first render, so it reads null and
    //                                   nothing ever makes it read again
    // The header publishes the node from a callback ref after commit instead.
    const src = read(SLOT);
    expect(src).toContain("useSyncExternalStore");
    expect(src, "no lookup in an effect").not.toContain("getElementById");
    expect(src, "and no state to go stale").not.toMatch(/useState\(/);
    expect(read(HEADER), "the header must publish its node").toContain("ref={setHeaderActionsSlot}");
  });

  it("drops the old node when the header remounts", () => {
    // DashboardLayout keys Header on the pathname, so a route change unmounts
    // it (ref called with null) and mounts a new one. Subscribers must end up
    // holding the new node.
    const store = read("src/shared/components/headerActionsSlot.js");
    expect(store, "the setter must notify subscribers").toMatch(/listener\(\)/);
    expect(store, "and must not ignore a null node").toMatch(/node === slotNode/);
  });

  it("renders nothing until the slot exists", () => {
    // Portaling into null throws, and on the server there is no node at all.
    expect(read(SLOT)).toMatch(/if\s*\(!slot\)\s*return null/);
    expect(read("src/shared/components/headerActionsSlot.js")).toMatch(
      /getHeaderActionsSlotServer[\s\S]{0,80}return null/
    );
  });
});

describe("the bar's height does not change between pages", () => {
  it("is pinned, not driven by whether a description exists", () => {
    const src = read(HEADER);
    const track = src.split("\n").find((l) => l.includes("shellTrackClass(pathname)") && l.includes("<div"));
    expect(track, "the header's inner track is gone").toBeTruthy();
    expect(track, "needs a floor so a missing description cannot shrink it").toMatch(/min-h-\[\d+px\]/);
    expect(track, "and a taller one once the description shows").toMatch(/lg:min-h-\[\d+px\]/);
    expect(track, "content centres inside that floor").toContain("items-center");
  });

  it("no longer sets the padding that produced the two heights", () => {
    const src = read(HEADER);
    const tag = src.slice(src.indexOf("<header"), src.indexOf(">", src.indexOf("<header")));
    expect(tag, "pt-3/pb-2 on the header was what made it 79px vs 61px").not.toMatch(/pt-3|pb-2/);
  });
});

describe("routes resolve to the right title", () => {
  it("never lets a real route fall through to a raw path segment", () => {
    // Two routes were being caught by a pattern meant for dynamic ids and then
    // degrading to the segment itself:
    //
    //   /dashboard/providers/new        -> the bar read "Providers"
    //   /dashboard/media-providers/web  -> the bar read a lowercase "web"
    //
    // Neither is a provider or a kind, and both have to be matched exactly,
    // ahead of the regex that swallows them.
    const src = read(HEADER);
    const webExact = src.indexOf('pathname === "/dashboard/media-providers/web"');
    const kindRegex = src.indexOf("const mediaKindMatch");
    expect(webExact, "the web route has no entry of its own").toBeGreaterThan(-1);
    expect(webExact, "it must come before the [kind] regex that matches it").toBeLessThan(kindRegex);
  });

  it("gives /dashboard/providers/new its own entry, ahead of the regex", () => {
    const src = read(HEADER);
    const exact = src.indexOf('pathname === "/dashboard/providers/new"');
    const regex = src.indexOf("const providerMatch");
    const generic = src.indexOf('pathname.includes("/providers")');
    expect(exact, "the exact match is gone").toBeGreaterThan(-1);
    expect(exact, "it must come before the /providers/:id regex, which matches 'new'").toBeLessThan(regex);
    expect(exact, "and before the generic Providers entry").toBeLessThan(generic);
  });
});

describe("pages do not paint their own title", () => {
  const CLEANED = {
    "src/app/(dashboard)/dashboard/combos/page.js": "Combos",
    "src/app/(dashboard)/dashboard/proxy-pools/page.js": "Proxy Pools",
    "src/app/(dashboard)/dashboard/environment/page.js": "Environment",
    "src/app/(dashboard)/dashboard/presidio/page.js": "Settings",
    "src/app/(dashboard)/dashboard/providers/new/page.js": "Add New Provider",
    "src/app/(dashboard)/dashboard/translator/page.js": "Translator Debug",
  };

  for (const [file, title] of Object.entries(CLEANED)) {
    it(`${file.split("/").at(-2)} has no <h1> of its own`, () => {
      const src = read(file);
      expect(src, `this page still paints "${title}" under the bar's title`).not.toMatch(/<h1\b/);
    });
  }

  it("moved the actions rather than deleting them", () => {
    // Removing a title row must not take the page's primary action with it.
    const combos = read("src/app/(dashboard)/dashboard/combos/page.js");
    expect(combos).toContain("<HeaderActions>");
    expect(combos, "the Create Combo action must survive").toContain("Create Combo");

    const pools = read("src/app/(dashboard)/dashboard/proxy-pools/page.js");
    expect(pools).toContain("<HeaderActions>");
    for (const action of ["Deploy Relay", "Batch Import", "Add Proxy Pool"]) {
      expect(pools, `${action} must survive the move`).toContain(action);
    }
  });

  it("leaves no <h1> anywhere under the dashboard", () => {
    // The six listed above were the first pass. The detail routes kept theirs
    // because their bar showed only a section name — providers/[id] rendered
    // "Anthropic" in a hero roughly 60px under a breadcrumb that already read
    // "Providers / Anthropic", with a third "Back to Providers" link beside
    // it. The bar now carries the name, the icon and the trail on every one of
    // them, so nothing below it needs an <h1>.
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!e.name.endsWith(".js")) continue;
        if (/<h1\b/.test(fs.readFileSync(full, "utf8"))) {
          offenders.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), "src/app/(dashboard)"));
    expect(offenders, `the header bar is the page title:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("can name a CLI tool in the bar, so that page need not", () => {
    // This was the one detail route where dropping the page's <h1> would have
    // lost which tool you were on: the bar said "CLI Tools" for all of them.
    const src = read(HEADER);
    expect(src, "the bar must resolve the tool from the path").toContain("CLI_TOOLS");
    const at = src.indexOf("const toolMatch");
    expect(at, "the tool-detail branch is gone").toBeGreaterThan(-1);
    const branch = src.slice(at, at + 520);
    expect(branch, "it must match the tool-detail path").toMatch(/cli-tools/);
    expect(branch, "and show the tool under CLI Tools").toContain("breadcrumbs");
    expect(branch, "with the tool's own name").toContain("tool.name");
  });

  it("drops back-links the breadcrumb already provides", () => {
    for (const file of [
      "src/app/(dashboard)/dashboard/providers/[id]/ProviderHero.js",
      "src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js",
    ]) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${file} still renders its own back-link`).not.toMatch(/arrow_back/);
    }
  });

  it("imports the slot wherever it is used", () => {
    for (const file of Object.keys(CLEANED)) {
      const src = read(file);
      if (!src.includes("<HeaderActions")) continue;
      expect(src, `${file} uses HeaderActions without importing it`).toMatch(
        /import HeaderActions from "@\/shared\/components\/HeaderActions"/
      );
    }
  });
});

describe("page actions on a phone", () => {
  // Moving proxy-pools' three actions into the bar overflowed it at 390px: the
  // header's content measured 666px inside a 390px box, pushing the page title
  // and the theme/language/menu controls off the right edge. The bar only has
  // room for them from `lg` up.
  it("keeps the slot out of the bar below lg", () => {
    const el = slotElement();
    expect(el, "the slot must not occupy the narrow bar").toContain("hidden");
    expect(el, "and must come back at lg").toMatch(/lg:flex/);
  });

  it("renders the actions in place instead of dropping them", () => {
    // Hiding the slot without a fallback would lose the page's primary action
    // on every phone.
    const src = read(SLOT);
    expect(src, "a non-desktop branch must render children").toMatch(
      /if\s*\(!isDesktop\)[\s\S]{0,160}\{children\}/
    );
  });

  it("reports the same thing on the server as on the first client paint", () => {
    // A media query read during render differs between server and client and
    // trips a hydration mismatch. The server snapshot has to be a fixed value.
    const src = read(SLOT);
    expect(src).toContain("useSyncExternalStore");
    expect(src, "the server snapshot must be constant").toMatch(/\(\)\s*=>\s*false/);
  });

  it("stops listening when it unmounts", () => {
    expect(read(SLOT)).toContain("removeEventListener");
  });
});

describe("the slot id", () => {
  it("is namespaced, since it is a bare DOM id", () => {
    expect(HEADER_ACTIONS_SLOT_ID).toMatch(/^krouter-/);
  });
});
