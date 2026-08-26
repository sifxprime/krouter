import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CLI = "cli/cli.js";
const run = (args) => {
  try {
    return { out: execFileSync("node", [CLI, ...args], { encoding: "utf8", timeout: 30000 }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout || ""}${e.stderr || ""}`, code: e.status };
  }
};

/**
 * Three defects in one argument parser:
 *
 * 1. ensureSqliteRuntime/ensureTrayRuntime ran before parsing, so `--version` shelled
 *    out to a blocking `npm install` with a 180s spawnSync timeout. On a machine
 *    without the runtime, asking the program its version printed nothing for minutes.
 * 2. `port = parseInt(args[i+1], 10) || DEFAULT_PORT` accepted "3000abc" as 3000 and
 *    turned a typo, an empty value or a missing one into the default port -- which the
 *    startup path then force-freed.
 * 3. The if/else-if chain had no terminal else, so `--prot 3000`, `-P 3000` and
 *    `start` were dropped without a word and the server came up on the default port.
 */
describe("CLI argument handling", () => {
  it("answers --version without touching the network", () => {
    const t0 = Date.now();
    const { out, code } = run(["--version"]);
    expect(code).toBe(0);
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
    // A blocking npm install would be orders of magnitude slower than this.
    expect(Date.now() - t0).toBeLessThan(10000);
  });

  it("answers --help without touching the network", () => {
    const t0 = Date.now();
    expect(run(["--help"]).code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(10000);
  });

  it("rejects an unknown flag instead of ignoring it", () => {
    for (const bad of ["--prot", "-P", "start"]) {
      const { out, code } = run([bad, "--help"]);
      expect(code, `${bad} should be rejected`).toBe(2);
      expect(out).toContain("Unknown option");
    }
  });

  it("rejects a --port value that is not a usable port", () => {
    for (const bad of ["abc", "3000abc", "0", "99999", "-1"]) {
      const { out, code } = run(["--port", bad, "--help"]);
      expect(code, `--port ${bad} should be rejected`).toBe(2);
      expect(out).toContain("Invalid --port value");
    }
  });

  it("rejects --port with no value rather than falling back to the default", () => {
    const { out, code } = run(["--port"]);
    expect(code).toBe(2);
    expect(out).toContain("(missing)");
  });

  it("accepts the --flag=value form", () => {
    expect(run(["--port=3000", "--help"]).code).toBe(0);
    expect(run(["--host=127.0.0.1", "--help"]).code).toBe(0);
  });
});

describe("port reclamation", () => {
  const cli = readFileSync(CLI, "utf8");

  it("only kills a process it has identified as its own server", () => {
    // Previously: lsof -ti:PORT then kill -9 on everything returned, so
    // `krouter --port 5432` killed the user's Postgres before printing anything.
    expect(cli).toContain("isOwnServerPid");
    expect(cli).toMatch(/if \(isOwnServerPid\(pid\)\) pidsToKill\.add\(pid\);/);
  });

  it("identifies its own server by working directory, which survives orphaning", () => {
    // An orphaned server has no useful parent and renames itself to "next-server (vX)";
    // spawnServer pins cwd to standaloneDir and that marker outlives both.
    expect(cli).toMatch(/cwd: standaloneDir/);
    expect(cli).toMatch(/\/proc\/\$\{pid\}\/cwd|lsof -a -p \$\{pid\} -d cwd/);
  });

  it("names a foreign holder and exits rather than spinning on EADDRINUSE", () => {
    expect(cli).toContain("not kRouter");
    expect(cli).toContain("Refusing to kill it");
  });
});

describe("Ctrl-C in the interactive menu", () => {
  const input = readFileSync("cli/src/cli/utils/input.js", "utf8");

  it("re-raises SIGINT instead of exiting straight from the keypress handler", () => {
    // Raw mode clears termios ISIG, so Ctrl-C arrives as a keypress. Exiting here
    // skipped cli.js's SIGINT handler, orphaning the server child, the privileged
    // MITM process and any tunnel.
    expect(input).toContain('process.kill(process.pid, "SIGINT")');
    expect(input).not.toMatch(/key\.ctrl && key\.name === "c"\s*\)\s*\{\s*cleanup\(\);\s*process\.exit\(0\);/);
  });

  it("restores cooked mode before re-raising, so the signal is deliverable", () => {
    expect(input).toMatch(/setRawMode\(false\)[\s\S]{0,120}process\.kill\(process\.pid, "SIGINT"\)/);
  });
});
