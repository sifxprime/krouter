// 0.5.91 — Routing Decision Log read endpoint.

import { NextResponse } from "next/server";
import { readRoutingLog } from "open-sse/services/routingLog.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const providerFilter = url.searchParams.get("providerId");
  let entries = readRoutingLog(limit * 2); // over-fetch so provider filter still returns N
  if (providerFilter) entries = entries.filter((e) => e.provider === providerFilter);
  entries = entries.slice(0, limit);
  return NextResponse.json({ success: true, count: entries.length, entries }, {
    headers: { "Cache-Control": "no-store" },
  });
}
