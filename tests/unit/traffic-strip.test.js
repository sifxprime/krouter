import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const STRIP = "src/app/(dashboard)/dashboard/endpoint/components/TrafficStrip.js";
const OVERVIEW = "src/app/(dashboard)/dashboard/usage/components/OverviewCards.js";
const ROUTE = "src/app/api/usage/stats/route.js";

describe("the endpoint page's traffic strip", () => {
  it("reads the same stat fields the usage page does", () => {
    // The strip is a second consumer of /api/usage/stats, and it is the one
    // nobody looks at twice. If a field is renamed, the usage page breaks
    // loudly during the change and the strip just shows an em dash forever —
    // indistinguishable from an idle day. Pin the two together so a rename
    // cannot land on one without the other.
    const stripKeys = [...read(STRIP).matchAll(/key: "(\w+)"/g)].map((m) => m[1]);
    expect(stripKeys.length, "no tiles found — did TILES change shape?").toBe(4);

    const overview = read(OVERVIEW);
    for (const key of stripKeys) {
      expect(overview, `usage page does not read stats.${key}`).toContain(`stats.${key}`);
    }
  });

  it("asks for a period the route accepts", () => {
    const period = read(STRIP).match(/usage\/stats\?period=(\w+)/)?.[1];
    expect(period, "strip does not call the stats route").toBeTruthy();
    const valid = read(ROUTE).match(/VALID_PERIODS = new Set\(\[([^\]]+)\]/)?.[1] || "";
    expect(valid, `route rejects period=${period}`).toContain(`"${period}"`);
  });

  it("shows an em dash when the number is unknown, never a zero", () => {
    // Zero requests is a claim about the day. "The request failed" is not that
    // claim, and a strip that renders 0 during a blip reads as "nothing is
    // working" — which sends someone debugging a router that is fine.
    const src = read(STRIP);
    expect(src, "the unknown branch must render an em dash").toMatch(/\?\s*"—"/);
    expect(src, "a `|| 0` would turn an unknown into a claim of zero").not.toMatch(/\]\s*\|\|\s*0/);
    expect(src, "a failed read must not zero the stats").not.toMatch(/setStats\(\s*\{[^}]*0/);
  });

  it("keeps the last good numbers on a failed poll and marks them stale", () => {
    const src = read(STRIP);
    const catchBlock = src.slice(src.indexOf("} catch"), src.indexOf("}, []);"));
    expect(catchBlock, "a failed poll must not blank the strip").not.toContain("setStats(null)");
    expect(catchBlock, "a failed poll must mark the numbers stale").toContain("setFailed(true)");
  });

  it("aborts its in-flight request when unmounted", () => {
    // The strip polls for as long as the page is open; without the abort, a
    // navigation mid-request resolves into a dead component.
    const src = read(STRIP);
    expect(src).toContain("new AbortController()");
    expect(src).toContain("controller.abort()");
    expect(src, "an aborted fetch is not a failure and must not mark stale").toMatch(/AbortError/);
  });
});
