// SQLite stores TEXT as a NUL-terminated C string, so a bound string carrying an
// embedded NUL either throws (better-sqlite3: "String contains null byte", which aborts
// the background flush worker) or is silently truncated (node:sqlite keeps only the
// prefix). Telemetry binds values that can contain raw bytes — a model id or endpoint
// from the request, tool output, a diff — so both outcomes are reachable in normal use.
// Sanitising at the binding boundary fixes it once for all four drivers.
// Upstream 5a4e812e, #5055.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stripNullBytes } from "../../src/lib/db/helpers/nullBytes.js";

// The same wrapper driver.js applies to the adapter, re-created here so the binding
// contract can be asserted without standing up a real SQLite driver.
function withNullByteSafeParams(adapter) {
  const clean = (params) => (Array.isArray(params) ? params.map(stripNullBytes) : params);
  return {
    ...adapter,
    run: (sql, params = []) => adapter.run(sql, clean(params)),
    get: (sql, params = []) => adapter.get(sql, clean(params)),
    all: (sql, params = []) => adapter.all(sql, clean(params)),
  };
}

function recordingAdapter() {
  const calls = [];
  const record = (method) => (sql, params) => {
    calls.push({ method, sql, params });
    return method === "all" ? [] : undefined;
  };
  return {
    calls,
    adapter: {
      driver: "test",
      raw: { sentinel: true },
      run: record("run"),
      get: record("get"),
      all: record("all"),
      exec: (sql) => calls.push({ method: "exec", sql }),
      transaction: (fn) => fn(),
      close: () => calls.push({ method: "close" }),
    },
  };
}

describe("stripNullBytes", () => {
  it("removes every NUL from a string", () => {
    expect(stripNullBytes("a\0b\0c")).toBe("abc");
    expect(stripNullBytes("\0leading")).toBe("leading");
    expect(stripNullBytes("trailing\0")).toBe("trailing");
  });

  it("returns a clean string unchanged, by identity", () => {
    const s = "no nulls here";
    expect(stripNullBytes(s)).toBe(s);
  });

  it("leaves other control characters alone", () => {
    expect(stripNullBytes("a\tb\nc\r")).toBe("a\tb\nc\r");
  });

  // Numbers, null and undefined are not text; Buffers bind as BLOBs, which carry an
  // explicit length and store binary correctly — mangling one would corrupt real data.
  it("passes non-strings through untouched", () => {
    const buf = Buffer.from([0x00, 0x01, 0x00]);
    expect(stripNullBytes(buf)).toBe(buf);
    expect(stripNullBytes(buf).length).toBe(3);
    expect(stripNullBytes(42)).toBe(42);
    expect(stripNullBytes(0)).toBe(0);
    expect(stripNullBytes(null)).toBe(null);
    expect(stripNullBytes(undefined)).toBe(undefined);
    expect(stripNullBytes(false)).toBe(false);
  });
});

describe("the driver wrapper sanitizes every bound-param path", () => {
  it("cleans params on run, get and all", () => {
    const { calls, adapter } = recordingAdapter();
    const safe = withNullByteSafeParams(adapter);

    safe.run("INSERT INTO t VALUES (?)", ["mo\0del"]);
    safe.get("SELECT * FROM t WHERE a = ?", ["en\0dpoint"]);
    safe.all("SELECT * FROM t WHERE a = ?", ["di\0ff"]);

    expect(calls.map((c) => c.params)).toEqual([["model"], ["endpoint"], ["diff"]]);
  });

  it("keeps mixed param types in place while cleaning only the strings", () => {
    const { calls, adapter } = recordingAdapter();
    withNullByteSafeParams(adapter).run("INSERT INTO t VALUES (?,?,?,?)", [
      "a\0b", 7, null, "clean",
    ]);
    expect(calls[0].params).toEqual(["ab", 7, null, "clean"]);
  });

  it("tolerates a missing params argument", () => {
    const { calls, adapter } = recordingAdapter();
    withNullByteSafeParams(adapter).run("VACUUM");
    expect(calls[0].params).toEqual([]);
  });

  it("passes a non-array params value through rather than throwing", () => {
    const { calls, adapter } = recordingAdapter();
    withNullByteSafeParams(adapter).get("SELECT ?", { named: "v\0al" });
    expect(calls[0].params).toEqual({ named: "v\0al" });
  });

  // exec takes no bound params, and the rest of the adapter surface must survive the
  // wrap or callers lose transactions and shutdown.
  it("preserves the adapter's other members", () => {
    const { adapter } = recordingAdapter();
    const safe = withNullByteSafeParams(adapter);
    expect(safe.driver).toBe("test");
    expect(safe.raw).toBe(adapter.raw);
    expect(typeof safe.exec).toBe("function");
    expect(typeof safe.transaction).toBe("function");
    expect(typeof safe.close).toBe("function");
    expect(safe.transaction(() => "committed")).toBe("committed");
  });
});

describe("driver.js wires the wrapper in", () => {
  it("imports the helper and applies it before the migration", () => {
    const src = fs.readFileSync(new URL("../../src/lib/db/driver.js", import.meta.url), "utf8");

    expect(src).toContain('from "./helpers/nullBytes.js"');
    expect(src).toContain("withNullByteSafeParams(adapter)");
    // Migrations bind strings too, so the wrap has to come first.
    expect(src.indexOf("adapter = withNullByteSafeParams(adapter)"))
      .toBeLessThan(src.indexOf("runMigrationOnce"));
  });
});

// The cases above assert the contract; this one proves it against whichever SQLite
// driver this runtime actually picked, which is where the throw/truncate happened.
describe("a NUL-bearing string round-trips through the live adapter", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir;
  let adapter;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-nulbyte-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    const { getAdapter } = await import("@/lib/db/driver.js");
    adapter = await getAdapter();
    adapter.exec("CREATE TABLE IF NOT EXISTS nul_probe (id INTEGER PRIMARY KEY, v TEXT)");
  });

  afterAll(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("neither throws nor loses the tail after the NUL", () => {
    // Measured without the wrapper on this tree (better-sqlite3 present, Node 26): the
    // insert does not throw, it stores the literal NUL — so the value comes back with a
    // NUL in it and the equality lookup below misses. Older better-sqlite3 throws
    // "String contains null byte" and node:sqlite truncates at the NUL; all three
    // outcomes are wrong, which is why this is fixed at the binding boundary.
    expect(() => adapter.run("INSERT INTO nul_probe (v) VALUES (?)", ["model\u0000-id-tail"]))
      .not.toThrow();

    const row = adapter.get("SELECT v FROM nul_probe ORDER BY id DESC LIMIT 1");
    expect(row.v).toBe("model-id-tail");
    expect(row.v).not.toContain("\u0000");
  });

  it("matches on a NUL-bearing value bound in a WHERE clause", () => {
    adapter.run("INSERT INTO nul_probe (v) VALUES (?)", ["lookup-key"]);
    const row = adapter.get("SELECT v FROM nul_probe WHERE v = ?", ["lookup\u0000-key"]);
    expect(row?.v).toBe("lookup-key");
  });
});
