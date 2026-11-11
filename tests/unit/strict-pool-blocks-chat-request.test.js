// End to end: a strict pool that is inactive must block a chat request, from the
// pool lookup (resolveConnectionProxyConfig) through account selection
// (getProviderCredentials) to the executor's fetch (handleChatCore ->
// proxyAwareFetch). Each layer was fixed on its own in 0.5.166; this file checks
// the chain.
//
// The gap this file was written against is closed: getProviderCredentials now
// copies strictProxy into providerSpecificData at both sites (upstream cfd8c618),
// so the whole chain holds and these cases pass.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ conns: [], settings: {} }));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  validateApiKey: vi.fn(async () => true),
  updateProviderConnection: vi.fn(async () => null),
  updateProviderConnectionAtomic: vi.fn(async () => null),
  getSettings: vi.fn(async () => state.settings),
}));
vi.mock("@/shared/services/healthCache.js", () => ({
  getCachedConnections: vi.fn(async () => state.conns),
  lockAccountInMemory: vi.fn(),
}));
vi.mock("@/models", () => ({ getProxyPoolById: vi.fn() }));
vi.mock("open-sse/services/quotaPreflight.js", () => ({
  isAccountAboveThreshold: vi.fn(() => true),
  warmQuotaCache: vi.fn(),
  invalidateQuotaCache: vi.fn(),
  recordQuotaCacheHit: vi.fn(),
}));
vi.mock("open-sse/services/accountSelector.js", () => ({
  selectAccount: vi.fn((accounts) => ({ account: accounts[0] })),
  getRoundRobinState: vi.fn(() => ({})),
}));
vi.mock("@/sse/utils/logger.js", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
// The base executor retries a thrown fetch as a 502, 3 times 3 s apart. The
// strict refusal is deterministic, so retries only slow the test down.
vi.mock("open-sse/config/runtimeConfig.js", async (importOriginal) => ({
  ...(await importOriginal()),
  DEFAULT_RETRY_CONFIG: {
    429: { attempts: 0, delayMs: 0 },
    502: { attempts: 0, delayMs: 0 },
    503: { attempts: 0, delayMs: 0 },
    504: { attempts: 0, delayMs: 0 },
  },
}));

const CHAT_SSE = [
  { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "stop" }] },
].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";

// proxyFetch captures globalThis.fetch at import time as its direct fetch. Stub
// it first so a direct connection is observable instead of real. An ambient
// HTTP_PROXY / HTTPS_PROXY / ALL_PROXY would resolve a proxy on its own and
// satisfy strict; tests/setup/no-ambient-proxy.js scrubs them before this runs.
const realFetch = globalThis.fetch;
const directFetch = vi.fn(async () => new Response(CHAT_SSE, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
globalThis.fetch = directFetch;

const dataDir = mkdtempSync(join(tmpdir(), "krouter-strict-chain-"));
process.env.DATA_DIR = dataDir;

await import("../translator/registerAll.js");
const { getProxyPoolById } = await import("@/models");
const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

afterAll(() => {
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

const STRICT_REFUSAL = /Proxy required but none resolved \(strictProxy=true\)/;
const INACTIVE_POOL = { id: "pool-strict", isActive: false, proxyUrl: "http://127.0.0.1:7890" };

beforeEach(() => {
  directFetch.mockClear();
  getProxyPoolById.mockReset();
  getProxyPoolById.mockResolvedValue({ ...INACTIVE_POOL, strictProxy: true });
  state.settings = {};
  state.conns = [{
    id: "conn-openai", provider: "openai", authType: "apikey", apiKey: "sk-test", isActive: true,
    priority: 1, providerSpecificData: { proxyPoolId: "pool-strict" },
  }];
});

const runChat = (credentials) => handleChatCore({
  body: { model: "openai/gpt-4o", stream: true, messages: [{ role: "user", content: "hello" }] },
  modelInfo: { provider: "openai", model: "gpt-4o" },
  credentials,
  connectionId: credentials.connectionId,
});

describe("a strict pool that is down blocks a chat request end to end", () => {
  it("getProviderCredentials hands the pool id of the strict pool to the chat path", async () => {
    const creds = await getProviderCredentials("openai", null, "gpt-4o");
    expect(creds.connectionId).toBe("conn-openai");
    expect(creds.providerSpecificData).toMatchObject({
      connectionProxyPoolId: "pool-strict", connectionProxyEnabled: false, connectionProxyUrl: "",
    });
  });

  it("the chat path refuses once the credentials carry strictProxy", async () => {
    const creds = await getProviderCredentials("openai", null, "gpt-4o");
    const strictCreds = { ...creds, providerSpecificData: { ...creds.providerSpecificData, strictProxy: true } };
    const result = await runChat(strictCreds);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(STRICT_REFUSAL);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("a down pool that is not strict still goes direct", async () => {
    getProxyPoolById.mockResolvedValue({ ...INACTIVE_POOL, strictProxy: false });
    const creds = await getProviderCredentials("openai", null, "gpt-4o");
    const result = await runChat(creds);
    expect(result.success).toBe(true);
    expect(directFetch).toHaveBeenCalledTimes(1);
  });

  it("an inactive strict pool selected by getProviderCredentials blocks the request", async () => {
    // KNOWN GAP: auth.js:388 leaves strictProxy out of providerSpecificData.
    const creds = await getProviderCredentials("openai", null, "gpt-4o");
    const result = await runChat(creds);
    expect(result.error).toMatch(STRICT_REFUSAL);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("the no-auth virtual connection carries the strict pool's strictProxy", async () => {
    // KNOWN GAP: auth.js:220 leaves strictProxy out of providerSpecificData.
    state.settings = { providerStrategies: { opencode: { proxyPoolId: "pool-strict" } } };
    const creds = await getProviderCredentials("opencode", null, "big-pickle");
    expect(creds.providerSpecificData.connectionProxyPoolId).toBe("pool-strict");
    expect(creds.providerSpecificData.strictProxy).toBe(true);
  });
});
