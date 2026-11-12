// The menu used to show only the server URL, so "Hide to Tray" was a guess:
// nothing told the user whether a background service already existed, or
// whether the last attempt had worked. A silent failure looked exactly like a
// success. These pin the distinction the menu now draws.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { describeBackground } = require("../../cli/src/cli/tray/status.js");

describe("background status is described honestly", () => {
  it("says a terminal-tied server will die with the terminal", () => {
    const text = describeBackground({ mode: "terminal" });
    expect(text).toMatch(/closing it stops kRouter/i);
    // The old message claimed the opposite for exactly this case.
    expect(text).not.toMatch(/survives/i);
  });

  it("only claims survival for launchd and detached owners", () => {
    for (const mode of ["launchd", "detached"]) {
      expect(describeBackground({ mode }), mode).toMatch(/survives closing this terminal/i);
    }
  });

  it("does not dress up 'not running' as anything else", () => {
    expect(describeBackground({ mode: "none" })).toMatch(/not running/i);
  });

  it("admits when it cannot attribute the owner", () => {
    // Better than guessing "background" and being wrong.
    expect(describeBackground({ mode: "whatever" })).toMatch(/unknown/i);
  });
});

describe("the menu adapts to that state", () => {
  it("offers to leave a running background service alone", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("cli/cli.js", "utf8");
    expect(src, "a running background service must be leave-able").toMatch(/\?\s*"detach"\s*:/);
    // And picking it must not run the Exit path, which kills the server.
    const i = src.indexOf('choice === "detach"');
    expect(i).toBeGreaterThan(-1);
    const branch = src.slice(i, i + 700);
    expect(branch).not.toMatch(/killAllAppProcesses|cleanup\(\)/);
  });
});
