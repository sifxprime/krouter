"use client";

import { useCallback, useEffect, useState } from "react";

// How often the pill re-checks. Capture is toggled from a page in this same
// app, so the only drift to catch is a change made elsewhere — another tab, the
// tray, or the MITM dying. 8s is cheap against a loopback route and still
// agrees with the capture page before you look back at it.
const POLL_MS = 8000;

/**
 * Live capture state for the chrome, so "is kRouter intercepting right now"
 * is answerable from any page.
 *
 * Capture runs two ways and they cover different tools: the :443 interceptor
 * (`running`) is what Claude Desktop and Kiro need, while the CONNECT proxy
 * (`proxyCapture.running`) is Antigravity's local hop. A single on/off would
 * read "on" with Claude Desktop uncovered — the same gap that made the menu-bar
 * icon lie — so both are reported and named.
 */
export function useCaptureStatus({ pollMs = POLL_MS } = {}) {
  const [status, setStatus] = useState({ loading: true, intercept: false, proxy: false, error: false });

  const read = useCallback(async (signal) => {
    try {
      const res = await fetch("/api/cli-tools/antigravity-mitm", { signal, cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setStatus({
        loading: false,
        error: false,
        intercept: Boolean(data?.running),
        proxy: Boolean(data?.proxyCapture?.running),
      });
    } catch (e) {
      if (e?.name === "AbortError") return;
      // Unknown is not the same as off. Claiming "capture off" because one poll
      // failed would send someone to debug a capture that is working.
      setStatus((prev) => ({ ...prev, loading: false, error: true }));
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    // Deferred rather than called in the effect body: `read` is async so the
    // setState already lands in a later task, but calling it here reads as a
    // synchronous state update and trips react-hooks/set-state-in-effect.
    const first = setTimeout(() => read(ctrl.signal), 0);
    const t = setInterval(() => read(ctrl.signal), pollMs);
    return () => { ctrl.abort(); clearTimeout(first); clearInterval(t); };
  }, [read, pollMs]);

  return status;
}

/** The words for a capture state. Exported so the label has one definition. */
export function describeCapture({ loading, error, intercept, proxy }) {
  if (loading) return { tone: "idle", short: "Capture", long: "Checking capture state" };
  if (error) return { tone: "idle", short: "Capture ?", long: "Capture state unknown — the status check failed" };
  if (intercept && proxy) return { tone: "on", short: "Capturing", long: "Capturing — system-wide and proxy" };
  if (intercept) return { tone: "on", short: "Capturing", long: "Capturing system-wide — Claude Desktop and Kiro route through kRouter" };
  // Named, not just "on": proxy-only covers Antigravity and leaves Claude
  // Desktop untouched, and that difference is the reason to look at this pill.
  if (proxy) return { tone: "partial", short: "Proxy only", long: "Capturing via proxy — Antigravity only, not Claude Desktop or Kiro" };
  return { tone: "off", short: "Not capturing", long: "Not capturing — traffic goes straight to the vendors" };
}
