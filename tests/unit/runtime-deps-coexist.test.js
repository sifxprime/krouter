import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// better-sqlite3 and systray2 are installed into ONE shared runtime directory whose
// package.json declares no dependencies. Installing with --no-save leaves whichever
// package was installed first "extraneous", and npm prunes extraneous packages. Every
// launch ran the sqlite heal and then the tray heal, so the tray install deleted
// better-sqlite3 each time and the next launch reinstalled it -- silently, forever.
// Reproduced on npm 11.17 with two zero-dependency packages: --no-save leaves only the
// last one installed; saving keeps both.
const code = (rel) =>
  readFileSync(path.resolve(rel), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

describe("runtime dependencies do not prune each other", () => {
  it("the sqlite installer does not pass --no-save", () => {
    expect(code("cli/hooks/sqliteRuntime.js")).not.toMatch(/["']--no-save["']/);
  });

  it("the tray installer does not pass --no-save", () => {
    expect(code("cli/hooks/trayRuntime.js")).not.toMatch(/["']--no-save["']/);
  });

  it("the manifest is not seeded with systray2, which must never reach Windows", () => {
    // Recording each package as it is installed keeps systray2 off Windows, where the
    // tray installer never runs. Seeding both up front would install it everywhere.
    for (const f of ["cli/hooks/sqliteRuntime.js", "cli/hooks/trayRuntime.js"]) {
      expect(code(f)).not.toMatch(/dependencies:\s*\{[^}]*systray2/);
    }
  });
});
