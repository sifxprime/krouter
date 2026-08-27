import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * kRouter was written and tested on macOS, and several integrations assumed it.
 * Each case below was reachable by an ordinary Windows user.
 */

describe("Windows tray", () => {
  const raw = readFileSync("cli/src/cli/tray/tray.ps1", "utf8");
  // Assert on code, not on the comments that explain what was removed -- those
  // legitimately name the old API.
  const ps1 = raw
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

  it("does not poll stdin with Console.In.Peek from the UI thread", () => {
    // System.Windows.Forms.Timer fires its Tick on the thread Application::Run pumps.
    // Peek() does not return -1 on an open-but-idle pipe -- it blocks until the next
    // byte -- so the tick never returned, the pump stopped, and the tray icon appeared
    // but ignored every click: no menu, no Quit, only Task Manager.
    expect(ps1).not.toContain("[Console]::In.Peek()");
    expect(ps1).not.toContain("[Console]::In.ReadLine()");
  });

  it("reads stdin through a genuinely async reader", () => {
    // [Console]::In is a SyncTextReader whose ReadLineAsync() is also synchronous,
    // so the raw handle has to be opened directly.
    expect(ps1).toContain("OpenStandardInput()");
    expect(ps1).toContain("ReadLineAsync()");
    expect(ps1).toContain("IsCompleted");
  });

  it("exits on EOF instead of lingering as a dead icon", () => {
    expect(ps1).toMatch(/\$null -eq \$line[\s\S]{0,400}Application\]::Exit\(\)/);
  });
});

describe("Windows process and path handling", () => {
  it("spawns npm in a way Windows can execute", () => {
    // `where npm` lists the extensionless shell script first; spawning it without a
    // shell fails with ENOEXEC, so the PXPIPE install could never succeed.
    const src = readFileSync("src/lib/pxpipe/install.js", "utf8");
    expect(src).toMatch(/IS_WIN \? NPM_CMD : npm/);
    expect(src).toMatch(/shell: IS_WIN/);
  });

  it("resolves the VS Code settings path per OS for Kilo Code", () => {
    // Was hardcoded to ~/.config/Code/User/settings.json, so on Windows and macOS it
    // wrote somewhere VS Code never reads -- and still reported success.
    const src = readFileSync("src/app/api/cli-tools/kilo-settings/route.js", "utf8");
    expect(src).toMatch(/platform === "win32"[\s\S]{0,160}APPDATA/);
    expect(src).toMatch(/platform === "darwin"[\s\S]{0,160}Library/);
  });

  it("gives a DNS recovery command that works on the platform it is printed on", () => {
    // The only instruction offered to a stuck user was `sed -i ''` plus dscacheutil --
    // a BSD-ism GNU sed rejects, against a hosts path Windows does not have.
    const src = readFileSync("src/shared/services/initializeApp.js", "utf8");
    expect(src).toContain("ipconfig /flushdns");
    expect(src).toContain("dscacheutil -flushcache");
    expect(src).toMatch(/resolvectl flush-caches|systemd-resolve --flush-caches/);
    // and the host list is derived, not duplicated
    expect(src).toContain("TOOL_HOSTS[t]");
  });

  it("no longer shells out to a sqlite3 CLI that Windows does not ship", () => {
    const src = readFileSync("cli/cli.js", "utf8");
    expect(src).not.toMatch(/sqlite3\s+["'`]/);
    expect(src).not.toMatch(/execSync\([^)]*sqlite3/);
  });
});
