/**
 * better-sqlite3 12.6.2 has no N-API build: on Node 22+ npm runs node-gyp against
 * it, so a user without build tools (the common case on Windows and on a clean
 * macOS without Xcode CLT) fails the native install and silently drops to the
 * slower sql.js fallback. 13.x is N-API, ships per-platform prebuilds inside the
 * package, and needs neither a download nor a compiler — but npm still injects an
 * implicit `node-gyp rebuild` for anything carrying a binding.gyp, so scripts have
 * to be skipped for the bundled binary to be used as-is.
 *
 * Ported from upstream 90a00058.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = () => fs.readFileSync(
  path.join(process.cwd(), "cli/hooks/sqliteRuntime.js"), "utf-8");
const noComments = (s) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("sqlite runtime picks a build the host can actually use", () => {
  it("gates the pinned version on the Node major", () => {
    const s = noComments(src());
    expect(s).toContain("NODE_MAJOR >= 22");
    expect(s).toContain('USE_NAPI_BUILD ? "13.0.3" : "12.6.2"');
  });

  it("skips install scripts only for the N-API build", () => {
    const s = noComments(src());
    // Passing --ignore-scripts on 12.x would leave it with no binary at all.
    expect(s).toContain("ignoreScripts: USE_NAPI_BUILD");
    expect(s).toContain('extra.push("--ignore-scripts")');
  });

  it("looks for the binary in both layouts", () => {
    const s = noComments(src());
    // 12.x: build/Release. 13.x: prebuilds/<platform>-<arch>.node.
    expect(s).toContain('path.join(root, "build", "Release", "better_sqlite3.node")');
    expect(s).toContain("prebuilds");
    expect(s).toContain("${platform}-${process.arch}.node");
  });

  it("distinguishes musl from glibc when naming the prebuild", () => {
    const s = noComments(src());
    // An Alpine container needs linuxmusl-x64, not linux-x64.
    expect(s).toContain("linuxmusl");
    expect(s).toContain("glibcVersionRuntime");
  });

  it("the version gate resolves correctly per Node major", () => {
    const pick = (major) => (major >= 22 ? "13.0.3" : "12.6.2");
    expect(pick(20)).toBe("12.6.2");
    expect(pick(22)).toBe("13.0.3");
    expect(pick(26)).toBe("13.0.3");
  });

  it("still loads as CommonJS from the CLI", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const mod = require(path.join(process.cwd(), "cli/hooks/sqliteRuntime.js"));
    expect(mod).toBeTruthy();
  });
});
