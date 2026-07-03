// 0.5.91 — Zenith Engine visibility.
//
// GET  /api/providers/zenith                   → full leaderboard (all active connections)
// GET  /api/providers/zenith?providerId=X      → same, scoped to one provider
// GET  /api/providers/zenith?providerId=X&model=Y → same, computed for a specific model
//
// Returns per-connection breakdown so the dashboard can render:
//   Z:923  = healthScore (875) × quotaFactor (1.0) + priorityBonus (10)
//
// Also returns the ranking (who wins for the given model). This is the
// same computation `selectAccountZenith` performs live, exposed for UI.

import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { scoreOf, getHealthSnapshot } from "@/shared/services/connectionHealth";
import { zenithScore } from "open-sse/services/accountSelector.js";
import { scoreModelForCombo } from "open-sse/services/quotaPreflight.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const providerFilter = url.searchParams.get("providerId");
  const model = url.searchParams.get("model") || null;

  try {
    const all = await getProviderConnections({ isActive: true });
    const conns = providerFilter ? all.filter((c) => c.provider === providerFilter) : all;
    const snap = getHealthSnapshot();

    const entries = conns.map((c) => {
      const health = Math.max(0, scoreOf(c.id) ?? 500);
      const final = zenithScore(c, model);
      // Break out the quota + priority contributions so the UI can label them.
      const remainingPct = model && c.provider
        ? scoreModelForCombo(c.provider, c.id, model)
        : null;
      let quotaFactor = 1.0;
      if (remainingPct !== null && remainingPct < 30) {
        quotaFactor = Math.max(0.1, remainingPct / 30);
      }
      const priorityBonus = (c.priority && c.priority > 0) ? c.priority * 10 : 0;

      return {
        connectionId: c.id,
        provider: c.provider,
        name: c.name || c.email || c.displayName || c.provider,
        priority: c.priority || 0,
        healthScore: Math.round(health),
        quotaFactor: Math.round(quotaFactor * 100) / 100,
        quotaRemainingPct: remainingPct,
        priorityBonus,
        finalScore: Math.round(final),
        health: snap[c.id] || null, // full health breakdown for tooltip
      };
    });

    entries.sort((a, b) => b.finalScore - a.finalScore);
    const ranked = entries.map((e, i) => ({ ...e, rank: i + 1 }));
    const winner = ranked[0] || null;

    return NextResponse.json({
      success: true,
      strategy: "zenith",
      model,
      count: ranked.length,
      winner,
      leaderboard: ranked,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err?.message || "Zenith snapshot failed" },
      { status: 500 },
    );
  }
}
