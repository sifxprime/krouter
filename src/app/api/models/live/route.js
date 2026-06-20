import { NextResponse } from "next/server";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderConnections } from "@/lib/localDb";
import { FILTERS } from "@/app/api/providers/suggested-models/filters";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveQoderModels } from "open-sse/services/qoderModels.js";

export const dynamic = "force-dynamic";

// In-process LRU cache. Key shape:
//   "<providerId>"               for credential-less fetches (free providers)
//   "<providerId>:<connectionId>" for credential-based fetches (OAuth/API key)
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const cache = new Map(); // key → { data, expiresAt }

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function setCached(key, data) {
  // Soft cap so a long-lived dev process doesn't grow unbounded.
  if (cache.size > 200) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Free / public provider — pull from modelsFetcher.url, parse via FILTERS.
async function fetchFromPublicFetcher(providerInfo) {
  const fetcher = providerInfo?.modelsFetcher;
  if (!fetcher?.url || !fetcher?.type) return { models: [], source: "no-fetcher" };

  const res = await fetchWithTimeout(fetcher.url);
  if (!res.ok) return { models: [], source: "fetcher", error: `Provider returned HTTP ${res.status}` };

  const json = await res.json();
  const raw = json.data ?? json.models ?? json;
  const filter = FILTERS[fetcher.type];
  if (filter) {
    const data = filter(Array.isArray(raw) ? raw : []);
    return { models: data, source: "fetcher" };
  }
  // Generic OpenAI-style fallback when no specific filter
  const list = Array.isArray(raw) ? raw : (json.data || []);
  const models = list
    .filter((m) => m?.id)
    .map((m) => ({ id: m.id, name: m.name || m.id }));
  return { models, source: "fetcher" };
}

// OAuth provider — use the credential to fetch live model list (e.g. Kiro
// returns a per-account set including -thinking/-agentic variants).
async function fetchFromCredentialedResolver(providerId, connection) {
  const resolvers = {
    kiro: async (conn) => {
      const result = await resolveKiroModels({
        accessToken: conn.accessToken,
        refreshToken: conn.refreshToken,
        providerSpecificData: conn.providerSpecificData || {}
      }, { log: console });
      return result?.models?.length
        ? { models: result.models.map(m => ({ id: m.id, name: m.name || m.id })) }
        : null;
    },
    qoder: async (conn) => {
      const result = await resolveQoderModels({
        accessToken: conn.accessToken,
        refreshToken: conn.refreshToken,
        email: conn.email,
        displayName: conn.displayName,
        providerSpecificData: conn.providerSpecificData || {}
      });
      return result?.models?.length
        ? { models: result.models.map(m => ({ id: m.id, name: m.name || m.id })) }
        : null;
    },
  };

  const resolver = resolvers[providerId];
  if (!resolver) return null;
  const result = await resolver(connection);
  return result ? { models: result.models, source: "resolver" } : null;
}

// API-key OpenAI-compatible provider — best-effort hit of <baseUrl>/models with
// the user's key. Many providers expose this; we degrade silently if not.
async function fetchFromApiKeyEndpoint(providerInfo, connection) {
  if (!connection?.apiKey) return null;
  const baseUrl = connection?.providerSpecificData?.baseUrl
    || providerInfo?.notice?.baseUrl
    || providerInfo?.modelsFetcher?.url?.replace(/\/(models|v1\/models).*$/, "/v1");
  if (!baseUrl) return null;

  const modelsUrl = baseUrl.endsWith("/models")
    ? baseUrl
    : `${baseUrl.replace(/\/$/, "")}/models`;

  try {
    const res = await fetchWithTimeout(modelsUrl, {
      headers: { "Authorization": `Bearer ${connection.apiKey}` }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const list = json?.data || json?.models || [];
    const models = list.filter((m) => m?.id).map((m) => ({ id: m.id, name: m.name || m.id }));
    return models.length ? { models, source: "apikey" } : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/models/live?provider=<id>[&connectionId=<id>][&refresh=1]
 *
 * Returns live model list for a provider, with smart fallback:
 *   1. Public modelsFetcher (free providers: opencode, mimo-free, openrouter,
 *      vercel-ai-gateway)
 *   2. Credential-based resolver (OAuth: kiro, qoder)
 *   3. OpenAI-compatible /models endpoint with the user's API key
 *
 * Response shape:
 *   { provider, models: [{id, name}], source, cached, error? }
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("provider");
    const connectionId = searchParams.get("connectionId");
    const refresh = searchParams.get("refresh") === "1";

    if (!providerId) {
      return NextResponse.json({ error: "provider param required" }, { status: 400 });
    }

    const providerInfo = AI_PROVIDERS[providerId];
    if (!providerInfo) {
      return NextResponse.json({ error: `Unknown provider: ${providerId}`, models: [] }, { status: 404 });
    }

    const cacheKey = connectionId ? `${providerId}:${connectionId}` : providerId;

    // Cache hit
    if (!refresh) {
      const cached = getCached(cacheKey);
      if (cached) return NextResponse.json({ ...cached, cached: true });
    }

    // Resolve connection if we need credentials
    let connection = null;
    if (connectionId) {
      const conns = await getProviderConnections();
      connection = conns.find(c => c.id === connectionId) || null;
    }

    // Strategy fallback chain — first one that returns models wins.
    let result = null;

    // 1) Public fetcher (works for any provider with modelsFetcher; cheapest)
    if (providerInfo.modelsFetcher) {
      try { result = await fetchFromPublicFetcher(providerInfo); }
      catch (e) { result = { models: [], source: "fetcher", error: e.message }; }
    }

    // 2) Credentialed resolver (OAuth providers like kiro/qoder)
    if ((!result || !result.models?.length) && connection) {
      try {
        const resolved = await fetchFromCredentialedResolver(providerId, connection);
        if (resolved) result = resolved;
      } catch (e) {
        if (!result) result = { models: [], source: "resolver", error: e.message };
      }
    }

    // 3) API-key /models endpoint (last resort for API-key providers)
    if ((!result || !result.models?.length) && connection?.apiKey) {
      try {
        const apiResult = await fetchFromApiKeyEndpoint(providerInfo, connection);
        if (apiResult) result = apiResult;
      } catch (e) {
        if (!result) result = { models: [], source: "apikey", error: e.message };
      }
    }

    const payload = {
      provider: providerId,
      models: result?.models || [],
      source: result?.source || "none",
      error: result?.error || null,
      cached: false,
    };

    // Only cache successful fetches (don't poison cache with empty failures)
    if (payload.models.length > 0) setCached(cacheKey, payload);

    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error in /api/models/live:", error);
    return NextResponse.json({ error: error.message || "Live fetch failed", models: [] }, { status: 500 });
  }
}
