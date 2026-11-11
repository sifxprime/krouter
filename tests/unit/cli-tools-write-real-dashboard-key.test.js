import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The OpenCode, Copilot and DeepSeek TUI cards send the literal "sk_krouter"
 * (or nothing) when no key is picked in the dropdown, and their routes fell
 * back to "sk_krouter" too. That placeholder is not a dashboard key, so every
 * request from the configured tool got 401 "Invalid API key" whenever
 * requireApiKey is on -- every Docker install, per the 0.5.164 docs. The routes
 * now write the key the user picked, else the first active dashboard key, else
 * an empty string; the placeholder is never written (upstream 06eda8b0).
 */
const mocks = vi.hoisted(() => ({ getApiKeys: vi.fn(async () => []) }));
vi.mock("@/lib/localDb", () => ({ getApiKeys: mocks.getApiKeys }));

const opencode = await import("../../src/app/api/cli-tools/opencode-settings/route.js");
const deepseek = await import("../../src/app/api/cli-tools/deepseek-tui-settings/route.js");
const resolveCliApiKey = async (key) => (await import("../../src/app/api/cli-tools/resolveApiKey.js")).resolveCliApiKey(key);

const BASE = "http://localhost:20128/v1";
const KEYS = [
  { id: "a", key: "sk-revoked-0000", isActive: false },
  { id: "b", key: "sk-dashboard-1111", isActive: true },
  { id: "c", key: "sk-dashboard-2222", isActive: true },
];

const post = (route, url, body) =>
  route.POST(new Request(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body) }));

// Each tool's Apply, returning the key that landed in its config file.
const TOOLS = {
  opencode: async (apiKey) => {
    const res = await post(opencode, "/api/cli-tools/opencode-settings", { baseUrl: BASE, apiKey, models: ["cc/claude-sonnet-4-6"] });
    expect(res.status).toBe(200);
    const { configPath } = await res.json();
    return JSON.parse(fs.readFileSync(configPath, "utf-8")).provider.krouter.options.apiKey;
  },
  "deepseek-tui": async (apiKey) => {
    const res = await post(deepseek, "/api/cli-tools/deepseek-tui-settings", { baseUrl: BASE, apiKey, model: "cc/claude-sonnet-4-6" });
    expect(res.status).toBe(200);
    const { configPath } = await res.json();
    return fs.readFileSync(configPath, "utf-8").match(/^api_key = "([^"]*)"$/m)[1];
  },
};

let tmpHome;
let savedHome;
let savedUserProfile;
let savedAppData;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-cli-key-"));
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
  savedAppData = process.env.APPDATA;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.APPDATA = tmpHome;
  mocks.getApiKeys.mockReset();
  mocks.getApiKeys.mockResolvedValue(KEYS);
});

afterEach(() => {
  process.env.HOME = savedHome;
  if (savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserProfile;
  if (savedAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = savedAppData;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("CLI tool Apply writes a real dashboard key", () => {
  it("runs against the temp HOME, not the real one", () => {
    expect(os.homedir()).toBe(tmpHome);
  });

  for (const [tool, apply] of Object.entries(TOOLS)) {
    describe(tool, () => {
      it("writes the first active dashboard key when the card sends the sk_krouter placeholder", async () => {
        expect(await apply("sk_krouter")).toBe("sk-dashboard-1111");
      });

      it("writes the first active dashboard key when the card sends no key", async () => {
        expect(await apply("")).toBe("sk-dashboard-1111");
        expect(await apply(undefined)).toBe("sk-dashboard-1111");
      });

      it("keeps the key the user picked", async () => {
        expect(await apply("sk-dashboard-2222")).toBe("sk-dashboard-2222");
      });

      it("writes an empty key, never the placeholder, when there is no active dashboard key", async () => {
        mocks.getApiKeys.mockResolvedValue([{ id: "a", key: "sk-revoked-0000", isActive: false }]);
        expect(await apply("sk_krouter")).toBe("");
      });
    });
  }
});

describe("resolveCliApiKey", () => {
  it("treats the upstream sk_9router placeholder as no key", async () => {
    expect(await resolveCliApiKey("sk_9router")).toBe("sk-dashboard-1111");
  });

  it("trims a picked key", async () => {
    expect(await resolveCliApiKey("  sk-dashboard-2222  ")).toBe("sk-dashboard-2222");
  });

  it("returns an empty key when the database read fails", async () => {
    mocks.getApiKeys.mockRejectedValue(new Error("db locked"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await resolveCliApiKey("sk_krouter")).toBe("");
    log.mockRestore();
  });
});
