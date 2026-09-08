/**
 * Nothing on the connection-test path had a deadline. A provider whose endpoint
 * blackholes traffic — a dead upstream, a firewalled host, a mistyped proxy URL —
 * left the dashboard's Test button spinning forever, the route handler never
 * returned, and every retry pinned another socket.
 *
 * Ported from upstream df85e16d.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf-8");
const stripComments = (src) => src.split("\n")
  .filter((l) => !l.trim().startsWith("//")).join("\n");

describe("connection tests cannot hang forever", () => {
  it("gives every proxied test fetch a deadline", () => {
    const src = stripComments(read("src/app/api/providers/[id]/test/testUtils.js"));
    expect(src).toContain("AbortSignal.timeout(15000)");
  });

  it("does not clobber a caller's own signal", () => {
    const src = stripComments(read("src/app/api/providers/[id]/test/testUtils.js"));
    // Overwriting an existing signal would break a caller that wants to cancel early.
    expect(src).toContain("if (!options.signal)");
  });

  it("aborts rather than hanging, and does so within the window", async () => {
    // Real behaviour of the primitive the fix relies on: a fetch given this signal
    // rejects instead of waiting on a socket that never answers.
    const signal = AbortSignal.timeout(60);
    const start = Date.now();
    await new Promise((r) => signal.addEventListener("abort", r, { once: true }));
    expect(signal.aborted).toBe(true);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});

describe("provider search survives a nameless node", () => {
  it("guards the name before lowercasing it", () => {
    const src = stripComments(read("src/app/(dashboard)/dashboard/providers/page.js"));
    expect(src).toContain("if (!name) return false;");
  });

  it("the guarded predicate behaves correctly", () => {
    // Mirrors the shipped matchSearch.
    const matchSearch = (searchQuery) => (name) => {
      if (!searchQuery.trim()) return true;
      if (!name) return false;
      return name.toLowerCase().includes(searchQuery.trim().toLowerCase());
    };
    expect(matchSearch("")(undefined)).toBe(true);
    expect(matchSearch("open")(undefined)).toBe(false);
    expect(matchSearch("open")(null)).toBe(false);
    expect(matchSearch("open")("OpenAI")).toBe(true);
    expect(matchSearch("zzz")("OpenAI")).toBe(false);
  });
});
