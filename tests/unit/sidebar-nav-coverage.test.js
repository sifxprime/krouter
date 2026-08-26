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

const SIDEBAR = "src/shared/components/Sidebar.js";
const DASHBOARD_DIR = "src/app/(dashboard)/dashboard";

/** Pages deliberately absent from the sidebar, each with the reason it is reachable. */
const NOT_IN_SIDEBAR = {
  profile: "reached from the account menu, not the nav list",
};
// media-providers needs no entry here: the sidebar links its /web sub-page, and the
// slug match below counts a parent as covered when any of its sub-pages is linked.

const src = readFileSync(SIDEBAR, "utf8");
const navSlugs = new Set(
  [...src.matchAll(/href:\s*"\/dashboard\/([a-z0-9-]+)/g)].map((m) => m[1])
);
const pageSlugs = readdirSync(DASHBOARD_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("["))
  .map((e) => e.name);

describe("sidebar navigation coverage", () => {
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
