// 0.5.86 — Live model catalog preview.
//
// POST /api/models/preview
//   { providerId: "siliconflow", apiKey: "sk-..." }
// → { success: true, source: "live", count: 87, models: [{id, name?}, ...], fetchedAtMs, cacheKey }
// or
// → { success: false, error: "Invalid API key", status: 401 }
//
// Used by the AddApiKeyModal to give the user immediate feedback ("we
// fetched 87 models from provider") before they save the connection.
// Also usable for a "Refresh catalog" button on saved connections.
//
// 10-minute in-process LRU cache keyed by providerId + first 8 chars of the
// key hash — so re-typing the same key doesn't re-hit the upstream API and
// two users with different keys don't share cache lines.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getLiveFetcher } from "@/shared/constants/liveFetch.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const cache = new Map(); // cacheKey → { data, expiresAt }

function makeCacheKey(providerId, apiKey) {
  const hash = crypto.createHash("sha1").update(apiKey || "").digest("hex").slice(0, 8);
  return `${providerId}:${hash}`;
}

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
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchWithTimeout(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildRequest(fetcher, apiKey) {
  const headers = { "Content-Type": "application/json", ...(fetcher.extraHeaders || {}) };
  let url = fetcher.url;

  if (fetcher.authQuery) {
    // Gemini-style: ?key=<apiKey>
    const u = new URL(url);
    u.searchParams.set(fetcher.authQuery, apiKey);
    url = u.toString();
  } else if (fetcher.authHeader) {
    headers[fetcher.authHeader] = `${fetcher.authPrefix || ""}${apiKey}`;
  }

  return { url, headers };
}

function normalizeModels(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((m) => m && (m.id || m.name || m.model))
    .map((m) => ({
      id: m.id || m.name || m.model,
      name: m.name || m.displayName || m.id,
    }));
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { providerId, apiKey } = body || {};
  if (!providerId || !apiKey) {
    return NextResponse.json(
      { success: false, error: "providerId and apiKey are required" },
      { status: 400 },
    );
  }

  const fetcher = getLiveFetcher(providerId);
  if (!fetcher) {
    return NextResponse.json(
      { success: false, error: `No live fetcher registered for ${providerId}`, code: "no_fetcher" },
      { status: 404 },
    );
  }

  const cacheKey = makeCacheKey(providerId, apiKey);
  const hit = getCached(cacheKey);
  if (hit) return NextResponse.json({ ...hit, cached: true });

  try {
    const { url, headers } = buildRequest(fetcher, apiKey);
    const res = await fetchWithTimeout(url, { method: "GET", headers });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        {
          success: false,
          status: res.status,
          error: res.status === 401 || res.status === 403
            ? "Invalid API key"
            : `Provider returned ${res.status}`,
          detail: errText.slice(0, 200),
        },
        { status: 200 }, // 200 so the client can show the inline error without console noise
      );
    }

    const json = await res.json();
    const raw = fetcher.parse ? fetcher.parse(json) : (json?.data || json?.models || []);
    const models = normalizeModels(raw);

    const data = {
      success: true,
      source: "live",
      providerId,
      count: models.length,
      models,
      fetchedAtMs: Date.now(),
    };
    setCached(cacheKey, data);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err?.name === "AbortError"
          ? "Provider timed out"
          : (err?.message || "Fetch failed"),
      },
      { status: 200 },
    );
  }
}

// GET /api/models/preview?providerId=X — lists provider ids that support preview.
export async function GET(request) {
  const url = new URL(request.url);
  const check = url.searchParams.get("providerId");
  if (check) {
    return NextResponse.json({ providerId: check, supported: !!getLiveFetcher(check) });
  }
  const { listLiveFetchProviders } = await import("@/shared/constants/liveFetch.js");
  return NextResponse.json({ supported: listLiveFetchProviders() });
}
