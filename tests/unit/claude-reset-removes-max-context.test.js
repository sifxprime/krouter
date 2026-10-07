import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The Claude Code card's "Max context" option (0.5.132) writes
 * CLAUDE_CODE_MAX_CONTEXT_TOKENS into ~/.claude/settings.json through the
 * claude-settings route, but the route's Reset (DELETE) never learned the key.
 * After Reset, Claude Code kept the overridden context window even though every
 * other kRouter key was gone. Reset also deleted API_TIMEOUT_MS whatever its
 * value, although only the TUI's Quick Setup writes it (always "600000"), so a
 * timeout the user set themselves was lost. These tests run Apply and Reset
 * against a temp HOME.
 */
const { POST, DELETE } = await import("../../src/app/api/cli-tools/claude-settings/route.js");

const CARD = path.join(process.cwd(), "src/app/(dashboard)/dashboard/cli-tools/components/ClaudeToolCard.js");
const TUI = path.join(process.cwd(), "cli/src/cli/menus/cliTools.js");

// The API timeout the TUI's Claude Quick Setup writes, read from its source.
const tuiTimeoutValues = () => {
  const src = fs.readFileSync(TUI, "utf-8");
  return [...new Set([...src.matchAll(/API_TIMEOUT_MS(?:\s*:|\s*=)\s*"(\d+)"/g)].map((m) => m[1]))];
};

// The values the card can write, read from its CONTEXT_OPTIONS so a new preset
// added to the card without teaching Reset about it fails here.
const cardContextValues = () => {
  const src = fs.readFileSync(CARD, "utf-8");
  const block = src.slice(src.indexOf("const CONTEXT_OPTIONS = ["), src.indexOf("];", src.indexOf("const CONTEXT_OPTIONS = [")));
  return [...block.matchAll(/value:\s*"(\d+)"/g)].map((m) => m[1]);
};

// What handleApplySettings in ClaudeToolCard.js sends with every option set.
const cardApplyEnv = (maxContextTokens) => ({
  ANTHROPIC_BASE_URL: "http://localhost:20128/v1",
  ANTHROPIC_AUTH_TOKEN: "sk_krouter",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "cc/claude-opus-4-6",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "cc/claude-sonnet-4-6",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "cc/claude-haiku-4-5-20251001",
  ...(maxContextTokens ? { CLAUDE_CODE_MAX_CONTEXT_TOKENS: maxContextTokens } : {}),
});

let tmpHome;
let savedHome;
let savedUserProfile;
const settingsFile = () => path.join(tmpHome, ".claude", "settings.json");
const writeSettings = (obj) => {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(obj, null, 2));
};
const readSettings = () => JSON.parse(fs.readFileSync(settingsFile(), "utf-8"));
const apply = (env) =>
  POST(new Request("http://localhost/api/cli-tools/claude-settings", { method: "POST", body: JSON.stringify({ env }) }));

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-claude-reset-"));
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

describe("Claude Code card Reset", () => {
  it("runs against the temp HOME, not the real one", () => {
    expect(os.homedir()).toBe(tmpHome);
  });

  it("removes the max-context override the card's Apply wrote", async () => {
    expect((await apply(cardApplyEnv("998000"))).status).toBe(200);
    expect(readSettings().env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("998000");

    expect((await DELETE()).status).toBe(200);
    expect(readSettings().env?.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
  });

  it("removes every context value the card can write", async () => {
    const values = cardContextValues();
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      await apply(cardApplyEnv(value));
      await DELETE();
      expect(readSettings().env?.CLAUDE_CODE_MAX_CONTEXT_TOKENS, `preset ${value}`).toBeUndefined();
    }
  });

  it("removes every env key Apply wrote and keeps the user's own settings", async () => {
    const userEnv = { DISABLE_TELEMETRY: "1", HTTPS_PROXY: "http://proxy.internal:3128" };
    writeSettings({ model: "opus", permissions: { allow: ["Bash(npm test)"] }, env: { ...userEnv } });

    await apply(cardApplyEnv("498000"));
    await DELETE();

    const after = readSettings();
    expect(after.env).toEqual(userEnv);
    expect(after.model).toBe("opus");
    expect(after.permissions).toEqual({ allow: ["Bash(npm test)"] });
  });

  it("removes the API timeout the TUI's Quick Setup wrote", async () => {
    const values = tuiTimeoutValues();
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      await apply({ ...cardApplyEnv(), API_TIMEOUT_MS: value });
      await DELETE();
      expect(readSettings().env?.API_TIMEOUT_MS, `timeout ${value}`).toBeUndefined();
    }
  });

  it("keeps an API timeout the user set themselves", async () => {
    // The value Claude Code's own docs use as the example; kRouter never writes it.
    writeSettings({ env: { API_TIMEOUT_MS: "1200000" } });

    await apply(cardApplyEnv("998000"));
    await DELETE();

    expect(readSettings().env).toEqual({ API_TIMEOUT_MS: "1200000" });
  });

  it("keeps a context window the user set themselves", async () => {
    // Not one of the card's presets, so kRouter did not write it.
    writeSettings({ env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: "150000", ANTHROPIC_BASE_URL: "http://localhost:20128/v1" } });

    await DELETE();

    const after = readSettings();
    expect(after.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("150000");
    expect(after.env.ANTHROPIC_BASE_URL).toBeUndefined();
  });
});
