/**
 * The saved sudo password must decrypt under a LaunchAgent's PATH.
 *
 * MITM never came back after a reboot. The setting said enabled, the encrypted
 * password was on disk and decrypted fine by hand, and the server still logged
 * "MITM was enabled but no saved password found, skipping auto-start" on every
 * boot. The watchdog then stripped the DNS redirects it could no longer serve,
 * so capture was simply off until someone opened the dashboard.
 *
 * The cause was PATH. `node-machine-id` shells out to `ioreg`, which lives in
 * /usr/sbin, and the LaunchAgent's PATH was
 * `<node>/bin:/usr/local/bin:/usr/bin:/bin` — no /usr/sbin. machineIdSync()
 * threw, deriveKey() silently fell back to hashing the salt alone, and that is
 * a different key from the one the password was encrypted under. GCM rejected
 * the auth tag and the failure surfaced as "no password saved".
 *
 * Measured on the real machine:
 *   $ env -i PATH=<the plist's PATH> node -e 'machineIdSync()'
 *   /bin/sh: ioreg: command not found
 *
 * Two things are pinned here: the key no longer comes from a PATH lookup, and a
 * password written under any of the historical keys still opens.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SALT = "9router-mitm-pwd";
const ALGO = "aes-256-gcm";
const LAUNCHD_PATH = "/usr/local/bin:/usr/bin:/bin"; // deliberately no /usr/sbin

let tempDir;
let mgr;
const originalDataDir = process.env.DATA_DIR;

/** Encrypt the way a given key would have, so we can plant historical blobs. */
function encryptWith(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

const keyFrom = (raw) => crypto.createHash("sha256").update(raw + SALT).digest();

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-sudo-key-"));
  process.env.DATA_DIR = tempDir;
  // The persisted machine id is what the key must now come from; machineId.js
  // writes this file on first run for exactly this reason.
  fs.writeFileSync(path.join(tempDir, "machine-id"), "a".repeat(64), { mode: 0o600 });
  mgr = await import("@/mitm/manager");
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("sudo password key derivation", () => {
  it("round-trips a password without consulting PATH", () => {
    const blob = mgr.__test__.encryptPassword("hunter2");
    expect(mgr.__test__.decryptPassword(blob)).toBe("hunter2");
  });

  it("derives the key from the persisted machine id, not from ioreg", () => {
    // If the key still came from machineIdSync(), this blob would be unopenable
    // on any machine where ioreg is missing — which is every LaunchAgent.
    const blob = mgr.__test__.encryptPassword("from-persisted");
    const expected = keyFrom("a".repeat(64));
    const [ivHex, tagHex, dataHex] = blob.split(":");
    const d = crypto.createDecipheriv(ALGO, expected, Buffer.from(ivHex, "hex"));
    d.setAuthTag(Buffer.from(tagHex, "hex"));
    expect(d.update(Buffer.from(dataHex, "hex")) + d.final("utf8")).toBe("from-persisted");
  });

  it("still opens a password saved under either historical key", () => {
    // Upgrades must not silently lose the stored password: that reads as "never
    // saved" and skips auto-start, which is the bug this file exists for.
    const legacySaltOnly = crypto.createHash("sha256").update(SALT).digest();
    expect(mgr.__test__.decryptPassword(encryptWith(legacySaltOnly, "old-salt-only"))).toBe("old-salt-only");

    // The machineIdSync()-derived key, as saved by a run that had /usr/sbin.
    let liveId = null;
    try {
      liveId = execFileSync("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" });
    } catch { /* not macOS, or no ioreg — the salt-only case above still covers it */ }
    if (liveId) {
      const { machineIdSync } = require("node-machine-id");
      expect(mgr.__test__.decryptPassword(encryptWith(keyFrom(machineIdSync()), "old-machine-id"))).toBe("old-machine-id");
    }
  });

  it("returns null for a malformed blob instead of throwing", () => {
    for (const bad of [null, undefined, "", "nope", "a:b", "a:b:c"]) {
      expect(mgr.__test__.decryptPassword(bad)).toBeNull();
    }
  });
});

