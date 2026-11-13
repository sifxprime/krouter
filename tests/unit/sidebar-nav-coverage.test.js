import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * v0.5.111 (9a944e63) added the Token Saver page by overwriting the MITM line
 * in the sidebar rather than inserting beside it:
 *
 *   - { href: "/dashboard/mitm", label: "MITM", icon: "security" },
 *   + { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
 *
 * The page itself was untouched and still served 200, so nothing failed and no
 * test caught it -- the feature was simply unreachable unless you typed the URL.
 * A user noticed it missing before we did. These tests make an orphaned page a
 * test failure instead of a silent regression.
 */

// The nav data moved out of Sidebar.js when the flat list was grouped into
// sections. Scanning the component for hrefs would now find none and quietly
// pass every check below -- this guard has to follow the data.
const NAV_DATA = "src/shared/components/nav/navSections.js";
const DASHBOARD_DIR = "src/app/(dashboard)/dashboard";

/**
 * Pages deliberately absent from the sidebar, each with the reason.
 *
 * Empty, and that is the point. The last entry was basic-chat, exempted
 * because the nav "had the entry commented out" — and by the time anyone
 * looked, navSections.js contained no mention of basic-chat in any form,
 * commented or otherwise. The page had shipped in the initial release and was
 * reachable only by typing the URL. An exemption whose reason has gone stale
 * is indistinguishable from the orphaned page this guard was written to catch,
 * so a new one needs a reason that can be checked against the code.
 */
const NOT_IN_SIDEBAR = {};
// `profile` was an exception while Settings was a hardcoded <Link> outside the
// nav array, invisible to the scan. It is a normal System entry now.
// `media-providers` is the accordion, which records a basePath instead of an
// href; the scan reads both.

const src = readFileSync(NAV_DATA, "utf8");
const navSlugs = new Set(
  [...src.matchAll(/(?:href|basePath):\s*"\/dashboard\/([a-z0-9-]+)/g)].map((m) => m[1])
);
const pageSlugs = readdirSync(DASHBOARD_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("["))
  .map((e) => e.name);

describe("sidebar navigation coverage", () => {
  it("found the nav data at all", () => {
    // Everything below is a set-difference against navSlugs, so an empty set
    // makes the orphan and dangling checks vacuously pass. If the data moves
    // again, fail here rather than go quiet.
    expect(navSlugs.size, `no hrefs found in ${NAV_DATA} -- did the nav data move?`)
      .toBeGreaterThan(5);
  });

  it("links the MITM page", () => {
    expect(navSlugs.has("mitm")).toBe(true);
  });

  it("leaves no dashboard page unreachable from the sidebar", () => {
    const orphans = pageSlugs.filter((s) => !navSlugs.has(s) && !(s in NOT_IN_SIDEBAR));
    expect(orphans).toEqual([]);
  });

  it("points every sidebar link at a page that exists", () => {
    const dangling = [...navSlugs].filter(
      (s) => !existsSync(path.join(DASHBOARD_DIR, s))
    );
    expect(dangling).toEqual([]);
  });

  it("keeps the documented exceptions honest", () => {
    // If an exception is deleted or finally given a nav entry, drop it from the list.
    for (const slug of Object.keys(NOT_IN_SIDEBAR)) {
      expect(existsSync(path.join(DASHBOARD_DIR, slug)), `${slug} no longer exists`).toBe(true);
      expect(navSlugs.has(slug), `${slug} is in the sidebar now`).toBe(false);
    }
  });
});
