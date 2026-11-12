"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { cn } from "@/shared/utils/cn";
import Button from "./Button";
import Icon from "./icons/Icon";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  full: "max-w-4xl",
};

/**
 * The element that had focus before any dialog opened.
 *
 * A dialog cannot work this out for itself. React commits the panel's DOM —
 * applying `autoFocus` on whatever field is inside it — before any of the
 * dialog's own effects run, so by the time an effect looks at
 * `document.activeElement` the answer is already a control inside the dialog,
 * and the opener is gone. Tracking it from a document-level listener catches
 * it while it is still true.
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

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * A dialog.
 *
 * It used to open as a plain `<div>` with macOS traffic lights along the top —
 * one real close button and two grey circles with `cursor-not-allowed`, which
 * is window chrome drawn on something that is not a window, and two controls
 * drawn on things that do nothing. The real problems were underneath: no
 * `role="dialog"`, so a screen reader announced the content as part of the page
 * it was covering; focus never moved into it, so the first Tab went to the
 * element behind the overlay; and nothing brought focus back when it closed.
 *
 * Now it announces itself, takes focus on open, keeps Tab inside while it is
 * up, and hands focus back to whatever opened it.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnOverlay = true,
  className,
}) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const titleId = useId();
  const descId = useId();

  // Captured here, during the render that opens the dialog, because this is the
  // last moment the opener still holds focus: React applies `autoFocus` while
  // committing the panel, so any effect — layout or passive — already finds a
  // control inside the dialog instead. The tracker above is preferred when it
  // has something, since it is right even if the opener was never focusable.
  const wasOpen = useRef(false);
  if (isOpen && !wasOpen.current) {
    wasOpen.current = true;
    if (typeof document !== "undefined") {
      const active = document.activeElement;
      const fallback =
        active && active !== document.body && active !== document.documentElement ? active : null;
      restoreRef.current =
        lastFocusOutsideDialog?.isConnected ? lastFocusOutsideDialog : fallback;
    }
  } else if (!isOpen && wasOpen.current) {
    wasOpen.current = false;
  }

  const focusables = useCallback(
    () => (panelRef.current ? [...panelRef.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null) : []),
    []
  );

  // Lock the page behind the dialog, and give focus to the dialog itself
  // rather than its first control: landing on "Delete" is a trap, and the
  // panel is labelled, so a screen reader reads the title on arrival.
  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      // By the time this runs the panel is already unmounted, so the focused
      // node is gone and the browser has dropped focus to the root. Which root
      // varies: Chrome leaves it on <body> here but <html> in other paths, and
      // checking only for <body> meant the restore silently did nothing.
      // Anything else means a caller moved focus deliberately — leave it.
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={closeOnOverlay ? onClose : undefined}
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-[2px] fade-in",
          closeOnOverlay ? "cursor-default" : "cursor-default pointer-events-none"
        )}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative w-full flex flex-col max-h-[88vh] outline-none",
          "bg-surface border border-border-subtle",
          "rounded-[16px] shadow-[var(--shadow-elev)]",
          "fade-in",
          SIZES[size],
          className
        )}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border-subtle">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[17px] font-semibold text-text-main tracking-[-0.01em]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 text-[13px] leading-5 text-text-muted">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1.5 -mt-0.5 shrink-0 rounded-[10px] p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-border-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  loading = false,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-[14px] leading-6 text-text-muted">{message}</p>
    </Modal>
  );
}
