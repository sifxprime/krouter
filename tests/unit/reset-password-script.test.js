import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const script = require("../../scripts/reset-password.js");

/**
 * Docker users had no way to reset a forgotten dashboard password: the lockout
 * hint pointed at the kRouter CLI, which is not in the image, and the reset route
 * is local-only AND needs the CLI token. scripts/reset-password.js derives that
 * token the way the server does; if the derivation, header or salt ever drift,
 * the documented `docker exec krouter node scripts/reset-password.js` would
 * silently start answering 403 -- these tests fail first.
 */
describe("scripts/reset-password.js", () => {
  let dir;
  const savedDataDir = process.env.DATA_DIR;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "krouter-reset-"));
    mkdirSync(join(dir, "auth"));
    writeFileSync(join(dir, "machine-id"), "test-machine-id\n");
    writeFileSync(join(dir, "auth", "cli-secret"), "a".repeat(64) + "\n");
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = savedDataDir;
  });

  it("derives the same CLI token as the server", async () => {
    process.env.DATA_DIR = dir;
    vi.resetModules();
    const { getConsistentMachineId } = await import("../../src/shared/utils/machineId.js");
    expect(script.cliToken(dir)).toBe(await getConsistentMachineId("9r-cli-auth"));
  });

  it("uses the header and salt the server checks", async () => {
    const machineId = readFileSync(new URL("../../src/shared/utils/machineId.js", import.meta.url), "utf8");
    const { CLI_TOKEN_HEADER } = await import("../../src/lib/auth/cliToken.js");
    expect(script.CLI_TOKEN_HEADER).toBe(CLI_TOKEN_HEADER);
    expect(machineId).toContain(`const CLI_AUTH_SALT = '${script.CLI_AUTH_SALT}'`);
  });

  it("treats exactly the placeholder passwords the login route does", async () => {
    const { PLACEHOLDER_INITIAL_PASSWORDS } = await import("../../src/lib/auth/initialPassword.js");
    expect([...script.PLACEHOLDER_INITIAL_PASSWORDS]).toEqual([...PLACEHOLDER_INITIAL_PASSWORDS]);
  });

  it("sends the token only where the server listens", () => {
    // On a host, a PORT in the caller's shell belongs to whatever else they run.
    expect(script.target([], { PORT: "3000" }, false)).toBe("http://127.0.0.1:20128/api/auth/reset-password");
    expect(script.target(["--port", "3000"], {}, false)).toBe("http://127.0.0.1:3000/api/auth/reset-password");
    // Inside the container docker exec inherits the server's own environment.
    expect(script.target([], { PORT: "8080", HOSTNAME: "0.0.0.0" }, true)).toBe("http://127.0.0.1:8080/api/auth/reset-password");
    expect(script.target(["--host", "::1"], {}, false)).toBe("http://[::1]:20128/api/auth/reset-password");
  });

  it("gives Docker users with no usable INITIAL_PASSWORD a way back in", () => {
    expect(script.nextSteps({ INITIAL_PASSWORD: "Zq3v9MSpYw4u1bNc8tHd2kLe" }, true)).toMatch(/Log in with the INITIAL_PASSWORD/);
    for (const env of [{}, { INITIAL_PASSWORD: "your-password" }]) {
      expect(script.nextSteps(env, true)).toMatch(/Recreate the container/);
      expect(script.nextSteps(env, false)).toMatch(/123456 from this machine/);
    }
  });

  it("finds the data directory the same way the server does", () => {
    expect(script.dataDir({ DATA_DIR: "/app/data" })).toBe("/app/data");
    expect(script.dataDir({})).toMatch(/krouter$/);
  });

  it("ships in the Docker image and is what the docs and lockout hint point to", () => {
    const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
    const docker = readFileSync(new URL("../../DOCKER.md", import.meta.url), "utf8");
    const login = readFileSync(new URL("../../src/app/api/auth/login/route.js", import.meta.url), "utf8");
    expect(dockerfile).toMatch(/COPY --from=builder \/app\/scripts\/reset-password\.js \.\/scripts\/reset-password\.js/);
    expect(docker).toContain("docker exec krouter node scripts/reset-password.js");
    expect(login).toContain("node scripts/reset-password.js");
  });
});
