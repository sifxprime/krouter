"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { HEADER_ACTIONS_SLOT_ID } from "@/shared/constants/pageShell";
import {
  getHeaderActionsSlot,
  getHeaderActionsSlotServer,
  subscribeHeaderActionsSlot,
} from "@/shared/components/headerActionsSlot";

/**
 * Put a page's primary action in the header bar.
 *
 * The bar had no slot for one, so a page that needed a button rebuilt the whole
 * title row beneath it — title, description and all. That put two titles on
 * screen, and on several routes they disagreed:
 *
 *   /dashboard/providers/new   bar: "Providers"   page: "Add New Provider"
 *   /dashboard/presidio        bar: "Presidio"    page: "Settings"
 *   /dashboard/combos          bar: "Combos"      page: "Combos"
 *   /dashboard/proxy-pools     bar: "Proxy Pools" page: "Proxy Pools"
 *
 * A portal rather than a store, because the actions carry their own state and
 * handlers. Keeping a React element in a store would snapshot it: the handlers
 * would close over whatever the page's state was when it was stored, and go
 * stale on the next render. A portal leaves the children in the page's own
 * render pass, where they belong — only their DOM position moves.
 *
 * Mirrors headerSearchStore, which solved the same problem for the providers
 * search box, except that one only has to move primitives.
 *
 * ## Only on wide viewports
 *
 * The bar has no room for them on a phone. Measured at 390px with proxy-pools'
 * three actions moved up: the header's content was 666px inside a 390px box,
 * which pushed the page title and the theme, language and menu controls off
 * the right edge entirely. So below `lg` the children render in place instead —
 * at the top of the page, which is where <HeaderActions> sits in every caller.
 */
// Re-exported so callers can reach it from either module; it is defined in
// pageShell.js because this file has JSX and plain-.js importers cannot parse it.
export { HEADER_ACTIONS_SLOT_ID };

/** The `lg` breakpoint, where the header gains the room for page actions. */
const DESKTOP = "(min-width: 1024px)";

const subscribe = (onChange) => {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

function useIsDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    // The server has no viewport. Returning false means the first paint always
    // renders in place, so the markup matches and React never reports a
    // hydration mismatch; on a wide screen it moves to the bar immediately
    // after.
    () => false
  );
}

export default function HeaderActions({ children }) {
  const isDesktop = useIsDesktop();
  // The header publishes its slot node through a callback ref after commit —
  // see headerActionsSlot.js for why this is not a lookup in an effect.
  const slot = useSyncExternalStore(
    subscribeHeaderActionsSlot,
    getHeaderActionsSlot,
    getHeaderActionsSlotServer
  );

  if (!isDesktop) {
    return <div className="flex flex-wrap items-center gap-2 lg:hidden [&>*]:shrink-0">{children}</div>;
  }
  if (!slot) return null;
  return createPortal(children, slot);
}

HeaderActions.propTypes = {
  children: PropTypes.node,
};
