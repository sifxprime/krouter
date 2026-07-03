"use client";

// 0.5.91 — Global Zenith Engine strip for the /dashboard/providers list.
//
// Shows: strategy · active-connections · best score · worst score · [Details]
// [Details] opens a leaderboard modal — every active connection sorted by
// finalScore with the full breakdown for each.

import { useState, useEffect, useCallback } from "react";
import { Modal, Button } from "@/shared/components";

export default function ZenithStrip() {
  const [state, setState] = useState({ status: "idle" });
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/providers/zenith", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setState({ status: "ok", count: data.count, leaderboard: data.leaderboard, winner: data.winner });
      } else {
        setState({ status: "error", error: data.error });
      }
    } catch {
      setState({ status: "error", error: "network" });
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (state.status !== "ok" || !state.leaderboard?.length) return null;
  const best = state.leaderboard[0];
  const worst = state.leaderboard[state.leaderboard.length - 1];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-gradient-to-r from-primary/[0.06] via-primary/[0.02] to-transparent px-4 py-2.5 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-primary">
          <span className="material-symbols-outlined text-base">bolt</span>
          Zenith
        </span>
        <span className="text-text-muted">·</span>
        <span className="text-text-main">{state.count} active</span>
        <span className="text-text-muted">·</span>
        <span className="text-text-main">
          best <span className="font-mono text-green-600 dark:text-green-400">{best.finalScore}</span> ({best.name})
        </span>
        {state.count > 1 && (
          <>
            <span className="text-text-muted">·</span>
            <span className="text-text-main">
              worst <span className={`font-mono ${worst.finalScore < 400 ? "text-red-500" : "text-amber-500"}`}>{worst.finalScore}</span> ({worst.name})
            </span>
          </>
        )}
        <div className="ml-auto">
          <Button size="sm" variant="ghost" onClick={() => setModalOpen(true)}>
            Leaderboard
          </Button>
        </div>
      </div>

      <Modal isOpen={modalOpen} title="Zenith Leaderboard" onClose={() => setModalOpen(false)}>
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg text-text-muted">
              <tr className="text-left text-xs">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Connection</th>
                <th className="py-2 pr-2 text-right">Health</th>
                <th className="py-2 pr-2 text-right">Quota</th>
                <th className="py-2 pr-2 text-right">Priority</th>
                <th className="py-2 pl-2 text-right">Zenith</th>
              </tr>
            </thead>
            <tbody>
              {state.leaderboard.map((e) => (
                <tr key={e.connectionId} className="border-t border-border/50">
                  <td className="py-1.5 pr-2 text-text-muted">{e.rank}</td>
                  <td className="py-1.5 pr-2">
                    <div className="font-medium">{e.name}</div>
                    <div className="text-[10px] text-text-muted">{e.provider}</div>
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-xs">{e.healthScore}</td>
                  <td className="py-1.5 pr-2 text-right font-mono text-xs">
                    ×{e.quotaFactor}
                    {e.quotaRemainingPct != null && (
                      <span className="ml-1 text-text-muted">({e.quotaRemainingPct}%)</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-xs">+{e.priorityBonus}</td>
                  <td className="py-1.5 pl-2 text-right">
                    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
                      e.finalScore >= 750
                        ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
                        : e.finalScore >= 400
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                          : "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30"
                    }`}>
                      {e.finalScore}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </>
  );
}
