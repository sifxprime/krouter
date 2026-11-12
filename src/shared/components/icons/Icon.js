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
 * A name not in the set falls back to the font rather than rendering nothing.
 * That matters: the whole app is migrating file by file, and an icon that
 * silently disappears is far worse than one that still looks like the old set
 * for a release. In development it also warns, so the gap gets closed instead
 * of living behind a fallback forever.
 */
export default function Icon({ name, size = 18, className = "", strokeWidth = 1.6, title }) {
  const d = ICON_PATHS[name];

  if (!d) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[Icon] no drawn icon for "${name}" — falling back to the Material Symbols font`);
    }
    return (
      <span className={`material-symbols-outlined ${className}`} style={{ fontSize: size }} aria-hidden={title ? undefined : "true"}>
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
};
