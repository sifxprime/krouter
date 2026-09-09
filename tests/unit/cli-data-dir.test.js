import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// cli.js used to resolve ~/.krouter unconditionally, ignoring DATA_DIR, while
// cli/src/cli/api/client.js honoured it. Same process, same setting, two answers:
// auth and machine-id landed under DATA_DIR while db.json, the tunnel directory
// and the mitm pidfile landed in the home directory.
//
// The consequence that made it worth fixing was silent. cli.js clears
// settings.mitmEnabled in db.json to break a server crash loop; looking in the
// wrong directory made existsSync false, the surrounding best-effort catch
// swallowed it, and the server kept crash-looping with the safety valve doing
// nothing at all.

const RESOLVER = path.resolve("cli/src/lib/dataDir.js");
const CLI_SRC = path.resolve("cli/cli.js");
const CLIENT_SRC = path.resolve("cli/src/cli/api/client.js");

/** Resolve the data dir in a clean child process, so env changes cannot leak between cases. */
function resolveWith(dataDir) {
  const env = { ...process.env };
  delete env.DATA_DIR;
  if (dataDir !== undefined) env.DATA_DIR = dataDir;
  return execFileSync(
    "node",
    ["-e", `process.stdout.write(require(${JSON.stringify(RESOLVER)}).getDataDir())`],
    { encoding: "utf8", env, timeout: 30000 }
  ).trim();
}

describe("CLI data directory resolution", () => {
  it("falls back to the platform default when DATA_DIR is unset", () => {
    const expected =
      process.platform === "win32"
        ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "krouter")
        : path.join(os.homedir(), ".krouter");
    expect(resolveWith(undefined)).toBe(expected);
  });

  it("honours DATA_DIR when it is set", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "krouter-datadir-"));
    try {
      expect(resolveWith(tmp)).toBe(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("creates the configured directory rather than returning a path that does not exist", () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "krouter-datadir-"));
    const nested = path.join(base, "deep", "nested");
    try {
      expect(existsSync(nested)).toBe(false);
      expect(resolveWith(nested)).toBe(nested);
      expect(existsSync(nested)).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("does not create anything when DATA_DIR is unset", () => {
    // The mkdir is only correct for an explicitly configured directory; the
    // default path must stay a pure lookup.
    const probe = path.join(os.tmpdir(), "krouter-should-never-exist-probe");
    rmSync(probe, { recursive: true, force: true });
    resolveWith(undefined);
    expect(existsSync(probe)).toBe(false);
  });

  // The bug was a drifted copy, so guard the shape as well as the behaviour.
  it("cli.js delegates to the shared resolver instead of carrying its own copy", () => {
    const src = readFileSync(CLI_SRC, "utf8");
    expect(src).toMatch(/require\(["']\.\/src\/lib\/dataDir["']\)/);
    expect(src).not.toMatch(/path\.join\(os\.homedir\(\),\s*`\.\$\{DATA_DIR_NAME\}`\)/);
  });

  it("client.js delegates to the same resolver", () => {
    const src = readFileSync(CLIENT_SRC, "utf8");
    expect(src).toMatch(/require\(["']\.\.\/\.\.\/lib\/dataDir["']\)/);
    expect(src).not.toMatch(/if \(process\.env\.DATA_DIR\) return process\.env\.DATA_DIR;/);
  });

  it("the shared resolver ships in the published package", () => {
    const files = JSON.parse(readFileSync(path.resolve("cli/package.json"), "utf8")).files;
    // npm includes the whole directory, so "src" covers src/lib/dataDir.js.
    expect(files).toContain("src");
  });
});
