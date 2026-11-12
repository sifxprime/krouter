"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/shared/components/icons/Icon";

/**
 * Today's traffic, across the top of the landing page.
 *
 * The page's first question is "is anything actually going through this?", and
 * until now nothing on it answered that — the endpoint card shows where to
 * point a client, not whether a client ever arrived. Four numbers settle it
 * without leaving the page, and the strip links through to Usage for the rest.
 *
 * A failed read shows an em dash, never a zero. Zero requests is a claim about
 * the day, and "the request failed" is not that claim; a strip that renders 0
 * during a blip reads as "nothing is working" and sends someone debugging a
 * working router.
 */

const POLL_MS = 30000;

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat();

const TILES = [
  { key: "totalRequests", label: "Requests today", format: (n) => plain.format(n), tone: "" },
  { key: "totalPromptTokens", label: "Tokens in", format: (n) => compact.format(n), tone: "text-primary" },
  { key: "totalCompletionTokens", label: "Tokens out", format: (n) => compact.format(n), tone: "text-success" },
  { key: "totalCost", label: "Est. spend", format: (n) => `~$${n.toFixed(2)}`, tone: "text-warning" },
];

export default function TrafficStrip() {
  const [stats, setStats] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (signal) => {
    try {
      const res = await fetch("/api/usage/stats?period=today", { signal });
      if (!res.ok) throw new Error(`stats ${res.status}`);
      const data = await res.json();
      setStats(data);
      setFailed(false);
    } catch (err) {
      if (err?.name === "AbortError") return;
      // Keep the last good numbers on screen rather than blanking the strip:
      // a stale count is more useful than no count, and `failed` marks it.
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Deferred so the first read does not set state during the effect that
    // schedules it, which `react-hooks/set-state-in-effect` rightly objects to.
    const first = setTimeout(() => load(controller.signal), 0);
    const timer = setInterval(() => load(controller.signal), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      controller.abort();
    };
  }, [load]);

  const unknown = stats == null;

  return (
    <Link
      href="/dashboard/usage"
      aria-label="Today's traffic — open Usage for the full breakdown"
      className="group grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
    >
      {TILES.map(({ key, label, format, tone }) => {
        const value = stats?.[key];
        return (
          <div
            key={key}
            className="min-w-0 rounded-[14px] border border-border-subtle bg-surface px-4 py-3 shadow-[var(--shadow-soft)] transition-colors group-hover:border-brand-500/30"
          >
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[11.5px] text-text-muted">{label}</span>
              {failed && (
                <Icon
                  name="cloud_off"
                  size={12}
                  className="shrink-0 text-text-muted"
                  title="These numbers may be out of date"
                />
              )}
            </div>
            <div
              className={`mt-1 truncate font-display text-2xl font-bold tabular-nums ${tone}`}
              // The strip reads as a unit, so a tile that is still loading keeps
              // its height instead of collapsing and shoving the page upward.
              aria-busy={unknown ? "true" : undefined}
            >
              {unknown || typeof value !== "number" ? "—" : format(value)}
            </div>
          </div>
        );
      })}
    </Link>
  );
}
