// The dashboard's navigation, grouped by what you came to do.
//
// It was one flat list of ten links plus a "System" heap, which put "configure
// routing" and "watch traffic" at the same level — so finding Usage meant
// reading past MITM and Token Saver. The groups below are the three jobs this
// app actually does, and Endpoint leads because /dashboard already renders the
// endpoint page: the nav now shows that rather than making it look like one
// tab among nine.
//
// `icon` names match src/shared/components/icons/paths.js.

export const NAV_SECTIONS = Object.freeze([
  {
    id: "route",
    label: "Route",
    items: [
      { href: "/dashboard/endpoint", label: "Endpoint", icon: "api" },
      {
      href: "/dashboard/providers",
      label: "Providers",
      icon: "dns",
      // Named, not computed here: this module is plain data, read by tests and
      // by anything that wants the nav without pulling the provider registry
      // in behind it. The Sidebar resolves the number.
      countKey: "providers",
    },
      { href: "/dashboard/combos", label: "Combos", icon: "layers" },
      // An accordion, so it has no href of its own; its children are built from
      // MEDIA_PROVIDER_KINDS at render time. basePath records where it leads,
      // so the nav-coverage guard can still see that the section is reachable.
      { id: "media", label: "Media Providers", icon: "perm_media", accordion: true, basePath: "/dashboard/media-providers" },
      // Last in Route because it is how you check the route you just set up
      // actually answers. It had no nav entry at all until 0.5.193 — the page
      // shipped in the initial release and was reachable only by typing the
      // URL, which is the exact failure sidebar-nav-coverage.test.js exists to
      // catch; it was passing only because of a stale exemption.
      { href: "/dashboard/basic-chat", label: "Chat", icon: "chat" },
    ],
  },
  {
    id: "observe",
    label: "Observe",
    items: [
      { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
      { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
      { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
      { href: "/dashboard/console-log", label: "Console Log", icon: "logs" },
    ],
  },
  {
    id: "capture",
    label: "Capture",
    items: [
      // The only item whose live state is worth showing in the nav itself.
      { href: "/dashboard/mitm", label: "MITM", icon: "security", showsCaptureState: true },
      { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      { href: "/dashboard/pxpipe", label: "PXPIPE", icon: "image" },
      { href: "/dashboard/presidio", label: "Presidio", icon: "admin_panel_settings" },
      { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
      { href: "/dashboard/skills", label: "Skills", icon: "extension" },
      { href: "/dashboard/environment", label: "Environment", icon: "tune" },
      // Hidden unless the translator is switched on in settings — same rule the
      // flat list had, carried over rather than dropped in the regroup.
      { href: "/dashboard/translator", label: "Translator", icon: "translate", requires: "enableTranslator" },
      { href: "/dashboard/profile", label: "Settings", icon: "settings" },
    ],
  },
]);

/** Every href the nav can link to — used by the route-coverage test. */
export const NAV_HREFS = Object.freeze(
  NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href).filter(Boolean)),
);

/**
 * Is this nav item the current page?
 *
 * /dashboard renders the endpoint page, so it has to light up Endpoint — a
 * plain startsWith would leave nothing highlighted on the page you land on.
 */
export function isNavItemActive(href, pathname) {
  if (!href || !pathname) return false;
  if (href === "/dashboard/endpoint") {
    return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
  }
  return pathname.startsWith(href);
}
