import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The CLI supervisor and the app agree on one filename so the supervisor can ask
// for MITM to be disabled without knowing how the app stores settings. They live
// in different packages and cannot import each other, so the constant is
// duplicated -- which is exactly how the previous version of this recovery path
// rotted: cli.js patched `mitmEnabled` in DATA_DIR/db.json long after the app had
// migrated settings into SQLite, so the write landed in a file nothing read and
// the server kept crash-looping with the safety valve doing nothing.
//
// These are the static half of the contract. mitm-recovery-behavior.test.js
// drives the real thing against a real SQLite database.

const CLI_SRC = readFileSync(path.resolve("cli/cli.js"), "utf8");
const REC_SRC = readFileSync(path.resolve("src/shared/services/mitmRecovery.js"), "utf8");
const INIT_SRC = readFileSync(path.resolve("src/shared/services/initializeApp.js"), "utf8");

const markerFrom = (src) => {
  const m = src.match(/MITM_RECOVERY_MARKER = "([^"]+)"/);
  return m && m[1];
};

describe("MITM crash-loop recovery contract", () => {
  it("both sides declare the marker filename", () => {
    expect(markerFrom(CLI_SRC)).toBeTruthy();
    expect(markerFrom(REC_SRC)).toBeTruthy();
  });

  it("the two filenames are identical", () => {
    expect(markerFrom(CLI_SRC)).toBe(markerFrom(REC_SRC));
  });

  it("the supervisor writes the marker and no longer patches db.json", () => {
    expect(CLI_SRC).toMatch(/path\.join\(getAppDataDir\(\), MITM_RECOVERY_MARKER\)/);
    // The dead write that made this path a no-op.
    expect(CLI_SRC).not.toMatch(/getAppDataDir\(\),\s*"db\.json"/);
    expect(CLI_SRC).not.toMatch(/db\.settings\.mitmEnabled = false/);
  });

  it("the supervisor reports a failed write instead of swallowing it", () => {
    // The original was `catch { /* best effort */ }`, which is how a broken
    // recovery path stays invisible.
    const from = CLI_SRC.indexOf("MITM_RECOVERY_MARKER)");
    const block = CLI_SRC.slice(from, CLI_SRC.indexOf("restartCount = 0;", from));
    expect(block).toMatch(/console\.error/);
  });

  it("the app disables MITM through updateSettings, not by touching storage", () => {
    expect(REC_SRC).toMatch(/updateSettings\(\{\s*mitmEnabled:\s*false\s*\}\)/);
    // It must not reach around the repo layer. Checked against imports and SQL
    // rather than any mention of the old path -- the comments in that file
    // deliberately name db.json to explain why this code exists.
    expect(REC_SRC).not.toMatch(/(from|require\()\s*["']better-sqlite3["']/);
    expect(REC_SRC).not.toMatch(/INSERT INTO|UPDATE\s+settings\s+SET/i);
  });

  it("the boot path consumes the marker before it reads settings", () => {
    const consume = INIT_SRC.indexOf("await consumeMitmRecoveryMarker();");
    const read = INIT_SRC.indexOf("const settings = await getSettings();", consume);
    expect(consume).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(consume);
  });

  it("the marker is removed only after the write succeeds", () => {
    // Ordering matters: unlinking first would lose the request if the write
    // then failed, and the next boot would crash-loop again with no marker left.
    expect(REC_SRC.indexOf("updateSettings(")).toBeLessThan(REC_SRC.indexOf("unlinkSync("));
    // And the failure branch must return before reaching the unlink.
    expect(REC_SRC).toMatch(/return "write-failed";/);
  });
});
