"use client";

// The dashboard's icon set, drawn rather than fetched.
//
// The nav ran on `material-symbols/outlined.css`, a ligature font: the markup
// said `<span class="material-symbols-outlined">settings</span>` and the font
// turned the word into a glyph. Three costs came with that. The literal word
// is in the DOM until the font loads, which is why globals.css carries an
// `opacity: 0` rule on the class to hide the flash. The glyphs are a webfont
// download before any of the nav can draw. And a typo in an icon name renders
// as plain text rather than failing.
//
// Every path here is on a 24x24 grid with a 1.6 stroke, no fill, round caps
// and joins, so the whole set reads as one hand at any size. `currentColor`
// means an icon picks up the active-state colour from its parent with no
// per-state wiring.
//
// Keys are the Material Symbols names they replace, so a call site migrates by
// swapping the element and keeping its string — and a name that is not here
// still renders, see Icon.js.
export const ICON_PATHS = Object.freeze({
  // ——— nav: route ———
  // Endpoint: a request entering, splitting, and leaving to one target.
  api: '<path d="M3 7h5l3 5-3 5H3"/><circle cx="19" cy="12" r="2.4"/><path d="M11 12h5.6"/>',
  // Providers: stacked racks.
  dns: '<rect x="3" y="4" width="18" height="5.6" rx="1.6"/><rect x="3" y="14.4" width="18" height="5.6" rx="1.6"/><path d="M6.6 6.8h.01M6.6 17.2h.01"/>',
  // Combos: sheets offset in depth.
  layers: '<path d="M12 3 3 7.5l9 4.5 9-4.5z"/><path d="m3 12.5 9 4.5 9-4.5"/>',
  // Models: a chip.
  memory: '<rect x="7" y="7" width="10" height="10" rx="1.6"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',

  // ——— nav: observe ———
  bar_chart: '<path d="M3.5 20.2h17"/><rect x="5" y="12.5" width="3.4" height="7.7" rx="1"/><rect x="10.3" y="6.8" width="3.4" height="13.4" rx="1"/><rect x="15.6" y="9.8" width="3.4" height="10.4" rx="1"/>',
  data_usage: '<path d="M12 3.2a8.8 8.8 0 1 0 8.8 8.8"/><path d="M12 12V3.2"/>',
  savings: '<path d="M14 6.5a6 6 0 0 1 5.6 5h1.2v3.4h-1.9a6 6 0 0 1-2.1 2.4v2.2h-2.6v-1.3a6.3 6.3 0 0 1-2.4 0v1.3H9.2v-2.2A6 6 0 0 1 6.5 13H5a2 2 0 0 1 0-4"/><path d="m11 6.6-2.2-2v4"/><path d="M19.6 11.5h.01"/>',

  // ——— nav: capture ———
  // Capture/MITM: a shield that has checked something.
  security: '<path d="M12 3.2 19 6v5.4c0 4.3-2.9 7.6-7 9.4-4.1-1.8-7-5.1-7-9.4V6z"/><path d="m9.3 12 1.9 1.9 3.6-3.7"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m7.5 10 2.4 2.2-2.4 2.2M12.6 14.6h4"/>',
  // Console log: a panel of lines. Distinct from `terminal` on purpose — both
  // sit in the nav and two prompts would be unreadable next to each other.
  logs: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M6.8 8.6h10.4M6.8 12h10.4M6.8 15.4h6.4"/>',
  // Panel + sidebar, as a collapse affordance.
  side_navigation: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9.4 4.5v15"/>',
  bolt: '<path d="M13.4 2.8 5.2 13.4h5.6l-.6 7.8 8.2-10.6h-5.6z"/>',
  south_east: '<path d="M7 7l10 10M17 10.4V17H10.4"/>',
  // Certificates: a sealed document.
  workspace_premium: '<circle cx="12" cy="9.5" r="5.3"/><path d="m9 14.2-1.2 6 4.2-2.3 4.2 2.3-1.2-6"/>',

  // ——— nav: system ———
  admin_panel_settings: '<path d="M11 3.4 17 5.6v4.3c0 3.4-2.4 6.1-6 7.6-3.6-1.5-6-4.2-6-7.6V5.6z"/><circle cx="17.5" cy="16.5" r="2.2"/><path d="M17.5 12.8v1.3M17.5 18.9v1.3M14.6 14.8l1.1.6M19.3 17.6l1.1.6M20.4 14.8l-1.1.6M15.7 17.6l-1.1.6"/>',
  lan: '<rect x="9" y="3" width="6" height="5" rx="1.4"/><rect x="2.5" y="16" width="6" height="5" rx="1.4"/><rect x="15.5" y="16" width="6" height="5" rx="1.4"/><path d="M12 8v4M5.5 16v-2.5h13V16"/>',
  extension: '<path d="M9.4 4.5a1.9 1.9 0 0 1 3.8 0V6h3.3a1.5 1.5 0 0 1 1.5 1.5v2.9h-1.4a1.9 1.9 0 0 0 0 3.8H18v2.9a1.5 1.5 0 0 1-1.5 1.5h-3.3v-1.4a1.9 1.9 0 0 0-3.8 0V19H6.1a1.5 1.5 0 0 1-1.5-1.5v-3.3H6a1.9 1.9 0 0 0 0-3.8H4.6V7.5A1.5 1.5 0 0 1 6.1 6h3.3z"/>',
  tune: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  translate: '<path d="M3.5 6h7M7 4.2V6c0 3.4-1.6 6.2-3.5 7.6"/><path d="M5 9.4c.9 2.3 2.6 3.7 4.6 4.2"/><path d="m12.4 20 3.8-9.4L20 20"/><path d="M13.7 16.8h5"/>',
  // Gear drawn as eight spokes on a ring rather than a toothed outline: at 18px
  // a true gear silhouette turns to mush, and the ring keeps the 1.6 stroke.
  settings: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.6"/><path d="M12 2.2v2.2M12 19.6v2.2M2.2 12h2.2M19.6 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6"/>',

  // ——— media kinds ———
  perm_media: '<rect x="3" y="7" width="14" height="11" rx="2"/><path d="m6.5 15 2.6-3 2 2.2 1.8-2.2 2.6 3z"/><path d="M7 4.5h12.5A1.5 1.5 0 0 1 21 6v9"/>',
  data_array: '<path d="M8 4.5H5.5v15H8M16 4.5h2.5v15H16"/>',
  brush: '<path d="M13.5 4.7 19.3 10.5a1.4 1.4 0 0 1 0 2L12 19.8H7.2L4.8 17.4z"/><path d="m10 8.2 5.8 5.8"/>',
  image_search: '<rect x="3" y="4.5" width="13" height="13" rx="2"/><path d="m5.8 14.6 2.9-3.3 2.2 2.4 1.9-2.2 2.2 2.4"/><circle cx="18" cy="17" r="3"/><path d="m20.2 19.2 1.8 1.8"/>',
  record_voice_over: '<circle cx="9.5" cy="8" r="3.4"/><path d="M3.5 20a6 6 0 0 1 12 0"/><path d="M17.8 7.2a6 6 0 0 1 0 6M20.4 5a9.4 9.4 0 0 1 0 10.4"/>',
  mic: '<rect x="9" y="3" width="6" height="10.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3M9 21h6"/>',
  travel_explore: '<circle cx="11" cy="11" r="7.6"/><path d="M3.6 8.6h14.8M3.6 13.4h10.4"/><path d="M11 3.4c-2.4 2.3-2.4 13 0 15.2 2.4-2.2 2.4-12.9 0-15.2z"/><path d="m18 18 3 3"/>',
  language: '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 9.4h17.2M3.4 14.6h17.2"/><path d="M12 3.4c-2.6 2.5-2.6 14.7 0 17.2 2.6-2.5 2.6-14.7 0-17.2z"/>',
  movie: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9.5h18"/><path d="m7.5 5-1.4 4.5M13 5l-1.4 4.5M18.5 5l-1.4 4.5"/>',
  music_note: '<circle cx="7" cy="17.5" r="2.8"/><path d="M9.8 17.5V5.2l8.4-1.6v9.2"/><circle cx="15.4" cy="12.8" r="2.8"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m6.2 16.4 3.6-4.2 2.8 3 2.4-2.8 2.8 4z"/><circle cx="8.4" cy="9" r="1.4"/>',

  // ——— chrome ———
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  person: '<circle cx="12" cy="8" r="3.8"/><path d="M4.6 20a7.4 7.4 0 0 1 14.8 0"/>',
  expand_more: '<path d="m6 9.5 6 5.5 6-5.5"/>',
  chevron_right: '<path d="m9.5 5.5 6 6.5-6 6.5"/>',
  search: '<circle cx="11" cy="11" r="6.8"/><path d="m15.9 15.9 4.1 4.1"/>',
  vpn_key: '<circle cx="7.2" cy="12" r="3.8"/><path d="M11 12h9.4"/><path d="M17.4 12v3.2M20.4 12v2.4"/>',
  monitor: '<rect x="2.6" y="4.5" width="18.8" height="12.4" rx="2"/><path d="M8.6 20.5h6.8M12 16.9v3.6"/>',
  content_copy: '<rect x="8.5" y="3.5" width="12" height="12" rx="2"/><path d="M15.5 18.5v.5a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2H6"/>',
  check_circle: '<circle cx="12" cy="12" r="8.8"/><path d="m8.2 12.2 2.6 2.6 5-5.2"/>',
  error: '<circle cx="12" cy="12" r="8.8"/><path d="M12 7.8v5M12 16.2h.01"/>',
  warning: '<path d="M10.8 4.3a1.4 1.4 0 0 1 2.4 0l7.5 13.4a1.4 1.4 0 0 1-1.2 2.1H4.5a1.4 1.4 0 0 1-1.2-2.1z"/><path d="M12 9.5v4.2M12 16.8h.01"/>',
  info: '<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.2M12 7.8h.01"/>',
  power_off: '<path d="M7.6 6.4a7 7 0 1 0 8.8 0"/><path d="M12 2.8v7.4"/><path d="m4 4 16 16"/>',
  chat: '<path d="M20.5 12.5a7.5 7.5 0 0 1-10.9 6.7L4.5 20.5l1.3-5.1A7.5 7.5 0 1 1 20.5 12.5z"/>',
});

export const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS));
