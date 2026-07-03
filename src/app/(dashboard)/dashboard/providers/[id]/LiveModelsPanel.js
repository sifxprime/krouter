"use client";

// 0.5.87 — Live model catalog freshness pill for the Available Models card.
//
// Given a list of connections for a provider, this component:
//   1. Picks the first active connection with credentials
//   2. Fetches the live catalog via /api/models/live-by-connection
//   3. Shows a status pill: "Live · 87 models · Updated 2s ago · Refresh"
//   4. Emits live model IDs upward via onLiveModels() so the parent can
//      merge them into the visible model list
//
// If no connection exists OR the provider has no live fetcher, this
// component renders nothing — the parent's static catalog stays as-is.

import { useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";

function timeAgo(fetchedAtMs) {
  if (!fetchedAtMs) return "";
  const s = Math.floor((Date.now() - fetchedAtMs) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export default function LiveModelsPanel({ connections, onLiveModels }) {
  const [state, setState] = useState({ status: "idle" });
  const timerRef = useRef(null);

  // 0.5.88 — Don't check apiKey/accessToken on the client — the /api/providers
  // response redacts them. Any active connection is fine; the server endpoint
  // reads the real credential from the DB.
  const activeConn = (connections || []).find((c) => c.isActive !== false);
  const connectionId = activeConn?.id;

  const doFetch = useCallback(async (force = false) => {
    if (!connectionId) return;
    setState((s) => ({ ...s, status: "loading" }));
    try {
      const res = await fetch(
        `/api/models/live-by-connection?connectionId=${connectionId}${force ? "&force=1" : ""}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (data.success) {
        setState({
          status: "ok",
          count: data.count,
          fetchedAtMs: data.fetchedAtMs || Date.now(),
          cached: !!data.cached,
        });
        if (onLiveModels) onLiveModels(data.models || []);
      } else if (data.code === "no_fetcher") {
        setState({ status: "unsupported" });
      } else {
        setState({ status: "error", error: data.error || "Fetch failed" });
      }
    } catch (e) {
      setState({ status: "error", error: e?.message || "Network error" });
    }
  }, [connectionId, onLiveModels]);

  useEffect(() => {
    if (!connectionId) {
      setState({ status: "idle" });
      return;
    }
    doFetch(false);
    // Silent refresh every 5 minutes while user has the page open.
    timerRef.current = setInterval(() => doFetch(false), 5 * 60 * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [connectionId, doFetch]);

  // Nothing to render when there's no connection or provider doesn't support live.
  if (!connectionId || state.status === "idle" || state.status === "unsupported") return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-sidebar/40 px-3 py-1.5 text-xs">
      {state.status === "loading" && (
        <span className="inline-flex items-center gap-1.5 text-text-muted">
          <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
          Fetching live catalog…
        </span>
      )}
      {state.status === "ok" && (
        <>
          <span className="inline-flex items-center gap-1.5 text-green-500 font-medium">
            <span className="material-symbols-outlined text-sm">wifi_tethering</span>
            Live
          </span>
          <span className="text-text-muted">·</span>
          <span className="text-text-main">{state.count} model{state.count === 1 ? "" : "s"}</span>
          <span className="text-text-muted">· Updated {timeAgo(state.fetchedAtMs)}</span>
          {state.cached && <span className="text-text-muted">· cached</span>}
        </>
      )}
      {state.status === "error" && (
        <span className="inline-flex items-center gap-1.5 text-amber-500">
          <span className="material-symbols-outlined text-sm">warning</span>
          Live catalog: {state.error} · showing static list
        </span>
      )}
      <div className="ml-auto">
        <Button size="sm" variant="ghost" icon="refresh" onClick={() => doFetch(true)}>
          Refresh
        </Button>
      </div>
    </div>
  );
}

LiveModelsPanel.propTypes = {
  connections: PropTypes.array,
  onLiveModels: PropTypes.func,
};
