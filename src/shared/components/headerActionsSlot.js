/**
 * Where the header bar's page-actions slot lives, as an external store.
 *
 * <HeaderActions> has to portal into a node that <Header> renders. Looking that
 * node up with `document.getElementById` inside an effect and holding it in
 * state works, but it is a setState in an effect body — an extra render on
 * every mount, and what `react-hooks/set-state-in-effect` is there to catch.
 *
 * Reading it during render with useSyncExternalStore is worse: on the first
 * render of the tree the header's DOM is not committed yet, so the lookup
 * returns null, and with nothing to subscribe to nothing would ever re-read it.
 * The actions would simply never appear.
 *
 * So the header publishes the node instead. A callback ref fires after commit
 * with the node, and again with null when it unmounts — DashboardLayout keys
 * Header on the pathname, so a route change does both in order and subscribers
 * end up holding the new node rather than the old one.
 *
 * No JSX here on purpose: plain-.js importers (the unit tests) cannot parse the
 * component file.
 */

let slotNode = null;
const listeners = new Set();

/** Callback ref for the header's slot element. React calls it after commit. */
export function setHeaderActionsSlot(node) {
  if (node === slotNode) return;
  slotNode = node;
  for (const listener of listeners) listener();
}

export function subscribeHeaderActionsSlot(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getHeaderActionsSlot() {
  return slotNode;
}

/** The server has no DOM, so there is nothing to portal into. */
export function getHeaderActionsSlotServer() {
  return null;
}
