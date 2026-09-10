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
// These tests pin the contract. A filename is a far smaller thing to keep in
// sync than a storage schema, but "smaller" is not "automatic".

const CLI_SRC = readFileSync(path.resolve("cli/cli.js"), "utf8");
const APP_SRC = readFileSync(path.resolve("src/shared/services/initializeApp.js"), "utf8");

const markerFrom = (src) => {
  const m = src.match(/const MITM_RECOVERY_MARKER = "([^"]+)"/);
  return m && m[1];
};

describe("MITM crash-loop recovery contract", () => {
  it("both sides declare the marker filename", () => {
    expect(markerFrom(CLI_SRC)).toBeTruthy();
    expect(markerFrom(APP_SRC)).toBeTruthy();
  });

  it("the two filenames are identical", () => {
    expect(markerFrom(CLI_SRC)).toBe(markerFrom(APP_SRC));
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
    const block = CLI_SRC.slice(CLI_SRC.indexOf("MITM_RECOVERY_MARKER)"), CLI_SRC.indexOf("restartCount = 0;", CLI_SRC.indexOf("MITM_RECOVERY_MARKER)")));
    expect(block).toMatch(/console\.error/);
  });

  it("the app disables MITM through updateSettings, not by touching storage", () => {
    expect(APP_SRC).toMatch(/updateSettings\(\{\s*mitmEnabled:\s*false\s*\}\)/);
  });

  it("the app consumes the marker before it reads settings", () => {
    const consume = APP_SRC.indexOf("await consumeMitmRecoveryMarker();");
    const read = APP_SRC.indexOf("const settings = await getSettings();", consume);
    expect(consume).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(consume);
  });

  it("the app removes the marker only after the write succeeds", () => {
    // Ordering matters: unlinking first would lose the request if the write
    // then failed, and the next boot would crash-loop again with no marker left.
    const fn = APP_SRC.slice(
      APP_SRC.indexOf("async function consumeMitmRecoveryMarker()"),
      APP_SRC.indexOf("async function autoStartMitm()")
    );
    expect(fn).toBeTruthy();
    expect(fn.indexOf("updateSettings(")).toBeLessThan(fn.indexOf("unlinkSync("));
    // And the failure branch must return before reaching the unlink.
    expect(fn).toMatch(/console\.error\([\s\S]*?\n\s*\);\n\s*return;/);
  });
});
