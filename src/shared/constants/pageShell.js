/**
 * The dashboard's content track, defined once.
 *
 * The header bar and the scrolling content area are siblings in
 * DashboardLayout, and each used to carry its own gutter and width: the header
 * `px-4 lg:px-8` full-bleed, the content `p-6 lg:p-10` capped at `max-w-7xl`.
 * At 1440px that put the header's title block at x=284 and the content at
 * x=292 — a visible 8px step under every page title in the app.
 *
 * Pages then set widths of their own on top of that, and the step became a
 * gulf. Measured at 1440x900 before this module existed:
 *
 *   width  left   offset  pages
 *   1102   292      8px   dashboard, providers, usage, combos, endpoint, ...
 *   1024   334     50px   cli-tools, proxy-pools        (max-w-5xl)
 *    896   395    111px   skills, presidio              (max-w-4xl)
 *    768   462    178px   token-saver                   (max-w-3xl)
 *    672   507    223px   profile, providers/new        (max-w-2xl)
 *
 * On Settings the heading sat 223px to the left of the form it labelled, with
 * roughly 430px of empty grid either side. Six widths for one shell.
 *
 * So the gutter and the width live here, both components read them, and the
 * width is chosen BY ROUTE rather than by the page component. That last part is
 * deliberate: the header renders as a sibling *above* `children`, so a width a
 * page component declared during its own render could not reach the header
 * without a context provider sitting above both — and the header already
 * derives everything else it shows from the pathname. Keying off the route
 * keeps one source of truth and no render-order coupling.
 *
 * Two widths, not six. A page that wants `narrow` gets a narrow header too, so
 * a settings form and its title share an edge instead of drifting apart.
 */

/**
 * Horizontal gutter, defined in globals.css so one value drives both halves.
 *
 * The header's variant additionally reserves the content area's 6px scrollbar.
 * Equal padding alone is NOT enough: the content area is a scroll container
 * whose styled scrollbar takes real layout width, so its usable box is 6px
 * narrower and a centred narrow track lands 3px to the left. Measured 459
 * against 462 on /dashboard/profile at 1440px before this split existed.
 */
export const SHELL_GUTTER_X = "shell-gutter-x";
export const SHELL_GUTTER_X_HEADER = "shell-gutter-x-header";

/** Vertical padding for the content area. The header sets its own, tighter. */
export const SHELL_PAD_Y = "py-6 lg:py-10";

/**
 * The content area's scroll behaviour: reserves the scrollbar gutter whether or
 * not the bar is showing, so the track does not jump 3px when a page grows past
 * one screen.
 */
export const SHELL_SCROLL = "shell-scroll custom-scrollbar";

/**
 * The DOM id of the header bar's page-actions slot.
 *
 * Lives here rather than in HeaderActions.js because that file contains JSX,
 * and a plain `.js` importer (the unit tests) cannot parse it.
 */
export const HEADER_ACTIONS_SLOT_ID = "krouter-header-actions";

export const SHELL_WIDTH = {
  /** The default: tables, card grids, dashboards. */
  wide: "max-w-7xl",
  /** Single-column forms and settings, where a 1100px field is unusable. */
  narrow: "max-w-3xl",
};

/**
 * Routes that render a single-column form or settings panel.
 *
 * Matched exactly, so `/dashboard/providers/new` can be narrow while
 * `/dashboard/providers/[id]` stays wide.
 */
export const NARROW_ROUTES = Object.freeze([
  "/dashboard/profile",
  "/dashboard/providers/new",
  "/dashboard/token-saver",
  "/dashboard/presidio",
]);

/**
 * Routes that own their whole viewport and scroll internally, so the shell must
 * not add padding, a width cap, or an outer scrollbar.
 */
export const FULL_BLEED_ROUTES = Object.freeze(["/dashboard/basic-chat"]);

/** @param {string} pathname */
export function isFullBleed(pathname) {
  return FULL_BLEED_ROUTES.includes(pathname);
}

/**
 * The width class for a route: one of SHELL_WIDTH's values.
 * @param {string} pathname
 */
export function shellWidthFor(pathname) {
  return NARROW_ROUTES.includes(pathname) ? SHELL_WIDTH.narrow : SHELL_WIDTH.wide;
}

/**
 * The full class list for the element that holds a route's content, so the
 * header and the content area cannot drift.
 * @param {string} pathname
 */
export function shellTrackClass(pathname) {
  return `mx-auto w-full ${shellWidthFor(pathname)}`;
}
