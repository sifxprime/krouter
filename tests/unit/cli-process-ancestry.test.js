import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * killAllAppProcesses matched processes by command line, and one clause was unqualified:
 *
 *   const isAppProcess =
 *     (cmd.includes("node") && hasAppName && hasAppPath)
 *     || cmd.includes("next-server");
 *
 * Next renames its server process to a bare "next-server (v16.3.1)" — no path, no
 * project, nothing identifying the app it belongs to. So that clause matched every Next
 * server on the machine, and starting or quitting kRouter SIGKILLed a developer's
 * unrelated dev server. The whitelist above it could not help, because kRouter's own
 * server matches by that string and nothing else.
 *
 * Ancestry is the only thing that separates them. Verified live with two processes whose
 * command lines were byte-identical: kRouter's own server was selected and the unrelated
 * one was spared.
 */
const cli = readFileSync("cli/cli.js", "utf8");

describe("CLI process selection", () => {
  it("never selects a process merely for being a Next server", () => {
    expect(cli).not.toMatch(/includes\(["']next-server["']\)/);
  });

  it("walks the process tree from the CLI invocation", () => {
    expect(cli).toContain("ParentProcessId");        // Windows, via WMI
    expect(cli).toContain("ps -Ao pid,ppid,command"); // POSIX
    expect(cli).toMatch(/byParent/);
  });

  it("treats only a real cli.js invocation as a tree root", () => {
    // A substring test would make any process that merely mentions the app a root —
    // a grep, an editor, a script given the path — and every descendant of a root dies.
    expect(cli).toContain("isCliInvocation");
    expect(cli).not.toMatch(/roots[\s\S]{0,200}r\.cmd\.includes\("krouter"\)\s*&&/);
  });

  it("still refuses to kill its own pid", () => {
    expect(cli).toMatch(/pid !== process\.pid\.toString\(\)/);
  });
});

describe("the root-matching rule itself", () => {
  // Mirrors the predicate in cli.js so the intent is pinned, not just its presence.
  const isCliInvocation = (cmd) =>
    /(^|[\s"'])[^\s"']*[\/\\]krouter[\/\\]cli\.js(\s|$|["'])/i.test(cmd) ||
    /(^|[\s"'])[^\s"']*[\/\\]\.bin[\/\\]krouter(\s|$|["'])/i.test(cmd);

  it("matches a real invocation", () => {
    expect(isCliInvocation("node node_modules/@sifxprime/krouter/cli.js -p 20179")).toBe(true);
    expect(isCliInvocation("node /usr/local/lib/node_modules/@sifxprime/krouter/cli.js")).toBe(true);
    expect(isCliInvocation("node /opt/app/node_modules/.bin/krouter")).toBe(true);
  });

  it("does not match a process that merely mentions the app", () => {
    expect(isCliInvocation("grep -r krouter cli.js")).toBe(false);
    expect(isCliInvocation("node build.js --out /home/me/krouter-notes/cli.js.bak")).toBe(false);
    expect(isCliInvocation("vim /home/me/krouter/README.md")).toBe(false);
  });

  it("does not match a bare Next server", () => {
    expect(isCliInvocation("next-server (v16.3.1)")).toBe(false);
  });
});
