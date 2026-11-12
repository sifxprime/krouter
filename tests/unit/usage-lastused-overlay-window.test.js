/**
 * getUsageStats("all") refined lastUsed by reading the WHOLE usageHistory table
 * into JS (about 2 s on 290K rows), and it ran on every stats update for every
 * open dashboard listener. The overlay now scans a two-day indexed range; older
 * entries keep the day-level lastUsed from usageDaily. Totals are unaffected
 * because they come from usageDaily.
 *
 * Ported from upstream d1de3245 (usageRepo half).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const DAY_MS = 86400000;
const OVERLAY_SQL = "SELECT timestamp, provider, model, connectionId, apiKey, endpoint, meta FROM usageHistory WHERE timestamp >= ?";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let adapter;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-overlay-window-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function overlayCutoffFor(period) {
  const spy = vi.spyOn(adapter, "all");
  const before = Date.now();
  const stats = await db.getUsageStats(period);
  const call = spy.mock.calls.find(([sql]) => sql === OVERLAY_SQL);
  expect(call, `overlay query not issued for period=${period}`).toBeTruthy();
  return { cutoffMs: new Date(call[1][0]).getTime(), before, stats };
}

describe("lastUsed overlay is bounded to a recent window", () => {
  it("does not scan the whole history table for period=all", async () => {
    const { cutoffMs, before } = await overlayCutoffFor("all");
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 2 * DAY_MS - 1000);
  });

  it("bounds the 7d/30d/60d overlay to the same window", async () => {
    for (const period of ["7d", "30d", "60d"]) {
      const { cutoffMs, before } = await overlayCutoffFor(period);
      expect(cutoffMs).toBeGreaterThanOrEqual(before - 2 * DAY_MS - 1000);
    }
  });

  it("still gives recent entries a precise lastUsed timestamp", async () => {
    const ts = new Date().toISOString();
    await db.saveRequestUsage({
      provider: "openai", model: "overlay-recent", connectionId: "c1", apiKey: "sk-overlay-recent-key-0001",
      tokens: { prompt_tokens: 3, completion_tokens: 1 }, endpoint: "/v1/chat/completions", status: "ok", timestamp: ts,
    });
    const stats = await db.getUsageStats("all");
    expect(stats.byModel["overlay-recent (openai)"].lastUsed).toBe(ts);
    expect(stats.byModel["overlay-recent (openai)"].requests).toBe(1);
  });

  it("gives a no-API-key bucket a precise lastUsed too", async () => {
    const ts = new Date().toISOString();
    await db.saveRequestUsage({
      provider: "openai", model: "overlay-nokey", connectionId: "c1",
      tokens: { prompt_tokens: 3, completion_tokens: 1 }, endpoint: "/v1/chat/completions", status: "ok", timestamp: ts,
    });
    const stats = await db.getUsageStats("all");
    const entry = Object.values(stats.byApiKey).find((e) => e.rawModel === "overlay-nokey");
    expect(entry.keyName).toBe("Local (No API Key)");
    expect(entry.lastUsed).toBe(ts);
  });

  it("keeps totals for entries older than the window (they come from usageDaily)", async () => {
    const old = new Date(Date.now() - 10 * DAY_MS).toISOString();
    await db.saveRequestUsage({
      provider: "openai", model: "overlay-old", connectionId: "c1",
      tokens: { prompt_tokens: 11, completion_tokens: 2 }, endpoint: "/v1/chat/completions", status: "ok", timestamp: old,
    });
    const stats = await db.getUsageStats("all");
    const entry = stats.byModel["overlay-old (openai)"];
    expect(entry.requests).toBe(1);
    expect(entry.promptTokens).toBe(11);
    // Day-level lastUsed (a dateKey) instead of the precise timestamp.
    expect(entry.lastUsed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
