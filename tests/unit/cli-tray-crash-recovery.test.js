import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Tray mode (`krouter -t`) returns early from startServer. Crash handling used to be
// attached as the LAST statement of startServer, so tray mode never got it: a crashed
// server was never restarted, EADDRINUSE never recovered, and the MITM crash-loop
// recovery inside tryRestart could not run -- in the mode the README recommends.
//
// The rule this pins: the first spawn is followed by attachServerEvents() before any
// early return can be reached.
const SRC = readFileSync(path.resolve("cli/cli.js"), "utf8");

describe("CLI crash recovery is wired in every start mode", () => {
  const spawn = SRC.indexOf("let server = spawnServer();");
  const attach = SRC.indexOf("attachServerEvents();", spawn);
  const trayReturn = SRC.indexOf("if (trayMode) {", spawn);

  it("finds the first spawn, the attach, and the tray branch", () => {
    expect(spawn).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(-1);
    expect(trayReturn).toBeGreaterThan(-1);
  });

  it("attaches crash handling before the tray-mode early return", () => {
    expect(attach).toBeLessThan(trayReturn);
  });

  it("no longer attaches a second time at the end of startServer", () => {
    // A trailing call would double-register listeners on the first child, so every
    // crash would call tryRestart twice and spawn two replacement servers.
    const firstAttach = SRC.indexOf("attachServerEvents();", spawn);
    const between = SRC.slice(firstAttach + 1, SRC.indexOf("function attachServerEvents"));
    // Re-attaching after a RESPAWN is correct (new child, new listeners); a bare
    // top-level attach on the original child is the bug.
    expect(SRC).not.toMatch(/\n  attachServerEvents\(\);\n\}/);
    expect(between).toBeDefined();
  });
});
