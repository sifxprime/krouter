// Drives the crash-loop recovery for real: a temp DATA_DIR, the actual SQLite
// layer, and the actual consumeMitmRecoveryMarker().
//
// This exists because the static contract tests could not answer the question
// that mattered -- does the write land somewhere the app will read? The previous
// two versions of this path both passed every check that looked at shape and
// still did nothing at runtime: one wrote to the wrong directory, the next wrote
// to db.json, a file the app had migrated into SQLite and no longer reads.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const MARKER = ".mitm-recovery";
let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-mitm-rec-"));
  process.env.DATA_DIR = tempDir;
  // DATA_DIR is read at module load and the DB adapter is a global singleton,
  // so both have to be reset or every case after the first reuses the first
  // case's directory.
  delete global._dbAdapter;
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch { /* already closed */ }
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  vi.restoreAllMocks();
  // doMock registrations outlive resetModules, so an un-mocked case that
  // runs after the failure case would otherwise inherit its rejecting stub.
  vi.doUnmock("@/lib/localDb");
  vi.resetModules();
});

const writeMarker = (body = { reason: "crash-loop", restarts: 2 }) =>
  fs.writeFileSync(path.join(tempDir, MARKER), typeof body === "string" ? body : JSON.stringify(body));

const markerExists = () => fs.existsSync(path.join(tempDir, MARKER));

describe("MITM crash-loop recovery, driven for real", () => {
  it("does nothing when there is no marker", async () => {
    const { consumeMitmRecoveryMarker } = await import("@/shared/services/mitmRecovery");
    expect(await consumeMitmRecoveryMarker()).toBe("no-marker");
  });

  it("disables MITM and removes the marker", async () => {
    const { consumeMitmRecoveryMarker } = await import("@/shared/services/mitmRecovery");
    const { getSettings } = await import("@/lib/localDb");

    writeMarker();
    expect(await consumeMitmRecoveryMarker()).toBe("disabled");

    expect((await getSettings()).mitmEnabled).toBe(false);
    expect(markerExists()).toBe(false);
  });

  it("works on a fresh install, where no settings row exists yet", async () => {
    // The row is created lazily on first write. A plain UPDATE would match zero
    // rows here and the recovery would silently do nothing -- the exact failure
    // mode this whole path keeps falling into.
    const { consumeMitmRecoveryMarker } = await import("@/shared/services/mitmRecovery");
    const { getSettings } = await import("@/lib/localDb");

    writeMarker();
    expect(await consumeMitmRecoveryMarker()).toBe("disabled");
    expect((await getSettings()).mitmEnabled).toBe(false);
  });

  it("persists to the SQLite file, not just to an in-memory view", async () => {
    const { consumeMitmRecoveryMarker } = await import("@/shared/services/mitmRecovery");
    writeMarker();
    await consumeMitmRecoveryMarker();

    const dbFile = path.join(tempDir, "db", "data.sqlite");
    expect(fs.existsSync(dbFile)).toBe(true);

    // Read it back out of band, through a different connection, so this cannot
    // pass on a cached object.
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbFile, { readonly: true });
    try {
      const row = db.prepare("SELECT data FROM settings WHERE id = 1").get();
      expect(row).toBeTruthy();
      expect(JSON.parse(row.data).mitmEnabled).toBe(false);
    } finally {
      db.close();
    }
  });

  it("leaves every other setting alone", async () => {
    const { consumeMitmRecoveryMarker } = await import("@/shared/services/mitmRecovery");
    const { getSettings, updateSettings } = await import("@/lib/localDb");

    await updateSettings({ mitmEnabled: true, tunnelUrl: "https://example.invalid", stickyRoundRobinLimit: 9 });

    writeMarker();
    await consumeMitmRecoveryMarker();

    const after = await getSettings();
    expect(after.mitmEnabled).toBe(false);
    expect(after.tunnelUrl).toBe("https://example.invalid");
    expect(after.stickyRoundRobinLimit).toBe(9);
  });

  it("still disables MITM when the marker is truncated or unreadable", async () => {
    const { consumeMitmRecoveryMarker } = await import("@/shared/services/mitmRecovery");
    const { getSettings } = await import("@/lib/localDb");

    writeMarker("{not-valid-json");
    expect(await consumeMitmRecoveryMarker()).toBe("disabled");
    expect((await getSettings()).mitmEnabled).toBe(false);
  });

  it("keeps the marker when the write fails, so the next boot retries", async () => {
    vi.doMock("@/lib/localDb", () => ({
      updateSettings: vi.fn().mockRejectedValue(new Error("database is locked")),
    }));
    const { consumeMitmRecoveryMarker } = await import("@/shared/services/mitmRecovery");

    writeMarker();
    expect(await consumeMitmRecoveryMarker()).toBe("write-failed");
    expect(markerExists()).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it("is idempotent — a second run with no marker left is a no-op", async () => {
    const { consumeMitmRecoveryMarker } = await import("@/shared/services/mitmRecovery");
    writeMarker();
    expect(await consumeMitmRecoveryMarker()).toBe("disabled");
    expect(await consumeMitmRecoveryMarker()).toBe("no-marker");
  });
});
