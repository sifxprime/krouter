"use client";

import PropTypes from "prop-types";
import { ICON_PATHS } from "./paths";

/**
 * An icon from the drawn set, by the Material Symbols name it replaces.
 *
 * Keeping the old names means a call site migrates by swapping the element and
 * leaving its string alone, and the two systems can coexist while the rest of
 * the app still uses the font.
 *
 * A name not in the set renders as its own text rather than nothing. The font
 * is gone, so there is no glyph to fall back to, and a blank space is the worst
 * outcome available: the button still occupies the layout and still works, but
 * nothing marks it. Printing `power_of` where an icon belongs is ugly on
 * purpose — it is visible in a screenshot, so the gap gets closed.
 */
export default function Icon({ name, size = 18, className = "", strokeWidth = 1.6, title, style }) {
  const d = ICON_PATHS[name];

  if (!d) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[Icon] no drawn icon named "${name}" — add it to paths.js`);
    }
    return (
      <span
        className={className}
        style={{ fontSize: Math.max(8, size * 0.42), fontFamily: "ui-monospace, monospace", lineHeight: 1, ...style }}
        aria-hidden={title ? undefined : "true"}
      >
        {name}
      </span>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      // Callers pass a colour that comes from data (a provider's brand colour, a
      // health threshold) or a one-off animation. Those cannot be Tailwind
      // classes because the value is not known until render.
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative by default: the label beside it in the nav already names the
      // destination, and a second announcement is noise in a screen reader.
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      aria-label={title || undefined}
      // The paths are a frozen literal in paths.js, never anything from a
      // request or from settings. `title` is deliberately NOT interpolated
      // here — it reaches the user through aria-label, which cannot execute,
      // so no caller can turn a label into markup.
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

Icon.propTypes = {
  name: PropTypes.string.isRequired,
  size: PropTypes.number,
  className: PropTypes.string,
  strokeWidth: PropTypes.number,
  title: PropTypes.string,
  style: PropTypes.object,
};
