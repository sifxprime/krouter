import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { blankLiterals } from "../helpers/enclosing-guard.js";
import { trackedSourceFiles } from "../helpers/tracked-sources.js";
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

// ---------------------------------------------------------------------------
// One name for the setting.
//
// The tray carried a fourth copy of this logic and it read a DIFFERENT variable:
//
//   const DEFAULT_DATA_DIR = process.env.KROUTER_DATA_DIR || path.join(os.homedir(), ".krouter");
//
// KROUTER_DATA_DIR appears in no README, no .env.example, and not in the
// dashboard's own env catalog (src/shared/constants/envVars.js). Nothing else in
// kRouter reads it. So it was wrong in both directions at once: DATA_DIR, the
// documented setting every other reader honours, left this line on ~/.krouter;
// and setting KROUTER_DATA_DIR moved this line alone.
//
// It was also the only resolver with no Windows branch, so even unset it named
// ~/.krouter where the app uses %APPDATA%\krouter. Every one of those failures
// ends the same way: the pid file is sought in a directory that is not there,
// existsSync returns false, and the menu bar says "capture off" during a live
// capture -- the one lie the icon was added to prevent.
// ---------------------------------------------------------------------------
const TRAY_STATE = path.resolve("cli/src/cli/tray/trayState.js");

/** The tray's fallback data dir, resolved in a clean child process. */
function trayDefaultWith(overrides = {}) {
  const env = { ...process.env };
  delete env.DATA_DIR;
  delete env.KROUTER_DATA_DIR;
  Object.assign(env, overrides);
  return execFileSync(
    process.execPath,
    ["-e", `process.stdout.write(require(${JSON.stringify(TRAY_STATE)}).DEFAULT_DATA_DIR)`],
    { encoding: "utf8", env, timeout: 30000 },
  ).trim();
}

