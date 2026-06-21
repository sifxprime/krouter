import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os
vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock/home") },
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

// Mock child_process so the linux "which cursor" check works without spawning
vi.mock("child_process", () => ({
  execFile: vi.fn((cmd, args, opts, cb) => {
    if (typeof opts === "function") cb = opts;
    cb && cb(new Error("ENOENT"));
  }),
}));

// Shared mock state for better-sqlite3
const mockDb = {
  prepareImpl: null,
  closeCalled: false,
  __throwOnConstruct: false,
};

// Mock better-sqlite3 — implementation uses require() not ESM import, so we mock
// both default and the module shape. Implementation calls: new Database(dbPath, opts).
vi.mock("better-sqlite3", () => {
  const Database = function (dbPath, opts) {
    if (mockDb.__throwOnConstruct) throw new Error("SQLITE_CANTOPEN: unable to open database file");
    return {
      prepare: (sql) => mockDb.prepareImpl ? mockDb.prepareImpl(sql) : { get: () => null },
      close: () => { mockDb.closeCalled = true; },
    };
  };
  return { default: Database };
});

let GET;

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.prepareImpl = null;
    mockDb.closeCalled = false;
    mockDb.__throwOnConstruct = false;
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  it("returns not-found when no macOS cursor db paths are accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found");
    expect(response.body.error).toContain("Checked locations");
  });

  // NOTE: Tests that need to intercept `require("better-sqlite3")` (the SQL
  // happy-path extraction) are covered by the live cursor-import flow in dev,
  // not by vitest mocks — Next.js route uses CJS require which vitest's ESM
  // mock does not intercept cleanly. We only smoke-test the not-found /
  // fallback paths here.

  it("falls back to windowsManual when sqlite extraction fails (db can be opened but yields no tokens)", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDb.prepareImpl = () => ({ get: () => null });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toBeTruthy();
  });

  it("falls back to windowsManual when better-sqlite3 throws on construct", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDb.__throwOnConstruct = true;

    const response = await GET();

    // Both strategies fail → returns windowsManual prompt instead of crashing
    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
  });

  it("linux: returns 'Cursor not installed' error when config exists but no cursor binary present", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    vi.mocked(fsPromises.access).mockImplementation((p) => {
      // db path resolves, but cursor.desktop does not
      if (p.includes("state.vscdb")) return Promise.resolve();
      return Promise.reject(new Error("ENOENT"));
    });

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor IDE does not appear to be installed");
  });
});
