"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";
import { SUPPORT_CHANNELS } from "@/shared/constants/support";

/**
 * Brand marks are inline SVG rather than the Material Symbols font used by the nav:
 * the icon font has no WhatsApp glyph, and a recognisable brand mark is the whole
 * point of the affordance. `currentColor` keeps them on the same theme tokens as
 * everything around them.
 *
 * The WhatsApp viewBox is padded 0.69 units a side: the official path is drawn
 * edge-to-edge, so at an equal box size it out-measures the envelope and reads as
 * the bigger mark. The padding insets it to the same 94.1% the envelope occupies,
 * matching the two ink widths without touching either path.
 */
function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="-0.69 -0.69 25.38 25.38" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
WhatsAppIcon.propTypes = { className: PropTypes.string };

// Filled and drawn large on purpose: a wide envelope at nominal size reads as
// the smaller mark beside a circular one. Sized so its ink height is ~75% of the
// WhatsApp circle's, which is where the two balance optically. Same 24 viewBox as the WhatsApp mark.
// A stroked outline beside a solid glyph reads as the smaller of the two even at an
// identical box size, which is what made the pair look mismatched.
function MailIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M0.7 6.1V6A2.8 2.8 0 0 1 3.5 3.2h17a2.8 2.8 0 0 1 2.8 2.8v.14l-11.3 6.68L0.7 6.1Z" />
      <path d="M23.3 8.9v9.13a2.8 2.8 0 0 1-2.8 2.8H3.5a2.8 2.8 0 0 1-2.8-2.8V8.9l10.6 6.25c.45.26.99.26 1.44 0L23.3 8.9Z" />
    </svg>
  );
}
MailIcon.propTypes = { className: PropTypes.string };

function LifeRingIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="m5.6 5.6 3.85 3.85M14.55 14.55l3.85 3.85M18.4 5.6l-3.85 3.85M9.45 14.55 5.6 18.4" />
    </svg>
  );
}
LifeRingIcon.propTypes = { className: PropTypes.string };

const ICONS = { whatsapp: WhatsAppIcon, mail: MailIcon };

/**
 * Support affordance: one control that opens two ways to reach a human.
 *
 * Collapsed by default so it never competes with navigation; both channels open in
 * a new tab (mailto hands off to the mail client) so nobody loses an in-flight
 * dashboard state by navigating away.
 */
export default function SupportMenu({ className }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  // Close on outside click and on Escape. Escape returns focus to the trigger so
  // keyboard users are not dropped at the top of the document.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {/* Opens upward: the control is pinned to the bottom of the sidebar. */}
      <div
        id="support-channels"
        role="group"
        aria-label="Support channels"
        className={cn(
          "grid transition-all duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100 mb-1" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 pb-1">
            {SUPPORT_CHANNELS.map((channel) => {
              const Icon = ICONS[channel.icon];
              return (
                <a
                  key={channel.id}
                  href={channel.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  // Not focusable while collapsed, or Tab lands on invisible links.
                  tabIndex={open ? 0 : -1}
                  aria-hidden={!open}
                  className={cn(
                    // w-full + box-border: both cards size from the rail, never
                    // from their own text, so the longer address cannot widen one.
                    "flex w-full box-border items-center gap-3 px-3 py-2 rounded-lg group",
                    "text-text-muted hover:bg-surface-2 hover:text-text-main",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                    "transition-colors"
                  )}
                >
                  <span
                    className="flex items-center justify-center size-7 rounded-md shrink-0 transition-colors"
                    style={
                      channel.tint
                        // A wash of the channel's own colour. Alpha over whatever is
                        // behind it, so one value works in both themes.
                        ? { color: channel.tint, backgroundColor: `${channel.tint}1a` }
                        : undefined
                    }
                  >
                    {Icon ? <Icon className="size-4" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-tight truncate">{channel.label}</span>
                    <span className="block text-[11px] text-text-muted truncate">{channel.detail}</span>
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      </div>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="support-channels"
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg group transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
          open
            ? "bg-primary/10 text-primary"
            : "text-text-muted hover:bg-surface-2 hover:text-text-main"
        )}
      >
        <LifeRingIcon
          className={cn(
            "size-[18px] shrink-0 transition-colors",
            open ? "" : "group-hover:text-primary"
          )}
        />
        <span className="text-[13px] font-medium">Support</span>
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className={cn(
            "size-3.5 ml-auto shrink-0 transition-transform duration-200",
            open ? "rotate-180" : ""
          )}
        >
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
    </div>
  );
}

SupportMenu.propTypes = {
  className: PropTypes.string,
};
