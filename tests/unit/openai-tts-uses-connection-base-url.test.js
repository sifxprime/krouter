/**
 * OpenAI TTS must send /v1/audio/speech to the connection's own base URL.
 *
 * A connection's base URL is stored in providerSpecificData.baseUrl (POST
 * /api/providers keeps body.providerSpecificData via normalizeProviderSpecificData;
 * chat executors and the compatible-node embeddings adapter read it from there).
 * getProviderCredentials hands providerSpecificData through but never sets a
 * top-level credentials.baseUrl, which is the only field ttsProviders/openai.js
 * read — so the override was dead and every request went to api.openai.com.
 *
 * Credentials here come from the real getProviderCredentials + health cache over
 * a stored connection row; only the SQLite layer and network are faked.
 *
 * Base URL forms: the OpenAI SDK's base URL includes /v1
 * (https://github.com/openai/openai-node/blob/master/src/client.ts, default
 * "https://api.openai.com/v1") and speech posts to "/audio/speech"
 * (src/resources/audio/speech.ts). A bare host ("http://host:port") is also accepted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({ rows: [] }));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async (filter = {}) =>
    db.rows.filter((r) => (filter.provider ? r.provider === filter.provider : true) && (filter.isActive === undefined || r.isActive === filter.isActive))),
  updateProviderConnection: vi.fn(async () => null),
  updateProviderConnectionAtomic: vi.fn(async () => null),
  validateApiKey: vi.fn(async () => true),
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
  getComboByName: vi.fn(async () => null),
  getModelAliases: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({ connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "" })),
}));
vi.mock("open-sse/services/quotaPreflight.js", () => ({
  isAccountAboveThreshold: vi.fn(() => true),
  warmQuotaCache: vi.fn(),
  invalidateQuotaCache: vi.fn(),
  recordQuotaCacheHit: vi.fn(),
  remainingPctForAccount: vi.fn(() => null),
}));
vi.mock("@/sse/utils/logger.js", () => ({ request: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

import { handleTts } from "@/sse/handlers/tts.js";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { syncHealthCache } from "@/shared/services/healthCache.js";
import { normalizeProviderSpecificData } from "@/lib/providerNormalization.js";

const originalFetch = global.fetch;
const MOCK_HOST = "http://127.0.0.1:18931";

// The row POST /api/providers stores for { provider: "openai", apiKey, providerSpecificData }
const storedOpenAIConnection = (providerSpecificData) => ({
  id: "conn-openai-1",
  provider: "openai",
  authType: "apikey",
  name: "OpenAI (mock)",
  apiKey: "sk-test-connection-key",
  priority: 1,
  isActive: true,
  testStatus: "active",
  providerSpecificData: {
    ...(normalizeProviderSpecificData("openai", {}, providerSpecificData) || {}),
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
  },
});

const speechRequest = () => new Request("http://localhost/v1/audio/speech", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: "openai/tts-1", input: "Hello", voice: "nova" }),
});

// URL of the last upstream TTS call made through the real /v1/audio/speech handler
const upstreamUrlFor = async (providerSpecificData) => {
  db.rows = [storedOpenAIConnection(providerSpecificData)];
  await syncHealthCache();
  const res = await handleTts(speechRequest());
  expect(res.status).toBe(200);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, init] = global.fetch.mock.calls[0];
  expect(init.headers.Authorization).toBe("Bearer sk-test-connection-key");
  return url;
};

beforeEach(() => {
  global.fetch = vi.fn(async () =>
    new Response(new Uint8Array(256), { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("OpenAI TTS uses the connection's base URL", () => {
  it("credentials carry the stored base URL in providerSpecificData, not top-level", async () => {
    db.rows = [storedOpenAIConnection({ baseUrl: `${MOCK_HOST}/v1` })];
    await syncHealthCache();
    const credentials = await getProviderCredentials("openai", null, "tts-1");
    expect(credentials.providerSpecificData.baseUrl).toBe(`${MOCK_HOST}/v1`);
    expect(credentials.baseUrl).toBeUndefined();
  });

  it("sends to a base URL given in OpenAI SDK form (ends in /v1)", async () => {
    expect(await upstreamUrlFor({ baseUrl: `${MOCK_HOST}/v1` })).toBe(`${MOCK_HOST}/v1/audio/speech`);
  });

  it("sends to a bare-host base URL", async () => {
    expect(await upstreamUrlFor({ baseUrl: MOCK_HOST })).toBe(`${MOCK_HOST}/v1/audio/speech`);
  });

  it("ignores trailing slashes and surrounding whitespace", async () => {
    expect(await upstreamUrlFor({ baseUrl: ` ${MOCK_HOST}/v1/ ` })).toBe(`${MOCK_HOST}/v1/audio/speech`);
    vi.clearAllMocks();
    expect(await upstreamUrlFor({ baseUrl: `${MOCK_HOST}//` })).toBe(`${MOCK_HOST}/v1/audio/speech`);
  });

  it("keeps a gateway path prefix", async () => {
    expect(await upstreamUrlFor({ baseUrl: `${MOCK_HOST}/openai/v1` })).toBe(`${MOCK_HOST}/openai/v1/audio/speech`);
  });

  it("treats any base with a path as SDK form, like the chat executors (Cloudflare / DeepInfra gateways)", async () => {
    expect(await upstreamUrlFor({ baseUrl: `${MOCK_HOST}/v1/acct/gw/openai` })).toBe(`${MOCK_HOST}/v1/acct/gw/openai/audio/speech`);
  });

  it("falls back to api.openai.com when the connection sets no base URL", async () => {
    expect(await upstreamUrlFor(null)).toBe("https://api.openai.com/v1/audio/speech");
    vi.clearAllMocks();
    expect(await upstreamUrlFor({ baseUrl: "   " })).toBe("https://api.openai.com/v1/audio/speech");
  });
});
