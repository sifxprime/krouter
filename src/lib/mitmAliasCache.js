// JSON cache for mitmAlias — read by standalone MITM server (no SQLite native binding).
// Source of truth = SQLite kv['mitmAlias']. JSON is a read-replica synced on app start
// and after every UI write.
import fs from "fs";
import path from "path";
// Not a local copy. This file WRITES the cache and src/mitm/dbReader.js READS
// it, each resolving $DATA_DIR/mitm/aliases.json for itself -- and until 0.5.195
// both did so without the Windows guard. They therefore agreed with each other
// while disagreeing with the database, which is the shape that hides: the whole
// flow worked, and fixing either side alone would have been what broke it, by
// pointing the reader at a file the writer no longer writes. A MITM that reads
// an empty alias map does not fail; it passes every request through, so the
// IDE's own subscription pays and kRouter logs nothing.
//
// Both sides now resolve through a resolver in tests/unit/cli-data-dir.test.js's
// list, which is pinned to agree with this one.
import { DATA_DIR } from "@/lib/dataDir.js";

const CACHE_FILE = path.join(DATA_DIR, "mitm", "aliases.json");

function writeAtomic(data) {
  const dir = path.dirname(CACHE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${CACHE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, CACHE_FILE);
}

// Sync entire mitmAlias map from DB → JSON file
export async function syncToJson() {
  try {
    const { getMitmAlias } = await import("@/lib/db/repos/aliasRepo.js");
    const all = await getMitmAlias();
    writeAtomic(all || {});
  } catch (e) {
    console.log("[mitmAliasCache] sync failed:", e.message);
  }
}

// Update cache for a single tool after UI saves to DB
export function writeAliasForTool(tool, mappings) {
  try {
    let current = {};
    if (fs.existsSync(CACHE_FILE)) {
      try { current = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { /* corrupted → reset */ }
    }
    current[tool] = mappings || {};
    writeAtomic(current);
  } catch (e) {
    console.log("[mitmAliasCache] write failed:", e.message);
  }
}
