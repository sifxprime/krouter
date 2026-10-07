import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Reset also clears the Cline CLI's providers.json (~/.cline/data/settings),
 * but it picked the openai-compatible entry to drop with "URL contains
 * localhost/127.0.0.1" or "URL equals globalState.openAiBaseUrl". Both match
 * entries kRouter never wrote: a `cline auth` setup for a local Ollama
 * (localhost:11434), or a third-party host the VS Code extension also points
 * at. Reset then left the CLI with no provider. It must drop only an entry
 * whose base is a kRouter endpoint: the local port, or one the card names
 * (tunnel, Tailscale, the endpoint picked).
 */
const { POST, DELETE } = await import("../../src/app/api/cli-tools/cline-settings/route.js");

const CARD = path.join(process.cwd(), "src/app/(dashboard)/dashboard/cli-tools/components/ClineToolCard.js");

let tmpHome;
let savedHome;
let savedUserProfile;
const dataDir = () => path.join(tmpHome, ".cline", "data");
const providersFile = () => path.join(dataDir(), "settings", "providers.json");
const globalStateFile = () => path.join(dataDir(), "globalState.json");
const writeJson = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
};
const readText = (file) => fs.readFileSync(file, "utf-8");
const readJson = (file) => JSON.parse(readText(file));
const reset = (body) => DELETE(new Request("http://localhost/api/cli-tools/cline-settings", {
  method: "DELETE",
  ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
}));

const providersWith = (baseUrl, tokenSource = "manual") => ({
  version: 1,
  lastUsedProvider: "openai-compatible",
  modes: {},
  providers: {
    "openai-compatible": {
      settings: { provider: "openai-compatible", apiKey: "user-key", model: "user/model", baseUrl },
      updatedAt: "2026-09-01T00:00:00.000Z",
      tokenSource,
    },
  },
});

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-cline-reset-"));
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

describe("Cline Reset keeps CLI providers kRouter did not write", () => {
  it("runs against the temp HOME, not the real one", () => {
    expect(os.homedir()).toBe(tmpHome);
  });

  it("leaves a `cline auth` entry for a local Ollama alone (no prior Apply)", async () => {
    writeJson(providersFile(), providersWith("http://localhost:11434/v1"));
    const before = readText(providersFile());
    expect((await reset()).status).toBe(200);
    expect(readText(providersFile())).toBe(before);
  });

  it("leaves an entry alone when it matches a third-party URL in globalState (no prior Apply)", async () => {
    writeJson(globalStateFile(), {
      actModeApiProvider: "openai",
      planModeApiProvider: "openai",
      openAiBaseUrl: "https://api.together.xyz/v1",
      actModeOpenAiModelId: "user/model",
    });
    writeJson(providersFile(), providersWith("https://api.together.xyz/v1", "migration"));
    const before = readText(providersFile());
    expect((await reset()).status).toBe(200);
    expect(readText(providersFile())).toBe(before);
  });

  it("still drops a kRouter entry an older Apply left without /v1", async () => {
    writeJson(providersFile(), providersWith("http://localhost:20128", "migration"));
    expect((await reset()).status).toBe(200);
    const stored = readJson(providersFile());
    expect(stored.providers["openai-compatible"]).toBeUndefined();
    expect(stored.lastUsedProvider).toBeUndefined();
  });

  it("drops an entry Apply wrote for a tunnel URL the card names", async () => {
    const tunnel = "https://quiet-river-1234.trycloudflare.com/v1";
    const apply = await POST(new Request("http://localhost/api/cli-tools/cline-settings", {
      method: "POST",
      body: JSON.stringify({ baseUrl: tunnel, apiKey: "sk_krouter", model: "cc/claude-sonnet-4-6" }),
    }));
    expect(apply.status).toBe(200);
    expect((await reset({ baseUrls: [tunnel] })).status).toBe(200);
    expect(readJson(providersFile()).providers["openai-compatible"]).toBeUndefined();
  });

  it("rejects a malformed Reset body and changes nothing", async () => {
    writeJson(providersFile(), providersWith("http://localhost:20128/v1"));
    const before = readText(providersFile());
    expect((await reset({ baseUrls: "http://localhost:20128/v1" })).status).toBe(400);
    expect((await reset("{ not json")).status).toBe(400);
    expect(readText(providersFile())).toBe(before);
  });

  it("the card sends the kRouter endpoints it knows with Reset", () => {
    const src = fs.readFileSync(CARD, "utf-8");
    const resetCall = src.slice(src.indexOf("const handleReset"), src.indexOf("const getManualConfigs"));
    expect(resetCall).toMatch(/method:\s*"DELETE"/);
    expect(resetCall).toContain("baseUrls");
    expect(resetCall).toContain("getEffectiveBaseUrl()");
    expect(resetCall).toContain("tunnelPublicUrl");
    expect(resetCall).toContain("tailscaleUrl");
  });
});
