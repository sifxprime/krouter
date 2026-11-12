// The menu bar could not answer "is capture on". That is the question that
// costs the most time when a tool silently stops routing, because enabling
// capture while an IDE is already running looks exactly like it working.
//
// The icon answers it now. These pin the two things that make that safe: a
// stale pid file must not claim capture forever, and the state icons must stay
// valid macOS template images (black + alpha), since anything coloured there is
// flattened by the system anyway.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const ts = require("../../cli/src/cli/tray/trayState.js");

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-tray-"));
  fs.mkdirSync(path.join(dir, "mitm"), { recursive: true });
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

const pidFile = () => path.join(dir, "mitm", ".mitm.pid");

describe("tray state", () => {
  it("is running when no MITM pid file exists", () => {
    expect(ts.currentState({ appDataDir: dir })).toBe(ts.STATES.RUNNING);
  });

  it("is capturing when the pid file names a live process", () => {
    fs.writeFileSync(pidFile(), String(process.pid));
    expect(ts.currentState({ appDataDir: dir })).toBe(ts.STATES.CAPTURING);
  });

  it("does NOT claim capture for a stale pid file", () => {
    // The expected state after any hard kill of the MITM. Trusting the file
    // would leave the icon claiming capture forever after one pkill.
    fs.writeFileSync(pidFile(), "999999");
    expect(ts.currentState({ appDataDir: dir })).toBe(ts.STATES.RUNNING);
  });

  it("does not claim capture for a garbage pid file", () => {
    fs.writeFileSync(pidFile(), "not-a-pid\n");
    expect(ts.currentState({ appDataDir: dir })).toBe(ts.STATES.RUNNING);
  });

  it("is stopped when the server is down, whatever the MITM file says", () => {
    fs.writeFileSync(pidFile(), String(process.pid));
    expect(ts.currentState({ appDataDir: dir, serverUp: false })).toBe(ts.STATES.STOPPED);
  });

  it("treats EPERM as alive — the MITM runs under sudo", () => {
    // pid 1 exists and is not ours: process.kill(1, 0) throws EPERM. Reading
    // that as dead would make a healthy capture show as off on every machine.
    expect(ts.pidAlive(1)).toBe(true);
  });
});

describe("state icons", () => {
  const dirOf = (f) => path.join(process.cwd(), "cli/src/cli/tray", f);

  it("every state maps to a file that exists, with an @2x pair", () => {
    for (const state of Object.values(ts.STATES)) {
      const base = ts.iconNameForState(state);
      expect(fs.existsSync(dirOf(`${base}.png`)), `${base}.png`).toBe(true);
      // Without @2x these blur on every Retina Mac; icon.png shipped alone.
      expect(fs.existsSync(dirOf(`${base}@2x.png`)), `${base}@2x.png`).toBe(true);
    }
  });

  it("the tray marks icons as templates on macOS", async () => {
    const src = fs.readFileSync(dirOf("tray.js"), "utf8");
    expect(src, "template mode is what makes the icon follow the menu-bar theme")
      .toContain('isTemplateIcon: process.platform === "darwin"');
  });

  it("the state line is built from describeState, not a hardcoded string", async () => {
    const src = fs.readFileSync(dirOf("tray.js"), "utf8");
    expect(src).toContain("describeState(state)");
  });
});