describe("the LaunchAgent PATH", () => {
  it("includes the sbin directories", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "cli/src/cli/tray/autostart.js"), "utf8");
    const line = src.split("\n").find((l) => l.includes("const launchPath ="));
    expect(line, "launchPath must still exist").toBeTruthy();
    expect(line, "/usr/sbin holds ioreg, and a LaunchAgent only gets the PATH written here").toContain("/usr/sbin");
    expect(line).toContain("/sbin");
  });

  it("proves ioreg is unreachable on the old PATH", () => {
    // Not a test of our code — a guard on the assumption the fix rests on. If
    // ioreg ever turns up on this PATH, the comment above is wrong.
    expect(() => execFileSync("sh", ["-c", "command -v ioreg"], {
      env: { PATH: LAUNCHD_PATH },
      stdio: "ignore",
    })).toThrow();
  });

  it("derives the same key with and without /usr/sbin on PATH", () => {
    // The regression itself, run the way launchd runs it. Two child processes
    // load the real module, one with a login shell's PATH and one with the
    // LaunchAgent's; a password encrypted in either must open in the other.
    // Before the fix these were different keys and neither could read the
    // other's blob, which is precisely how the stored password became
    // unreadable after a reboot.
    const script = `
      process.env.DATA_DIR = ${JSON.stringify(tempDir)};
      const mgr = require(${JSON.stringify(path.join(process.cwd(), "src/mitm/manager.js"))});
      const blob = mgr.__test__.encryptPassword("cross-path");
      process.stdout.write(JSON.stringify({
        blob,
        key: mgr.__test__.deriveKeyCandidates()[0].toString("hex"),
      }));
    `;
    const run = (p) => JSON.parse(execFileSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      env: { PATH: p, HOME: os.homedir() },
    }));

    const full = run(`/usr/sbin:/sbin:${LAUNCHD_PATH}`);
    const launchd = run(LAUNCHD_PATH);

    expect(launchd.key, "the key must not change with PATH").toBe(full.key);
    expect(mgr.__test__.decryptPassword(full.blob)).toBe("cross-path");
    expect(mgr.__test__.decryptPassword(launchd.blob)).toBe("cross-path");
  });
});

describe("the start lock", () => {
  it("is reclaimed when the process that took it is gone", () => {
    // Second half of the same boot failure. The lock is written with O_EXCL and
    // removed on every clean path — but not by a SIGKILL, and `launchctl
    // kickstart -k` is a SIGKILL. The leftover file then made every later start
    // throw "already starting" permanently, so even with the password readable
    // MITM still could not auto-start:
    //   [InitApp] MITM was enabled, auto-starting...
    //   [InitApp] MITM auto-start failed: MITM server is already starting (lock contention)
    // with the lock naming a pid that had been dead for minutes.
    const src = fs.readFileSync(path.join(process.cwd(), "src/mitm/manager.js"), "utf8");
    const block = src.slice(src.indexOf("Atomically claim lock"), src.indexOf("await killLeftoverMitm"));

    expect(block, "EEXIST alone must not mean a start is in progress").toContain("isProcessAlive(holder)");
    expect(block, "a reclaimed pid number needs an age backstop").toContain("STALE_LOCK_MS");
    expect(block, "the stale lock has to be taken over, not just diagnosed").toMatch(/writeFileSync\(LOCK_FILE, String\(process\.pid\)\);/);

    // And the throw must now be conditional rather than unconditional on EEXIST.
    const eexistThrow = /if \(e\.code === "EEXIST"\) \{\s*throw new Error\("MITM server is already starting/;
    expect(block, "the unconditional EEXIST throw is the bug").not.toMatch(eexistThrow);
  });

  it("derives the key once per process, not once per decrypt", () => {
    // node-machine-id shells out; calling it per decrypt attempt printed
    // "ioreg: command not found" to stderr on every attempt under launchd.
    const first = mgr.__test__.deriveKeyCandidates();
    expect(mgr.__test__.deriveKeyCandidates(), "candidates must be memoized").toBe(first);
  });
});
