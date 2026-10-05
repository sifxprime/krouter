import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({})) }));

/**
 * The website's deploy guide told Docker users to pass -e JWT_SECRET="...", and the
 * npm path said export JWT_SECRET="generate-a-long-random-string". JWT_SECRET is
 * used verbatim to sign dashboard sessions, so anyone who pasted those had a key
 * the internet knows: a stranger could mint a valid session. Without JWT_SECRET,
 * kRouter generates a random 32-byte secret, so a weak value is now ignored.
 */
const forge = (secret) =>
  new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));

async function loadWith(jwtSecret) {
  const dir = mkdtempSync(join(tmpdir(), "krouter-jwt-"));
  process.env.DATA_DIR = dir;
  if (jwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = jwtSecret;
  vi.resetModules();
  const mod = await import("../../src/lib/auth/dashboardSession.js");
  return { mod, dir };
}

describe("JWT_SECRET guard", () => {
  const saved = { JWT_SECRET: process.env.JWT_SECRET, DATA_DIR: process.env.DATA_DIR };
  const dirs = [];
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  });

  for (const placeholder of [
    "...",
    "generate-a-long-random-string",
    "change-me-to-a-long-random-secret",
    // 32+ characters, so only the list catches them -- upstream 9router docs and
    // an old hard-coded fallback; case and padding must not slip past.
    "your-secure-secret-change-this-to-random-string",
    "9router-default-secret-change-me",
    "VOTRE-SECRET-SÉCURISÉ-CHANGEZ-LE",
    "  change-me-to-a-long-random-secret  ",
    "short-secret",
  ]) {
    it(`refuses sessions forged with the weak secret ${JSON.stringify(placeholder)}`, async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { mod, dir } = await loadWith(placeholder);
      dirs.push(dir);
      expect(await mod.verifyDashboardAuthToken(await forge(placeholder))).toBe(false);
      // It falls back to the generated secret, so real logins still work.
      expect(existsSync(join(dir, "jwt-secret"))).toBe(true);
      expect(await mod.verifyDashboardAuthToken(await mod.createDashboardAuthToken())).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Ignoring JWT_SECRET"));
      delete globalThis.__krouterJwtSecretWarned;
      warn.mockRestore();
    });
  }

  it("still honours a long random JWT_SECRET (shared across instances)", async () => {
    const strong = "k".repeat(16) + "9f2c1e7a4b8d3f60aa51c2e9d7b4f803";
    const { mod, dir } = await loadWith(strong);
    dirs.push(dir);
    expect(await mod.verifyDashboardAuthToken(await forge(strong))).toBe(true);
    expect(existsSync(join(dir, "jwt-secret"))).toBe(false);
  });

  it("generates and persists a random secret when JWT_SECRET is unset", async () => {
    const { mod, dir } = await loadWith(undefined);
    dirs.push(dir);
    const secret = readFileSync(join(dir, "jwt-secret"), "utf8");
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(await mod.verifyDashboardAuthToken(await forge(secret))).toBe(true);
  });
});
