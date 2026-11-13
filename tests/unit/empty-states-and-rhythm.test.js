/**
 * One empty state, one table empty row, one page rhythm.
 *
 * ## Empty states
 *
 * Every page that needed one built its own. The two carrying a title, a
 * description and an action differed in padding and in whether they had an
 * icon at all:
 *
 *   combos        py-12   icon in a primary/10 circle   title mb-1   desc mb-4
 *   proxy-pools   py-10   no icon                       title mb-1   desc mb-4
 *
 * ## Table empty rows
 *
 * `.data-table-empty` was defined in globals.css — 36px of padding, centred,
 * muted, with the row hover suppressed — and used by NOTHING. All four tables
 * hand-rolled a cell instead, with three different paddings for the same thing:
 *
 *   pxpipe              py-6
 *   UsageTable          px-6 py-8
 *   RequestDetailsTab   p-8
 *
 * ## Page rhythm
 *
 * The outermost wrapper of a dashboard page used 24px, 32px, or `space-y-6`
 * (24px again, by a second idiom). Loading branches disagreed with the loaded
 * state they stood in for — providers rendered its skeletons at 32px and its
 * content at 24px.
 *
 * ## What is deliberately NOT here
 *
 * `.section-title` keeps no margin of its own. Measured across the app: 63 uses
 * carry no margin and take their spacing from a parent `gap`, while 37 set one
 * of mb-1/2/3/4/6 or mt-4 — and those are nearly all modal headings, which own
 * their spacing. Baking a margin into the class would have changed the 63 that
 * are already correct. The class stays pure typography.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const DASH = "src/app/(dashboard)";

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".js")) out.push(path.relative(process.cwd(), full));
  }
  return out;
}
const dashboardFiles = walk(path.join(process.cwd(), DASH));

describe("the empty state is one component", () => {
  it("exists", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src/shared/components/EmptyState.js"))).toBe(true);
  });

  it("is used by the pages that had their own", () => {
    for (const [file, title] of [
      ["src/app/(dashboard)/dashboard/combos/page.js", "No combos yet"],
      ["src/app/(dashboard)/dashboard/proxy-pools/page.js", "No proxy pool entries yet"],
      ["src/app/(dashboard)/dashboard/providers/page.js", "No providers match your search"],
    ]) {
      const src = read(file);
      expect(src, `${file} must use EmptyState`).toContain("<EmptyState");
      expect(src, "the message itself must survive the swap").toContain(title);
      expect(src, `${file} uses EmptyState without importing it`).toContain(
        'import EmptyState from "@/shared/components/EmptyState"'
      );
    }
  });

  it("keeps the action that lived in the old block", () => {
    expect(read("src/app/(dashboard)/dashboard/combos/page.js")).toContain("Create Combo");
    expect(read("src/app/(dashboard)/dashboard/proxy-pools/page.js")).toContain("Add Proxy Pool");
  });

  it("makes the icon optional", () => {
    // proxy-pools had no icon and combos did; forcing one on every caller would
    // have been as arbitrary as dropping it.
    const src = read("src/shared/components/EmptyState.js");
    expect(src).toMatch(/icon\s*\?/);
    expect(src, "only the title is required").toMatch(/title:\s*PropTypes\.node\.isRequired/);
  });

  it("no dashboard page still hand-rolls the centred block", () => {
    // `text-center` plus a tall vertical padding on a bare div is the shape
    // this component replaced.
    //
    // A loading indicator shares that shape but is NOT an empty state — it says
    // "not yet", not "nothing here" — so a block whose text is a loading
    // message is left alone rather than dressed up as emptiness.
    const offenders = [];
    for (const file of dashboardFiles) {
      const src = read(file);
      for (const m of src.matchAll(/className="([^"]*)"/g)) {
        const cls = m[1];
        if (!/\btext-center\b/.test(cls) || !/\bpy-(?:1[0-9]|[89])\b/.test(cls)) continue;
        const after = src.slice(m.index, m.index + 220);
        if (/Loading|Loader|progress_activity|animate-spin/i.test(after)) continue;
        offenders.push(`${file}: ${cls}`);
      }
    }
    expect(offenders, `use <EmptyState> instead:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});

describe("table empty rows use the class that already existed", () => {
  const TABLES = [
    "src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.js",
    "src/app/(dashboard)/dashboard/usage/components/UsageTable.js",
    "src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js",
  ];

  it("is no longer dead CSS", () => {
    expect(read("src/app/globals.css")).toContain(".data-table-empty");
    const users = TABLES.filter((f) => read(f).includes("data-table-empty"));
    expect(users, "every table with an empty row should use it").toEqual(TABLES);
  });

  it("stops spelling the cell padding out", () => {
    // py-6 / px-6 py-8 / p-8 for the same cell was the drift.
    for (const file of TABLES) {
      const src = read(file);
      const cells = [...src.matchAll(/<td colSpan[^>]*className="([^"]*)"/g)].map((m) => m[1]);
      for (const cls of cells) {
        expect(cls, `${file}: an empty-row cell still styles itself — ${cls}`).not.toMatch(
          /\btext-center\b/
        );
      }
    }
  });
});

describe("page rhythm", () => {
  it("has no page-level 32px wrapper left", () => {
    const offenders = dashboardFiles.filter((f) =>
      /className="flex (?:min-w-0 |w-full )?flex-col gap-8"/.test(read(f))
    );
    expect(offenders, `page sections are 24px:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("uses one idiom for a vertical stack, not two", () => {
    // space-y-6 and gap-6 are the same 24px written two ways. Only the page's
    // outermost wrapper is checked; nested components may use either.
    const offenders = [];
    for (const file of dashboardFiles) {
      const src = read(file);
      const ret = src.lastIndexOf("return (");
      if (ret === -1) continue;
      const first = src.slice(ret, ret + 300).match(/className="([^"]*)"/);
      if (first && /\bspace-y-6\b/.test(first[1])) offenders.push(`${file}: ${first[1]}`);
    }
    expect(offenders, `use flex flex-col gap-6:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("makes a loading skeleton match the layout it stands in for", () => {
    // providers rendered its skeletons at 32px and its loaded content at 24px,
    // so the page visibly reflowed when the data arrived.
    for (const file of [
      "src/app/(dashboard)/dashboard/providers/page.js",
      "src/app/(dashboard)/dashboard/providers/[id]/page.js",
      "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js",
    ]) {
      const src = read(file);
      const at = src.indexOf("if (loading)");
      if (at === -1) continue;
      const cls = src.slice(at, at + 220).match(/className="([^"]*)"/);
      if (!cls) continue;
      expect(cls[1], `${file}: loading branch is spaced differently from the page`).not.toMatch(
        /gap-8/
      );
    }
  });
});

describe("section-title stays pure typography", () => {
  it("sets no margin of its own", () => {
    // 63 call sites take their spacing from a parent gap. A margin here would
    // double-space every one of them.
    const css = read("src/app/globals.css");
    const block = css.slice(css.indexOf(".section-title"), css.indexOf("}", css.indexOf(".section-title")));
    expect(block).not.toMatch(/\bmargin\b|\bmargin-top\b|\bmargin-bottom\b/);
  });
});