describe("the data directory has one setting name", () => {
  it("the tray reads DATA_DIR, like everything else", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "krouter-tray-datadir-"));
    try {
      // Before: ~/.krouter, while the app, the CLI and the MITM all used tmp.
      expect(trayDefaultWith({ DATA_DIR: tmp })).toBe(tmp);
      expect(trayDefaultWith({ DATA_DIR: tmp })).toBe(resolveWith(tmp));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("KROUTER_DATA_DIR does not move it", () => {
    // Not an alias, not a fallback: a name that was never anything. Honouring it
    // would make the tray disagree with the app whenever both were set, which is
    // the bug, not the fix.
    const unset = trayDefaultWith();
    expect(trayDefaultWith({ KROUTER_DATA_DIR: path.join(os.tmpdir(), "krouter-ghost") })).toBe(unset);
  });

  it("the tray agrees with the app when neither is set", () => {
    expect(trayDefaultWith()).toBe(resolveWith(undefined));
  });

  it("no source file reads KROUTER_DATA_DIR", () => {
    // The structural half. The behavioural tests above only cover the tray; this
    // one fails wherever the name comes back, including the MITM's sudo
    // forwarding list, which carried it for two releases while nothing read it.
    //
    // Two forms, because there were two: a direct process.env read, and a quoted
    // name in a list something iterates. A bare mention is left alone on purpose
    // -- trayState.js and this file both have to be able to explain the bug.
    const READS = [/process\.env\.KROUTER_DATA_DIR/, /["'`]KROUTER_DATA_DIR["'`]/];
    const guilty = trackedSourceFiles(["src", "cli", "scripts"]).filter((f) => {
      const src = readFileSync(f, "utf8");
      return READS.some((re) => re.test(src));
    });
    expect(
      guilty.map((f) => path.relative(process.cwd(), f)),
      "KROUTER_DATA_DIR is not a kRouter setting -- DATA_DIR is",
    ).toEqual([]);
  });

  it("trayState delegates to the shared resolver instead of carrying its own copy", () => {
    const src = readFileSync(TRAY_STATE, "utf8");
    expect(src).toMatch(/require\(["']\.\.\/\.\.\/lib\/dataDir["']\)/);
    expect(src, "a hand-rolled homedir join is how this drifted").not.toMatch(
      /DEFAULT_DATA_DIR = [^\n]*os\.homedir\(\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// The other half of the same split: one variable, two answers.
//
// src/mitm/paths.js honoured DATA_DIR but skipped the Unix-path-on-Windows guard
// that src/lib/dataDir.js has. On Windows with a Linux-targeted DATA_DIR the app
// used %APPDATA%\krouter and the MITM resolved the Unix path against the current
// drive root, so the certificate and the database landed in different places.
//
// The expensive part was the gate: with the app sitting on the DEFAULT data dir,
// IS_DEFAULT_DATA_DIR was false, machine-wide trust was skipped, and the start
// log explained that "DATA_DIR is not the default install" about an install that
// was. MITM then could not work and the reason was a lie.
// ---------------------------------------------------------------------------
describe("the MITM resolves DATA_DIR the way the app does", () => {
  const APP_RESOLVER = path.resolve("src/lib/dataDir.js");
  const MITM_PATHS = path.resolve("src/mitm/paths.js");

  /**
   * Resolve both, with process.platform faked to win32 before either module is
   * evaluated -- both compute their DATA_DIR at module scope.
   */
  function resolveBothAsWindows(dataDir, appData) {
    const script = `
      Object.defineProperty(process, "platform", { value: "win32" });
      (async () => {
        const app = (await import(${JSON.stringify("file://" + APP_RESOLVER)})).getDataDir();
        const mitm = require(${JSON.stringify(MITM_PATHS)});
        process.stdout.write(JSON.stringify({ app, mitm: mitm.DATA_DIR, isDefault: mitm.IS_DEFAULT_DATA_DIR }));
      })();
    `;
    const env = { ...process.env, DATA_DIR: dataDir, APPDATA: appData };
    delete env.KROUTER_ALLOW_MACHINE_TRUST;
    return JSON.parse(execFileSync(process.execPath, ["-e", script], { encoding: "utf8", env, timeout: 30000 }));
  }

  // Skipped on real Windows, where os.tmpdir() is not a Unix path and so cannot
  // stand in for the leaked Linux setting this is about.
  it.skipIf(process.platform === "win32")(
    "a Unix DATA_DIR on Windows falls back to the default in BOTH, and the install stays default",
    () => {
      // Deliberately a writable directory. Pointing at /var/lib/krouter would
      // pass without the guard too -- the mkdir fails with EACCES and the
      // writability fallback returns appDir() anyway, so the guard would look
      // present when it was not.
      const configured = mkdtempSync(path.join(os.tmpdir(), "krouter-win-datadir-"));
      const appData = mkdtempSync(path.join(os.tmpdir(), "krouter-win-appdata-"));
      try {
        const r = resolveBothAsWindows(configured, appData);
        // path.join follows the REAL platform, so the separators here stay posix
        // on a Mac. That is fine: what is under test is which branch ran, not
        // how Windows spells a path.
        const expected = path.join(appData, "krouter");
        expect(r.app, "the app ignores a Unix path on Windows").toBe(expected);
        expect(r.mitm, "so the MITM must ignore it too").toBe(expected);
        expect(r.isDefault, "%APPDATA%\\krouter IS the default install").toBe(true);
      } finally {
        for (const d of [configured, appData]) rmSync(d, { recursive: true, force: true });
      }
    },
  );

  it("both carry the guard, so neither can quietly lose it", () => {
    for (const f of [APP_RESOLVER, MITM_PATHS]) {
      expect(readFileSync(f, "utf8"), `${path.basename(f)} lost the Windows guard`).toMatch(
        /process\.platform === "win32" && \/\^\\\/\/\.test\(configured\)/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Four places, and only four.
//
// There were eight. Two canonical resolvers and six private copies, each with a
// "kept in sync with..." comment and none of them actually in sync:
//
//   cli/hooks/sqliteRuntime.js   honoured a Unix DATA_DIR on Windows, AND fell
//                                back to os.homedir() rather than
//                                os.homedir()/AppData/Roaming
//   src/lib/mitmAliasCache.js    no Windows guard
//   src/lib/appUpdater.js        no Windows guard
//   src/lib/updater/updater.js   no Windows guard
//   src/mitm/paths.js            no Windows guard (fixed separately above)
//   scripts/reset-password.js    correct
//
// Three of them can import a canonical resolver and now do. Three cannot, for
// reasons that are properties of the runtime rather than taste, so they keep a
// copy -- and these assertions are what keeps those copies honest.
// ---------------------------------------------------------------------------
const CANONICAL = new Map([
  ["src/lib/dataDir.js", "the app's definition (ESM)"],
  ["cli/src/lib/dataDir.js", "the published CLI's definition (CJS); it cannot import the app's, which is ESM and sits outside this package's files"],
]);

const HAND_WRITTEN = [
  {
    file: "src/mitm/paths.js",
    // APP_NAME is a module-level const appDir closes over: lifting the two
    // functions alone left it undefined, which is how this caught itself.
    lift: ["APP_NAME", "appDir", "getDataDir"],
    call: "getDataDir()",
    why: "CJS, and the app's resolver is ESM -- require() cannot load it",
  },
  {
    file: "src/lib/updater/updater.js",
    lift: ["getDataDir"],
    call: "getDataDir()",
    why: "copied into DATA_DIR and executed from there; no package is left to import from",
  },
  {
    file: "scripts/reset-password.js",
    lift: ["dataDir"],
    call: "dataDir()",
    why: "a standalone CJS script, and it must NOT create the directory it is hunting for",
  },
];

/**
 * The text of one top-level declaration: `function <name>(...) {...}`,
 * brace-matched over blanked source, or `const <name> = ...;` on one line.
 */
function declarationSource(src, name) {
  const fnAt = src.indexOf(`function ${name}(`);
  if (fnAt >= 0) {
    const blank = blankLiterals(src);
    let depth = 0;
    for (let i = blank.indexOf("{", fnAt); i < blank.length; i++) {
      if (blank[i] === "{") depth++;
      else if (blank[i] === "}" && --depth === 0) return src.slice(fnAt, i + 1);
    }
    return null;
  }
  const m = new RegExp(`^const ${name} = .*;$`, "m").exec(src);
  return m ? m[0] : null;
}

/**
 * Run one hand-written resolver, and the canonical one, in the same child.
 *
 * The copies live in modules with side effects on load -- an HTTP server, a
 * whole CLI -- so the function text is lifted out and evaluated on its own
 * rather than imported. `fakeWindows` sets process.platform before anything
 * reads it, which is the only branch that cannot be reached natively here.
 */
function compareResolvers(copy, { fakeWindows = false, env: overrides = {} } = {}) {
  const src = readFileSync(path.resolve(copy.file), "utf8");
  const lifted = copy.lift.map((name) => {
    const text = declarationSource(src, name);
    expect(text, `${copy.file} no longer declares ${name} -- renamed?`).toBeTruthy();
    return text;
  });

  const script = `
    ${fakeWindows ? 'Object.defineProperty(process, "platform", { value: "win32" });' : ""}
    const path = require("path"), fs = require("fs"), os = require("os");
    ${lifted.join("\n")}
    const canonical = require(${JSON.stringify(path.resolve("cli/src/lib/dataDir.js"))}).getDataDir();
    process.stdout.write(JSON.stringify({ copy: ${copy.call}, canonical }));
  `;
  const env = { ...process.env };
  delete env.DATA_DIR;
  Object.assign(env, overrides);
  return JSON.parse(execFileSync(process.execPath, ["-e", script], { encoding: "utf8", env, timeout: 30000 }));
}

describe("the data dir is resolved in four places, and they agree", () => {
  it("nothing else re-derives it", () => {
    // Any new private copy fails here. The two forms are the two that existed:
    // process.env.DATA_DIR, and env.DATA_DIR where env is a parameter.
    const allowed = new Set([...CANONICAL.keys(), ...HAND_WRITTEN.map((c) => c.file)]);
    const extra = trackedSourceFiles(["src", "cli", "scripts"])
      .map((f) => path.relative(process.cwd(), f))
      .filter((rel) => !allowed.has(rel))
      .filter((rel) => /(?:process\.)?\benv\.DATA_DIR\b/.test(readFileSync(path.resolve(rel), "utf8")));
    expect(
      extra,
      "these re-derive DATA_DIR instead of importing a resolver -- every copy so far has drifted",
    ).toEqual([]);
  });

  it.each(HAND_WRITTEN.map((c) => [c.file, c]))(
    "%s agrees with the canonical resolver",
    (_label, copy) => {
      // Nothing set: the platform default.
      const plain = compareResolvers(copy);
      expect(plain.copy, copy.why).toBe(plain.canonical);

      // Set and usable: both honour it. The directory does not exist yet, so
      // this also shows the copies agree on the PATH even where only the
      // canonical one creates it.
      const base = mkdtempSync(path.join(os.tmpdir(), "krouter-agree-"));
      const nested = path.join(base, "deep");
      try {
        const set = compareResolvers(copy, { env: { DATA_DIR: nested } });
        expect(set.copy).toBe(set.canonical);
        expect(set.copy).toBe(nested);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

  // The branch that cannot happen on this machine and broke every copy.
  it.skipIf(process.platform === "win32").each(HAND_WRITTEN.map((c) => [c.file, c]))(
    "%s ignores a Unix DATA_DIR when the platform is Windows",
    (_label, copy) => {
      const appData = mkdtempSync(path.join(os.tmpdir(), "krouter-agree-appdata-"));
      const configured = mkdtempSync(path.join(os.tmpdir(), "krouter-agree-unix-"));
      try {
        // Writable on purpose: an unwritable path would reach the same answer
        // through the EACCES fallback, so a missing guard would look present.
        const r = compareResolvers(copy, { fakeWindows: true, env: { DATA_DIR: configured, APPDATA: appData } });
        expect(r.copy, "a Linux-targeted DATA_DIR must not be honoured on Windows").toBe(r.canonical);
        expect(r.copy).toBe(path.join(appData, "krouter"));
      } finally {
        for (const d of [appData, configured]) rmSync(d, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["cli/hooks/sqliteRuntime.js", /require\(["']\.\.\/src\/lib\/dataDir["']\)/],
    ["src/lib/mitmAliasCache.js", /from ["']@\/lib\/dataDir\.js["']/],
    ["src/lib/appUpdater.js", /from ["']@\/lib\/dataDir\.js["']/],
  ])("%s delegates rather than keeping a copy", (file, expected) => {
    expect(readFileSync(path.resolve(file), "utf8")).toMatch(expected);
  });
});
