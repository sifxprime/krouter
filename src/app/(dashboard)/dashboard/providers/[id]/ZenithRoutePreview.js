"use client";

// 0.5.91 — Zenith Route Preview widget.
//
// Shows the user which of their connections Zenith would pick for the next
// request. Optional model dropdown so they can preview per-model.
// Auto-refreshes every 10s. Renders nothing when only 0-1 active connections
// exist (no interesting decision to preview).

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";

const REFRESH_MS = 10_000;

export default function ZenithRoutePreview({ providerId, models = [] }) {
  const [model, setModel] = useState("");
  const [state, setState] = useState({ status: "idle" });

  const load = useCallback(async () => {
    if (!providerId) return;
    setState((s) => ({ ...s, status: s.status === "ok" ? "refreshing" : "loading" }));
    try {
      const qs = new URLSearchParams({ providerId });
      if (model) qs.set("model", model);
      const res = await fetch(`/api/providers/zenith?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setState({ status: "ok", winner: data.winner, count: data.count, leaderboard: data.leaderboard });
      } else {
        setState({ status: "error", error: data.error || "Zenith read failed" });
      }
    } catch (e) {
      setState({ status: "error", error: e?.message || "Network error" });
    }
  }, [providerId, model]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (state.status === "idle" || state.status === "loading") return null;
  if (state.status === "error" || !state.winner || (state.count ?? 0) < 2) return null;

  const w = state.winner;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs">
      <span className="inline-flex items-center gap-1 text-primary font-medium">
        <span className="material-symbols-outlined text-sm">route</span>
        Next request →
      </span>
      <span className="font-medium text-text-main">{w.name}</span>
      <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
        Z:{w.finalScore}
      </span>
      <span className="text-text-muted">
        health {w.healthScore} · quota ×{w.quotaFactor} · priority +{w.priorityBonus}
      </span>
      {models.length > 0 && (
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-text-muted">Model:</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-md border border-border bg-bg px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-primary"
          >
            <option value="">(any)</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

ZenithRoutePreview.propTypes = {
  providerId: PropTypes.string.isRequired,
  models: PropTypes.array,
};
