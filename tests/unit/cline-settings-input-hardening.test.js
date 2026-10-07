import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Review follow-ups on the 0.5.164 Cline writer:
 * - Apply accepted strings that are not web URLs ("localhost:20128" parses as
 *   scheme "localhost:", "javascript:alert(1)") and appended /v1 after a query.
 * - An unreadable providers.json (Cline itself treats one as empty) made Reset
 *   return 500 and leave kRouter configured in globalState.json and secrets.json.
 * - secrets.json holds the API key but was written with default permissions;
 *   Cline writes its own credential files owner-only.
 * These tests run Apply and Reset against a temp HOME.
 */
const { POST, DELETE } = await import("../../src/app/api/cli-tools/cline-settings/route.js");

let tmpHome;
let savedHome;
let savedUserProfile;
const dataDir = () => path.join(tmpHome, ".cline", "data");
const providersPath = () => path.join(dataDir(), "settings", "providers.json");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dataDir(), name), "utf-8"));
const apply = (body) =>
  POST(new Request("http://localhost/api/cli-tools/cline-settings", { method: "POST", body: JSON.stringify(body) }));
const reset = () => DELETE(new Request("http://localhost/api/cli-tools/cline-settings", { method: "DELETE" }));
const VALID = { apiKey: "test-key", model: "cc/claude-sonnet-5-5" };

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-cline-hardening-"));
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("Cline Apply only accepts http(s) base URLs", () => {
  it("runs against the temp HOME, not the real one", () => {
    expect(os.homedir()).toBe(tmpHome);
  });

  it.each(["localhost:20128", "javascript:alert(1)", "ftp://localhost:20128"])("rejects %s with 400 and writes nothing", async (baseUrl) => {
    const res = await apply({ ...VALID, baseUrl });
    expect(res.status).toBe(400);
    expect(fs.existsSync(path.join(dataDir(), "globalState.json"))).toBe(false);
  });

  it("adds /v1 to the path, not after a query string or fragment", async () => {
    const res = await apply({ ...VALID, baseUrl: "http://localhost:20128/?foo=1#x" });
    expect(res.status).toBe(200);
    expect(readJson("globalState.json").openAiBaseUrl).toBe("http://localhost:20128/v1");
  });

  it("keeps a sub-path and does not double /v1", async () => {
    await apply({ ...VALID, baseUrl: "https://router.example.com/krouter/v1/" });
    expect(readJson("globalState.json").openAiBaseUrl).toBe("https://router.example.com/krouter/v1");
  });
});

describe("an unreadable providers.json does not block Apply or Reset", () => {
  const writeCorruptProviders = () => {
    fs.mkdirSync(path.dirname(providersPath()), { recursive: true });
    fs.writeFileSync(providersPath(), "{ not json");
  };

  it("Reset still removes kRouter from globalState.json and secrets.json", async () => {
    await apply({ ...VALID, baseUrl: "http://localhost:20128/v1" });
    writeCorruptProviders();
    const res = await reset();
    expect(res.status).toBe(200);
    expect(readJson("globalState.json").openAiBaseUrl).toBeUndefined();
    expect(readJson("secrets.json").openAiApiKey).toBeUndefined();
  });

  it("Apply treats it as empty, the way Cline does, and writes a valid file", async () => {
    writeCorruptProviders();
    const res = await apply({ ...VALID, baseUrl: "http://localhost:20128/v1" });
    expect(res.status).toBe(200);
    const stored = JSON.parse(fs.readFileSync(providersPath(), "utf-8"));
    expect(stored.providers["openai-compatible"].settings.baseUrl).toBe("http://localhost:20128/v1");
  });
});

describe.skipIf(process.platform === "win32")("secrets.json is owner-only", () => {
  it("is created with mode 0600", async () => {
    await apply({ ...VALID, baseUrl: "http://localhost:20128/v1" });
    const mode = fs.statSync(path.join(dataDir(), "secrets.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
