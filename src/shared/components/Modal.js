"use client";

import { useId } from "react";
import { cn } from "@/shared/utils/cn";
import Button from "./Button";
import Icon from "./icons/Icon";
import useDialog from "@/shared/hooks/useDialog";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  full: "max-w-4xl",
};

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
  const descId = useId();
  const { titleId, panelProps } = useDialog({ isOpen, onClose, labelled: Boolean(title) });

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
        {...panelProps}
        aria-describedby={description ? descId : undefined}
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
