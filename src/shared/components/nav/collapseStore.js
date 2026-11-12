"use client";

// Whether the sidebar is collapsed to a rail.
//
// An external store rather than useState + useEffect because the value lives in
// localStorage, which does not exist during server rendering: reading it in an
// effect means a render with the wrong width first, and reading it during
// render means a hydration mismatch. useSyncExternalStore is built for exactly
// this — a server snapshot of "expanded" and a client snapshot of the truth.
//
// It also means two sidebars (the desktop one and the mobile drawer) never
// disagree, since both read the same store.

const KEY = "krouter.sidebar.collapsed";
const listeners = new Set();

// Cached so getSnapshot returns a stable value. Returning a fresh read every
// call is fine for a boolean, but caching also means a blocked localStorage is
// only hit once.
let cached = null;

/** localStorage throws outright in a private window and in some webviews. */
function readStorage() {
  try {
    return globalThis.localStorage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  // Another tab collapsing its sidebar should move this one too.
  const onStorage = (e) => {
    if (e && e.key !== null && e.key !== KEY) return;
    cached = readStorage();
    for (const l of listeners) l();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}

export function getSnapshot() {
  if (cached === null) cached = readStorage();
  return cached;
}

/** The server has no localStorage, so it always renders the full sidebar. */
export function getServerSnapshot() {
  return false;
}

export function setCollapsed(next) {
  cached = Boolean(next);
  try { globalThis.localStorage?.setItem(KEY, cached ? "1" : "0"); } catch { /* private window */ }
  for (const l of listeners) l();
}

export const COLLAPSE_KEY = KEY;

/** Test seam: drop the cache so a fresh read happens. */
export function _resetCache() {
  cached = null;
}
