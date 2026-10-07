import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Current Cline keeps its provider settings in ~/.cline/data/settings/providers.json
 * (cline/cline sdk/packages/core/src/services/storage/provider-settings-manager.ts).
 * The CLI (npm `cline` 3.x) reads only that file; globalState.json is a legacy
 * source it migrates once and never again for a provider that already has an
 * entry (provider-settings-legacy-migration.ts: "Migration never overwrites an
 * existing entry"). So the card's Apply, which wrote only globalState.json,
 * did nothing for a CLI that had ever been set up, including by an earlier Apply.
 *
 * The VS Code extension (4.x) shares ~/.cline/data and reads globalState.json,
 * but picks the OpenAI-compatible model from actModeOpenAiModelId /
 * planModeOpenAiModelId (apps/vscode/src/shared/storage/state-keys.ts). Apply
 * wrote planModeOpenAiModelId and a bare openAiModelId Cline no longer reads,
 * so Act mode (the default) had no model.
 */
const { POST, DELETE } = await import("../../src/app/api/cli-tools/cline-settings/route.js");

let tmpHome;
let savedHome;
let savedUserProfile;
const dataDir = () => path.join(tmpHome, ".cline", "data");
const providersFile = () => path.join(dataDir(), "settings", "providers.json");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));
const writeJson = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
};
const apply = (body) =>
  POST(new Request("http://localhost/api/cli-tools/cline-settings", { method: "POST", body: JSON.stringify(body) }));
const APPLY_BODY = { baseUrl: "http://localhost:20128/v1", apiKey: "sk_krouter", model: "cc/claude-sonnet-4-6" };

// A Cline account login plus the openai-compatible entry an earlier Apply
// produced through Cline's one-shot migration (no /v1, so it 404s).
const existingProviders = () => ({
  version: 1,
  lastUsedProvider: "cline",
  modes: {},
  providers: {
    cline: {
      settings: { provider: "cline", auth: { accessToken: "workos:test-access", refreshToken: "test-refresh" } },
      updatedAt: "2026-09-01T00:00:00.000Z",
      tokenSource: "oauth",
    },
    "openai-compatible": {
      settings: { provider: "openai-compatible", apiKey: "sk_old", model: "old/model", baseUrl: "http://localhost:20128" },
      updatedAt: "2026-09-01T00:00:00.000Z",
      tokenSource: "migration",
    },
  },
});

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-cline-cli-"));
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

describe("Cline Apply reaches the Cline CLI", () => {
  it("runs against the temp HOME, not the real one", () => {
    expect(os.homedir()).toBe(tmpHome);
  });

  it("writes an openai-compatible entry to providers.json and makes it the active provider", async () => {
    expect((await apply(APPLY_BODY)).status).toBe(200);
    const stored = readJson(providersFile());
    expect(stored.version).toBe(1);
    expect(stored.lastUsedProvider).toBe("openai-compatible");
    const entry = stored.providers["openai-compatible"];
    expect(entry.settings).toMatchObject({
      provider: "openai-compatible",
      apiKey: "sk_krouter",
      model: "cc/claude-sonnet-4-6",
      baseUrl: "http://localhost:20128/v1",
    });
    // Cline validates updatedAt with z.string().datetime() and drops the whole file on failure.
    expect(new Date(entry.updatedAt).toISOString()).toBe(entry.updatedAt);
    expect(["manual", "oauth", "migration"]).toContain(entry.tokenSource);
  });

  it("replaces a stale migrated entry and keeps every other provider", async () => {
    writeJson(providersFile(), existingProviders());
    expect((await apply(APPLY_BODY)).status).toBe(200);
    const stored = readJson(providersFile());
    expect(stored.providers["openai-compatible"].settings.baseUrl).toBe("http://localhost:20128/v1");
    expect(stored.providers["openai-compatible"].settings.apiKey).toBe("sk_krouter");
    expect(stored.providers.cline).toEqual(existingProviders().providers.cline);
    expect(stored.lastUsedProvider).toBe("openai-compatible");
  });

  it("Reset removes the kRouter entry and hands the CLI back to the remaining provider", async () => {
    writeJson(providersFile(), existingProviders());
    await apply(APPLY_BODY);
    expect((await DELETE()).status).toBe(200);
    const stored = readJson(providersFile());
    expect(stored.providers["openai-compatible"]).toBeUndefined();
    expect(stored.providers.cline).toEqual(existingProviders().providers.cline);
    expect(stored.lastUsedProvider).toBe("cline");
  });

  it("Reset leaves an openai-compatible entry that points somewhere else alone", async () => {
    const other = existingProviders();
    other.lastUsedProvider = "openai-compatible";
    other.providers["openai-compatible"].settings.baseUrl = "https://api.example.com/v1";
    writeJson(providersFile(), other);
    expect((await DELETE()).status).toBe(200);
    expect(readJson(providersFile())).toEqual(other);
  });
});

describe("Cline Apply sets the model Act mode reads", () => {
  it("writes actModeOpenAiModelId as well as planModeOpenAiModelId", async () => {
    expect((await apply(APPLY_BODY)).status).toBe(200);
    const state = readJson(path.join(dataDir(), "globalState.json"));
    expect(state.actModeApiProvider).toBe("openai");
    expect(state.planModeApiProvider).toBe("openai");
    expect(state.actModeOpenAiModelId).toBe("cc/claude-sonnet-4-6");
    expect(state.planModeOpenAiModelId).toBe("cc/claude-sonnet-4-6");
    expect(readJson(path.join(dataDir(), "secrets.json")).openAiApiKey).toBe("sk_krouter");
  });

  it("Reset clears the act-mode model too", async () => {
    await apply(APPLY_BODY);
    await DELETE();
    const state = readJson(path.join(dataDir(), "globalState.json"));
    expect(state.actModeOpenAiModelId).toBeUndefined();
    expect(state.planModeOpenAiModelId).toBeUndefined();
  });
});
