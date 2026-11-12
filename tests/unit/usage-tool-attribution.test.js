/**
 * Usage is attributed to the IDE a request was captured from, not only to the
 * provider that served it.
 *
 * The MITM rewrites the model before forwarding — an Antigravity `gemini-*` turn
 * leaves as whatever alias serves it — so the router had nothing left to
 * attribute by except the serving provider. Measured on a live install: Kiro and
 * Antigravity were demonstrably being captured and answered, while usage read
 * "kiro: 1 request, 18h ago". The requests were real and recorded; they were
 * filed under `claude`.
 *
 * Also covers the double count found while fixing the above: a streaming request
 * wrote TWO usageHistory rows, because finalizeStream recorded via logUsage AND
 * via onStreamComplete -> saveUsageStats.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { MITM_TOOL_HEADER, MITM_TOOLS, normalizeMitmTool } from "@/shared/constants/mitmToolHosts";
import { mitmToolFromRequest } from "../../open-sse/utils/mitmTool.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-tool-attr-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function usage({ model, tool, promptTokens = 10, provider = "claude" }) {
  return db.saveRequestUsage({
    provider, model, connectionId: "c1",
    tokens: { prompt_tokens: promptTokens, completion_tokens: 1 },
    endpoint: "/v1/messages", status: "ok", tool,
  });
}

describe("intercepted-tool attribution", () => {
  it("names only the tools the MITM can actually capture", () => {
    // The hosts map is the definition; a tool the MITM has no hosts for could
    // never produce a request, so it must not be an accepted bucket either.
    expect(MITM_TOOLS).toEqual(expect.arrayContaining(["antigravity", "kiro", "claude", "cursor"]));
  });

  it("rejects a tool name it does not recognise", () => {
    // The header rides in on an ordinary client request, so anything that can
    // reach /v1/* can set it. Taking it verbatim would let a caller invent
    // buckets, or write something that is not a string at all into the stats.
    expect(normalizeMitmTool("kiro")).toBe("kiro");
    expect(normalizeMitmTool("  KIRO ")).toBe("kiro");
    expect(normalizeMitmTool("not-a-tool")).toBeNull();
    expect(normalizeMitmTool("")).toBeNull();
    expect(normalizeMitmTool(undefined)).toBeNull();
    expect(normalizeMitmTool(null)).toBeNull();
    expect(normalizeMitmTool(42)).toBeNull();
    expect(normalizeMitmTool({ toString: () => "kiro" })).toBeNull();
  });

  it("reads the tool off a captured request, and nothing off a direct one", () => {
    expect(mitmToolFromRequest({ headers: { [MITM_TOOL_HEADER]: "antigravity" } })).toBe("antigravity");
    // request.headers.entries() lower-cases, but a hand-built bag may not.
    expect(mitmToolFromRequest({ headers: { "X-Krouter-Mitm-Tool": "kiro" } })).toBe("kiro");
    // A direct caller to /v1/* is not a captured request and must stay unlabelled.
    expect(mitmToolFromRequest({ headers: {} })).toBeNull();
    expect(mitmToolFromRequest({})).toBeNull();
    expect(mitmToolFromRequest(null)).toBeNull();
    expect(mitmToolFromRequest({ headers: { [MITM_TOOL_HEADER]: "evil" } })).toBeNull();
  });

  /** Totals per tool, collapsing the tool|model|provider buckets. */
  function perTool(stats) {
    const out = {};
    for (const e of Object.values(stats.byTool)) {
      out[e.tool] ||= { requests: 0, promptTokens: 0 };
      out[e.tool].requests += e.requests;
      out[e.tool].promptTokens += e.promptTokens;
    }
    return out;
  }

  it("buckets usage by tool in the live path (today / 24h)", async () => {
    await usage({ model: "tool-live", tool: "kiro", promptTokens: 10 });
    await usage({ model: "tool-live", tool: "kiro", promptTokens: 20 });
    await usage({ model: "tool-live", tool: "antigravity", promptTokens: 5 });

    for (const period of ["24h", "today"]) {
      const t = perTool(await db.getUsageStats(period));
      expect(t.kiro.requests, `period=${period}`).toBe(2);
      expect(t.kiro.promptTokens).toBe(30);
      expect(t.antigravity.requests).toBe(1);
    }
  });

  it("breaks a tool down by the model that actually served it", async () => {
    // The MITM rewrites the model on the way through, so "which model did my
    // Kiro turns land on" is unanswerable from byModel alone — that bucket mixes
    // captured and direct traffic.
    await usage({ model: "tool-split-a", tool: "cursor", promptTokens: 1 });
    await usage({ model: "tool-split-b", tool: "cursor", promptTokens: 2 });

    const stats = await db.getUsageStats("24h");
    const rows = Object.values(stats.byTool).filter((e) => e.tool === "cursor" && e.rawModel.startsWith("tool-split"));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.rawModel).sort()).toEqual(["tool-split-a", "tool-split-b"]);
    for (const r of rows) expect(r.provider).toBe("claude");
  });

  it("agrees with the daily rollup, which aggregates separately", async () => {
    // Two independent code paths build these stats — the raw-row scan for
    // today/24h and the usageDaily rollup for longer periods. A tool recorded in
    // one and missing from the other is how "capture is off" gets reported while
    // capture is on, so both are checked against the same rows.
    const live = perTool(await db.getUsageStats("24h"));
    const daily = perTool(await db.getUsageStats("7d"));
    expect(daily.kiro.requests).toBe(live.kiro.requests);
    expect(daily.antigravity.requests).toBe(live.antigravity.requests);
    expect(daily.cursor.requests).toBe(live.cursor.requests);
  });

  it("leaves a request that was not captured out of byTool but still counts it", async () => {
    const before = await db.getUsageStats("24h");
    const toolTotalBefore = Object.values(before.byTool).reduce((n, t) => n + t.requests, 0);

    await usage({ model: "tool-direct", tool: null, promptTokens: 7 });

    const after = await db.getUsageStats("24h");
    // byTool is not a partition of the day: it covers captured requests only.
    const toolTotalAfter = Object.values(after.byTool).reduce((n, t) => n + t.requests, 0);
    expect(toolTotalAfter).toBe(toolTotalBefore);
    // ...but the request is still a request.
    expect(after.byProvider.claude.requests).toBe(before.byProvider.claude.requests + 1);
  });

  it("records the tool on the row, so history is attributable too", async () => {
    await usage({ model: "tool-row", tool: "cursor", promptTokens: 3 });
    const rows = await db.getUsageHistory({});
    const row = rows.find((r) => r.model === "tool-row");
    expect(row, "the row must exist").toBeTruthy();
    expect(row.tool).toBe("cursor");
    // A row from a direct caller reads back as null, not as a missing field —
    // which is also what every row written before this shipped looks like.
    const direct = rows.find((r) => r.model === "tool-direct");
    expect(direct.tool).toBeNull();
  });
});

