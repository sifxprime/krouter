"use client";

import { useCallback, useEffect, useId, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * The element that had focus before any dialog opened.
 *
 * A dialog cannot work this out for itself once it is on screen. React commits
 * the panel's DOM — applying `autoFocus` on whatever field is inside it —
 * before any of the dialog's own effects run, so by then
 * `document.activeElement` is already a control inside the dialog and the
 * opener is gone. A document-level listener catches it while it is still true.
 */
let lastFocusOutsideDialog = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (!(el instanceof Element) || el.closest('[role="dialog"]')) return;
      lastFocusOutsideDialog = el;
    },
    true
  );
}

/**
 * Everything that makes an overlay behave like a dialog, for panels that keep
 * their own markup.
 *
 * Several overlays in this app were a plain `<div>` over a backdrop: no
 * `role`, so a screen reader read them as more of the page they covered; focus
 * never entered, so the first Tab went somewhere behind the overlay; Tab then
 * walked straight out; and nothing brought focus back on close. Spreading
 * `panelProps` onto the panel and rendering `titleId` on its heading fixes all
 * four without touching the layout.
 *
 * Prefer the shared `Modal` when the panel does not need its own shape. This
 * exists for the ones that do — a drawer, a panel with custom chrome.
 *
 * @param {{ isOpen: boolean, onClose: () => void, labelled?: boolean }} options
 */
export default function useDialog({ isOpen, onClose, labelled = true }) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const wasOpen = useRef(false);
  const titleId = useId();

  // Captured during the render that opens the dialog — the last moment the
  // opener still holds focus. See the tracker above for why an effect is too
  // late.
  if (isOpen && !wasOpen.current) {
    wasOpen.current = true;
    if (typeof document !== "undefined") {
      const active = document.activeElement;
      const fallback =
        active && active !== document.body && active !== document.documentElement ? active : null;
      restoreRef.current = lastFocusOutsideDialog?.isConnected ? lastFocusOutsideDialog : fallback;
    }
  } else if (!isOpen && wasOpen.current) {
    wasOpen.current = false;
  }

  const focusables = useCallback(
    () =>
      panelRef.current
        ? [...panelRef.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        : [],
    []
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // The panel itself, not its first control: landing on a destructive button
    // is a trap, and the panel is labelled, so the title is read on arrival.
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      // The panel is already unmounted here, so focus has dropped to the root —
      // <body> in some paths, <html> in others. Anything else means a caller
      // moved focus deliberately, so leave it alone.
      const active = document.activeElement;
      const loose = !active || active === document.body || active === document.documentElement;
      if (loose && restoreRef.current?.isConnected) restoreRef.current.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, onClose, focusables]);

  return {
    titleId,
    // Exposed so a panel that also needs the node — click-outside, measuring —
    // uses this one rather than attaching a second ref that competes for it.
    panelRef,
    panelProps: {
      ref: panelRef,
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": labelled ? titleId : undefined,
      tabIndex: -1,
    },
  };
}
