// 0.5.87 — Live model catalog fetch using a stored connection's credential.
//
// GET /api/models/live-by-connection?connectionId=<uuid>
// → { success: true, source: "live", count, models, provider, fetchedAtMs, cached }
//
// Uses the same LIVE_FETCH table as /api/models/preview so every provider
// covered there (34+) automatically works here. Auth headers, query-param
// keys (Gemini), and non-standard prefixes (Deepgram "Token ", ElevenLabs
// "xi-api-key") are handled centrally.
//
// Cached 10 minutes per connectionId. Used by the Available Models section
// on the provider dashboard so opening any provider page fires exactly one
// upstream fetch per 10-minute window.

import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { getLiveFetcher } from "@/shared/constants/liveFetch.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const cache = new Map(); // connectionId → { data, expiresAt }

function getCached(k) {
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) { cache.delete(k); return null; }
  return hit.data;
}

function setCached(k, data) {
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(k, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchWithTimeout(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally { clearTimeout(timer); }
}

function buildRequest(fetcher, apiKey) {
  const headers = { "Content-Type": "application/json", ...(fetcher.extraHeaders || {}) };
  let url = fetcher.url;
  if (fetcher.authQuery) {
    const u = new URL(url);
    u.searchParams.set(fetcher.authQuery, apiKey);
    url = u.toString();
  } else if (fetcher.authHeader) {
    headers[fetcher.authHeader] = `${fetcher.authPrefix || ""}${apiKey}`;
  }
  return { url, headers };
}

function normalize(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((m) => m && (m.id || m.name || m.model))
    .map((m) => ({
      id: m.id || m.name || m.model,
      name: m.name || m.displayName || m.id,
    }));
}

export async function GET(request) {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId");
  const force = url.searchParams.get("force") === "1";

  if (!connectionId) {
    return NextResponse.json({ success: false, error: "connectionId is required" }, { status: 400 });
  }

  if (!force) {
    const hit = getCached(connectionId);
    if (hit) return NextResponse.json({ ...hit, cached: true });
  }

  // Load the connection to get provider + credential.
  let connection;
  try {
    const all = await getProviderConnections();
    connection = all.find((c) => c.id === connectionId);
  } catch (e) {
    return NextResponse.json({ success: false, error: `DB read failed: ${e.message}` }, { status: 500 });
  }
  if (!connection) {
    return NextResponse.json({ success: false, error: "Connection not found" }, { status: 404 });
  }

  const provider = connection.provider;
  let fetcher = getLiveFetcher(provider);

  // 0.5.90 — Dynamic fetcher for user-configured compatible nodes.
  // provider ids look like `openai-compatible-<uuid>` / `anthropic-compatible-<uuid>`;
  // the base URL + key live inside providerSpecificData.
  if (!fetcher) {
    const isOpenAICompat = /^openai-compatible/.test(provider);
    const isAnthropicCompat = /^anthropic-compatible/.test(provider);
    const baseUrl = connection.providerSpecificData?.baseUrl || connection.baseUrl;
    if ((isOpenAICompat || isAnthropicCompat) && baseUrl) {
      const cleanBase = String(baseUrl).replace(/\/$/, "");
      const modelsUrl = /\/models$/.test(cleanBase) ? cleanBase : `${cleanBase}/models`;
      fetcher = isAnthropicCompat
        ? {
            url: modelsUrl,
            authHeader: "x-api-key",
            authPrefix: "",
            extraHeaders: { "anthropic-version": "2023-06-01" },
            parse: (j) => Array.isArray(j?.data) ? j.data : [],
          }
        : {
            url: modelsUrl,
            authHeader: "Authorization",
            authPrefix: "Bearer ",
            parse: (j) => Array.isArray(j?.data) ? j.data : (Array.isArray(j?.models) ? j.models : []),
          };
    }
  }

  if (!fetcher) {
    return NextResponse.json(
      { success: false, error: `No live fetcher for ${provider}`, code: "no_fetcher", provider },
      { status: 200 },
    );
  }

  const apiKey = connection.apiKey || connection.accessToken;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "Connection has no apiKey or accessToken", provider },
      { status: 200 },
    );
  }

  try {
    const { url: liveUrl, headers } = buildRequest(fetcher, apiKey);
    const res = await fetchWithTimeout(liveUrl, { method: "GET", headers });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        {
          success: false,
          provider,
          status: res.status,
          error: res.status === 401 || res.status === 403 ? "Invalid credential" : `Provider returned ${res.status}`,
          detail: errText.slice(0, 200),
        },
        { status: 200 },
      );
    }
    const json = await res.json();
    const raw = fetcher.parse ? fetcher.parse(json) : (json?.data || json?.models || []);
    const models = normalize(raw);
    const data = {
      success: true,
      source: "live",
      provider,
      count: models.length,
      models,
      fetchedAtMs: Date.now(),
    };
    setCached(connectionId, data);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        provider,
        error: err?.name === "AbortError" ? "Provider timed out" : (err?.message || "Fetch failed"),
      },
      { status: 200 },
    );
  }
}