describe("the MITM labels the request it forwards", () => {
  async function captureForwardedHeaders({ clientHeaders }) {
    vi.resetModules();
    let sent = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (url, init) => {
      sent = { url, headers: init.headers };
      return Promise.resolve({ status: 200, headers: new Map(), body: null, text: () => Promise.resolve("") });
    };
    try {
      const { fetchRouter } = await import("../../src/mitm/handlers/base.js");
      await fetchRouter({ model: "m" }, "/v1/messages", clientHeaders);
      return sent.headers;
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  it("derives the tool from the host that selected the handler", async () => {
    const h = await captureForwardedHeaders({ clientHeaders: { host: "api.anthropic.com" } });
    expect(h[MITM_TOOL_HEADER]).toBe("claude");

    const k = await captureForwardedHeaders({ clientHeaders: { host: "runtime.us-east-1.kiro.dev" } });
    expect(k[MITM_TOOL_HEADER]).toBe("kiro");
  });

  it("overrides a tool header the client supplied, in any casing", async () => {
    // fetchRouter forwards the client's headers wholesale. A tool that sent its
    // own copy of this header — or anything trying to misattribute its spend —
    // must not be able to outvote the host we actually intercepted.
    const h = await captureForwardedHeaders({
      clientHeaders: {
        host: "api.anthropic.com",
        [MITM_TOOL_HEADER]: "kiro",
        "X-Krouter-Mitm-Tool": "antigravity",
      },
    });
    const values = Object.entries(h)
      .filter(([k]) => k.toLowerCase() === MITM_TOOL_HEADER)
      .map(([, v]) => v);
    expect(values, "exactly one value may reach the router").toEqual(["claude"]);
  });

  it("labels nothing when the host is not one we intercept", async () => {
    const h = await captureForwardedHeaders({ clientHeaders: { host: "example.com" } });
    const present = Object.keys(h).some((k) => k.toLowerCase() === MITM_TOOL_HEADER);
    expect(present).toBe(false);
  });
});

describe("one request, one usage row", () => {
  it("counts a streaming turn once when a recorder already owns it", async () => {
    // logUsage used to write a row of its own on top of the one saveUsageStats
    // writes from onStreamComplete. Identical tokens, milliseconds apart, and
    // both counted — so totals, cost and the lifetime counter all ran ~2x for
    // every stream.
    vi.resetModules();
    const saved = [];
    vi.doMock("@/lib/usageDb.js", () => ({
      saveRequestUsage: (e) => { saved.push(e); return Promise.resolve(); },
      appendRequestLog: () => Promise.resolve(),
    }));
    const { logUsage } = await import("../../open-sse/utils/usageTracking.js");
    const usageObj = { prompt_tokens: 11, completion_tokens: 22 };

    logUsage("claude", usageObj, "m", "c1", null, { record: false });
    expect(saved, "a turn another recorder owns must not be written here").toHaveLength(0);

    logUsage("claude", usageObj, "m", "c1", null, { record: true, tool: "kiro" });
    expect(saved).toHaveLength(1);
    expect(saved[0].tool).toBe("kiro");

    vi.doUnmock("@/lib/usageDb.js");
    vi.resetModules();
  });
});
