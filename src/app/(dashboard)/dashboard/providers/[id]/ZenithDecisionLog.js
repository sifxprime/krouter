"use client";

// 0.5.91 — Zenith routing decision log panel.
//
// Collapsible view of the last N routing decisions for this provider.
// Ring buffer lives in-memory on the server (open-sse/services/routingLog.js),
// so entries are ephemeral and reset on process restart.

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";

function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function ZenithDecisionLog({ providerId }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!providerId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/providers/zenith/log?providerId=${providerId}&limit=50`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) setEntries(data.entries || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [providerId]);

  useEffect(() => {
    if (!open) return;
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [open, load]);

  return (
    <div className="mt-4 rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs text-text-muted hover:text-text-main"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="material-symbols-outlined text-sm">history</span>
          Routing decisions
          {entries.length > 0 && <span className="text-text-muted">({entries.length})</span>}
        </span>
        <span className="material-symbols-outlined text-sm">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto border-t border-border/50 px-3 py-2">
          {loading && entries.length === 0 && (
            <p className="text-xs text-text-muted">Loading…</p>
          )}
          {!loading && entries.length === 0 && (
            <p className="text-xs text-text-muted">
              No decisions recorded yet. Fire a request through kRouter to populate.
            </p>
          )}
          <ul className="space-y-1">
            {entries.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex flex-wrap items-center gap-2 border-b border-border/30 py-1 text-[11px] font-mono last:border-0">
                <span className="text-text-muted">{timeAgo(e.at)}</span>
                {e.model && <span className="text-text-main">{e.model}</span>}
                <span className="text-text-muted">→</span>
                <span className="text-text-main">{e.connectionId.slice(0, 8)}</span>
                {e.score != null && (
                  <span className="text-primary">Z:{e.score}</span>
                )}
                {e.latencyMs != null && (
                  <span className="text-text-muted">{e.latencyMs}ms</span>
                )}
                <span className={e.success ? "text-green-500" : "text-red-500"}>
                  {e.success ? "✓" : "✗"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

ZenithDecisionLog.propTypes = {
  providerId: PropTypes.string.isRequired,
};
