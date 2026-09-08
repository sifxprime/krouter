// REAL integration smoke test: sends a tiny prompt to EVERY provider that has an
// active credential in the local DB, through the full production path (handleChatCore).
// Gated by RUN_REAL=1 so the default `vitest run` never touches the network.
//
//   RUN_REAL=1 npx vitest run "tests/translator/real/"
//
// Each provider becomes its own test; providers without an llm model or without an
// active credential are skipped automatically.
import { describe, it, expect, beforeAll } from "vitest";
// translator/index.js registers translators with require(), which is a bundler-only
// pattern and a no-op under vitest. Without this the registry is empty,
// translateRequest returns the body untouched, and an OpenAI-shaped payload is
// posted to providers that expect their own envelope -- Antigravity answers
// "Unknown name messages", Kiro answers "Improperly formed request". The suite
// could never have passed for any provider that needs translation.
import "../registerAll.js";
import { getProviderConnections } from "../../../src/lib/localDb.js";
import { getProviderCredentials } from "../../../src/sse/services/auth.js";
import { checkAndRefreshToken } from "../../../src/sse/services/tokenRefresh.js";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";
import { getModelsByProviderId } from "../../../open-sse/config/providerModels.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const MAX_TOKENS = 32;
const TIMEOUT_MS = 90000;
// Optional comma-separated filter: REAL_PROVIDERS=kiro,codex,antigravity
const PROVIDER_FILTER = (process.env.REAL_PROVIDERS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Pick the first plain llm model for a provider (skip image/tts/embedding/etc).
function firstLlmModel(providerId) {
  const models = getModelsByProviderId(providerId);
  const llm = models.find((m) => (m.type || "llm") === "llm");
  return llm?.id || null;
}

// Drain the full Web Response SSE body into raw text.
async function drainSSE(response) {
  if (!response?.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

let providerIds = [];

beforeAll(async () => {
  if (!RUN_REAL) return;
  providerIds = targetProviders();
});

describe.skipIf(!RUN_REAL).concurrent("REAL provider smoke", () => {
  it("has active providers in DB", () => {
    // Name the reason: an unreadable database and an empty one are different
    // problems, and the old bare assertion could not tell them apart.
    expect(discoveryError ?? `found: ${providerIds.join(", ")}`).toBe(`found: ${providerIds.join(", ")}`);
    expect(providerIds.length).toBeGreaterThan(0);
  });

  // One concurrent test per provider; resolved lazily inside the test.
  for (const providerId of (RUN_REAL ? targetProviders() : [])) {
    it.concurrent(
      `${providerId}: responds to a short prompt`,
      async () => {
        const model = firstLlmModel(providerId);
        if (!model) return expect(true).toBe(true); // no llm model → skip silently

        const credentials = await getProviderCredentials(providerId, new Set(), model);
        if (!credentials || credentials.allRateLimited) {
          console.warn(`[skip] ${providerId}: no usable credential`);
          return expect(true).toBe(true);
        }

        const refreshed = await checkAndRefreshToken(providerId, credentials);
        const result = await handleChatCore({
          body: {
            model: `${providerId}/${model}`,
            stream: true,
            max_tokens: MAX_TOKENS,
            messages: [{ role: "user", content: "Reply with the single word: hi" }],
          },
          modelInfo: { provider: providerId, model },
          credentials: refreshed,
          connectionId: credentials.connectionId,
        });

        if (!result.success) {
          // Account/quota/auth problems are credential issues, not translation bugs → skip.
          const credIssue = [401, 402, 403, 429].includes(Number(result.status));
          if (credIssue) {
            console.warn(`[skip] ${providerId}: ${result.status} (credential/quota)`);
            return expect(true).toBe(true);
          }
          throw new Error(`${providerId} failed: ${result.status} ${result.error}`);
        }

        const raw = await drainSSE(result.response);
        // Minimal sanity: got SSE data and a terminal signal or content.
        expect(raw.length, `${providerId}: empty response`).toBeGreaterThan(0);
        expect(/data:|finish_reason|"delta"|"content"|event:/.test(raw), `${providerId}: not SSE`).toBe(true);
      },
      TIMEOUT_MS
    );
  }
});

// Read the DB file directly (sync) at module-eval time so vitest can generate one
// test per provider before beforeAll runs. Applies REAL_PROVIDERS filter.
// Tolerates any failure (returns []).
// Mirrors getDataDir() in cli/hooks/sqliteRuntime.js. This used to hardcode
// ~/.9router, the upstream directory -- this fork stores its database in
// ~/.krouter, so the path never existed, the catch below swallowed the ENOENT,
// and the whole real-provider suite silently reported "no active providers"
// instead of testing anything.
function dataDir() {
  const os = require("os");
  const path = require("path");
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") return path.join(process.env.APPDATA || os.homedir(), "krouter");
  return path.join(os.homedir(), ".krouter");
}

// Why the provider list came back empty, so a misconfigured run says so instead of
// looking like a machine with no credentials.
let discoveryError = null;

function targetProviders() {
  const path = require("path");
  const dbPath = path.join(dataDir(), "db", "data.sqlite");
  try {
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT DISTINCT provider FROM providerConnections WHERE isActive = 1").all();
    db.close();
    let list = rows.map((r) => r.provider).sort();
    if (PROVIDER_FILTER.length) list = list.filter((p) => PROVIDER_FILTER.includes(p));
    if (!list.length) {
      discoveryError = PROVIDER_FILTER.length
        ? `no active connection matched REAL_PROVIDERS=${PROVIDER_FILTER.join(",")} in ${dbPath}`
        : `no active connections in ${dbPath}`;
    }
    return list;
  } catch (err) {
    discoveryError = `could not read ${dbPath}: ${err.message}`;
    return [];
  }
}
