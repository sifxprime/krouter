import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The Cline card's Apply sent `<base>/v1`, and the cline-settings route then
 * stripped the /v1 ("Cline expects base WITHOUT /v1"). It does not: Cline's
 * OpenAI-compatible provider passes the base URL to the AI SDK's
 * createOpenAICompatible, which requests `${baseURL}/chat/completions`
 * (cline/cline sdk/packages/llms/src/providers/vendors/openai-compatible.ts,
 * vercel/ai packages/openai-compatible). Cline's own docs and CLI README use a
 * base URL that ends in /v1. kRouter serves the OpenAI API only under /v1, so
 * the stripped URL made every Cline request hit /chat/completions and 404.
 * These tests run Apply against a temp HOME.
 */
const { POST } = await import("../../src/app/api/cli-tools/cline-settings/route.js");

const CARD = path.join(process.cwd(), "src/app/(dashboard)/dashboard/cli-tools/components/ClineToolCard.js");
const NEXT_CONFIG = path.join(process.cwd(), "next.config.mjs");

let tmpHome;
let savedHome;
let savedUserProfile;
const dataDir = () => path.join(tmpHome, ".cline", "data");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dataDir(), name), "utf-8"));
const apply = (body) =>
  POST(new Request("http://localhost/api/cli-tools/cline-settings", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-cline-v1-"));
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

describe("kRouter only serves the OpenAI API under /v1", () => {
  it("has no rewrite or route for a bare /chat/completions", () => {
    const src = fs.readFileSync(NEXT_CONFIG, "utf-8");
    const sources = [...src.matchAll(/source:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => s.startsWith("/v1") || s.startsWith("/codex"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "src/app/chat"))).toBe(false);
  });
});

describe("Cline Apply keeps /v1 on the base URL", () => {
  it("runs against the temp HOME, not the real one", () => {
    expect(os.homedir()).toBe(tmpHome);
  });

  it("writes the /v1 URL the card sends", async () => {
    const res = await apply({ baseUrl: "http://localhost:20128/v1", apiKey: "sk_krouter", model: "cc/claude-sonnet-4-6" });
    expect(res.status).toBe(200);
    expect(readJson("globalState.json").openAiBaseUrl).toBe("http://localhost:20128/v1");
  });

  it("adds /v1 when the caller sends a bare base", async () => {
    const res = await apply({ baseUrl: "https://my-tunnel.example.com/", apiKey: "sk_krouter", model: "cc/claude-sonnet-4-6" });
    expect(res.status).toBe(200);
    expect(readJson("globalState.json").openAiBaseUrl).toBe("https://my-tunnel.example.com/v1");
  });

  it("rejects a base URL that is not a URL instead of writing it", async () => {
    const res = await apply({ baseUrl: "not a url", apiKey: "sk_krouter", model: "cc/claude-sonnet-4-6" });
    expect(res.status).toBe(400);
    expect(fs.existsSync(path.join(dataDir(), "globalState.json"))).toBe(false);
  });

  it("does not strip /v1 in the card's manual config either", () => {
    const src = fs.readFileSync(CARD, "utf-8");
    expect(src).not.toContain("baseWithoutV1");
    expect(src).not.toMatch(/slice\(0,\s*-3\)/);
  });
});
