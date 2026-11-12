"use client";

import { cn } from "@/shared/utils/cn";
import Icon from "./icons/Icon";
import useDialog from "@/shared/hooks/useDialog";

export default function Drawer({
  isOpen,
  onClose,
  title,
  children,
  width = "md",
  className
}) {
  // A drawer is a dialog that happens to slide rather than sit in the middle:
  // while it is open the page behind it is inert, so it needs the same role,
  // focus trap and restore. It had none of them — Tab ran straight out into
  // the page it was covering.
  const { titleId, panelProps } = useDialog({ isOpen, onClose, labelled: Boolean(title) });

  const widths = {
    sm: "w-[400px]",
    md: "w-[500px]",
    lg: "w-[600px]",
    xl: "w-[800px]",
    full: "w-full",
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] fade-in cursor-pointer"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        {...panelProps}
        className={cn(
          "outline-none",
          "absolute right-0 top-0 h-full bg-surface flex flex-col",
          "shadow-[var(--shadow-elev)]",
          "slide-in-right",
          "border-l border-border-subtle",
          widths[width] || widths.md,
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-3">
            {title && (
              <h2 id={titleId} className="section-title">{title}</h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-[10px] text-text-muted hover:bg-surface-2 hover:text-text-main transition-colors"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}
