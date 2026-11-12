// The sudo-spawned MITM server used to get its environment on the command
// line. Two things were wrong with that and both were invisible:
//
//   1. argv is world-readable. `ps` showed `ROUTER_API_KEY=sk-...` to every
//      local process.
//   2. The list was a fixed four variables, so MITM_FILE_LOG never reached the
//      child on macOS. File logging looked enabled and wrote nothing — the
//      worst way for an observability switch to fail, and the reason the :443
//      server had no log to read while debugging it.
//
// The environment now goes down stdin behind a sentinel. These pin the parts
// that are easy to break later: the secret staying out of argv, the forwarding
// list covering what the child actually reads, and the handshake surviving a
// sudo that does not prompt.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const mgr = require("../../src/mitm/manager.js");
const SRC = fs.readFileSync(path.join(process.cwd(), "src/mitm/manager.js"), "utf8");

describe("sudo env payload", () => {
  it("puts the password first, then the framed env block", () => {
    const out = mgr.buildSudoEnvStdin("pw", { ROUTER_API_KEY: "sk-abc", HOME: "/Users/x" });
    expect(out.split("\n")).toEqual([
      "pw",
      mgr.ENV_BEGIN,
      "ROUTER_API_KEY=sk-abc",
      "HOME=/Users/x",
      mgr.ENV_END,
      "",
    ]);
  });

  it("handles an empty password — sudo may be passwordless", () => {
    const out = mgr.buildSudoEnvStdin("", { A: "1" });
    expect(out.startsWith(`\n${mgr.ENV_BEGIN}\n`)).toBe(true);
    expect(mgr.buildSudoEnvStdin(null, { A: "1" }).startsWith("\n")).toBe(true);
  });

  it("refuses a newline in a value instead of truncating it", () => {
    // A line break would end the assignment early and the remainder would be
    // exported as its own variable — a quiet way to lose half a path.
    expect(() => mgr.buildSudoEnvStdin("pw", { MITM_FILE_LOG: "a\nb" }))
      .toThrow(/newline/i);
    expect(() => mgr.buildSudoEnvStdin("pw", { A: "a\rb" })).toThrow(/newline/i);
  });

  it("keeps spaces and quotes intact — no shell quoting is involved", () => {
    const out = mgr.buildSudoEnvStdin("pw", { MITM_FILE_LOG: "/p with space/a'b.log" });
    expect(out).toContain("MITM_FILE_LOG=/p with space/a'b.log");
  });
});

describe("sudo spawn shape", () => {
  it("passes no secret on the command line", () => {
    // The whole point. Anything interpolating apiKey into inlineCmd puts it in
    // argv, where ps shows it to every local user.
    const block = SRC.slice(SRC.indexOf("} else if (isSudoAvailable()) {"));
    const inline = block.slice(block.indexOf("const inlineCmd"), block.indexOf("serverProcess = spawn"));
    expect(inline).not.toMatch(/apiKey|sudoPassword|ROUTER_API_KEY=\$\{/);
  });

  it("forwards every env var the MITM child reads", () => {
    // A var missing from the list is not an error — it is a switch that does
    // nothing, which is exactly how MITM_FILE_LOG was lost.
    const always = new Set(["ROUTER_API_KEY", "MITM_ROUTER_BASE", "NODE_ENV", "HOME", "APPDATA"]);
    const read = new Set();
    for (const f of ["server.js", "logger.js", "paths.js", "config.js", "dispatch.js"]) {
      const p = path.join(process.cwd(), "src/mitm", f);
      if (!fs.existsSync(p)) continue;
      for (const m of fs.readFileSync(p, "utf8").matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
        read.add(m[1]);
      }
    }
    const forwarded = new Set(mgr.SUDO_FORWARDED_ENV);
    const missing = [...read].filter((k) => !always.has(k) && !forwarded.has(k));
    expect(missing, `src/mitm reads these but they are never forwarded: ${missing}`).toEqual([]);
  });
});

describe("the shell half of the handshake", () => {
  // buildSudoEnvStdin is only half the mechanism; the sh script in inlineCmd is
  // the other half and a unit test of the JS alone would pass with it broken.
  // Run the real script text against both sudo behaviours.
  const script = (() => {
    const block = SRC.slice(SRC.indexOf("} else if (isSudoAvailable()) {"));
    const begin = block.indexOf("const inlineCmd = [");
    const lines = block.slice(begin, block.indexOf("].join(\"; \")", begin));
    const reads = [...lines.matchAll(/`(while IFS= read[^`]*)`/g)].map((m) => m[1]);
    expect(reads.length, "expected both sentinel-skipping read loops").toBe(2);
    return reads
      .join("\n")
      .replace("${ENV_BEGIN}", mgr.ENV_BEGIN)
      .replace("${ENV_END}", mgr.ENV_END)
      + '\nexec /bin/sh -c \'printf "%s|%s|%s" "$HOME" "$ROUTER_API_KEY" "$MITM_FILE_LOG"\'';
  })();

  const run = (stdin) =>
    execFileSync("/bin/sh", ["-c", script], { input: stdin, encoding: "utf8" });

  const env = { HOME: "/Users/x", ROUTER_API_KEY: "sk-abc", MITM_FILE_LOG: "1" };

  it("exports the vars when sudo consumed the password line", () => {
    const payload = mgr.buildSudoEnvStdin("pw", env);
    // Drop the password line, as a prompting sudo would.
    expect(run(payload.slice(payload.indexOf("\n") + 1))).toBe("/Users/x|sk-abc|1");
  });

  it("exports the same vars when sudo did NOT prompt", () => {
    // Cached timestamp or NOPASSWD: the password line is still on stdin. A
    // script taking the first line blindly would export the password as the
    // API key and fail in a way that reads like a bad key.
    expect(run(mgr.buildSudoEnvStdin("my-sudo-password", env))).toBe("/Users/x|sk-abc|1");
  });
});
