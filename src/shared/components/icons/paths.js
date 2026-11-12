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
  // ---- Added for the page-level migration off the ligature font. ----
  // Same grid and stroke as the set above, so a page mixing old and new
  // entries during the migration does not read as two different icon sets.

  // Direction. The four arrows share one shaft length and one head angle;
  // drawn separately rather than rotated so each stays on the pixel grid.
  arrow_forward: '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
  arrow_back: '<path d="M20 12H5"/><path d="m11 6-6 6 6 6"/>',
  arrow_upward: '<path d="M12 20V5"/><path d="m6 11 6-6 6 6"/>',
  arrow_downward: '<path d="M12 4v15"/><path d="m6 13 6 6 6-6"/>',
  chevron_left: '<path d="m14.5 6-6 6 6 6"/>',
  keyboard_arrow_up: '<path d="m6 14.5 6-6 6 6"/>',
  keyboard_arrow_down: '<path d="m6 9.5 6 6 6-6"/>',

  // A three-quarter arc, not a full ring: with `animate-spin` a closed circle
  // looks motionless, which is the opposite of what a spinner is for.
  progress_activity: '<path d="M12 3.4a8.6 8.6 0 1 0 8.6 8.6"/>',
  refresh: '<path d="M20.2 12a8.2 8.2 0 1 1-2.6-6"/><path d="M20.4 4.4v5.4h-5.4"/>',
  sync_alt: '<path d="M4.4 8.6h15.2"/><path d="m16.4 5.4 3.2 3.2-3.2 3.2"/><path d="M19.6 15.4H4.4"/><path d="m7.6 12.2-3.2 3.2 3.2 3.2"/>',

  // Time. restore and history differ only in that restore keeps the arrowhead
  // on the counter-clockwise sweep, which is what "undo this" reads as.
  restore: '<path d="M3.8 11.4A8.2 8.2 0 1 1 6 17.6"/><path d="M3.6 5.8v5.6h5.6"/><path d="M12 8v4.4l3 1.8"/>',
  history: '<path d="M3.8 11.4A8.2 8.2 0 1 1 6 17.6"/><path d="M3.6 6v5.4H9"/><path d="M12 7.8v4.6l3.2 1.9"/>',

  // Edit / persist.
  save: '<path d="M5 4.5h10.6L19.5 8.4V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5z"/><path d="M7.6 4.5v4.6h6.8V4.5"/><path d="M7.6 19.5v-5.2h8.8v5.2"/>',
  edit: '<path d="M4 20h4.2L19 9.2a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8z"/><path d="m14.4 7 2.6 2.6"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.8 4.6 4.6L19 7.2"/>',
  delete: '<path d="M4.5 6.6h15"/><path d="M9.2 6.6V4.9a1.4 1.4 0 0 1 1.4-1.4h2.8a1.4 1.4 0 0 1 1.4 1.4v1.7"/><path d="M6.4 6.6 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.9-12.4"/><path d="M10.4 10.2v6M13.6 10.2v6"/>',
  cancel: '<circle cx="12" cy="12" r="8.8"/><path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  block: '<circle cx="12" cy="12" r="8.8"/><path d="m6 18 12-12"/>',

  // Transfer. The three share one chevron so a row of them stays even.
  download: '<path d="M12 3.6v11.2"/><path d="m7.4 10.4 4.6 4.4 4.6-4.4"/><path d="M4.4 18.4h15.2"/>',
  file_upload: '<path d="M12 20V8.8"/><path d="m7.4 13.2 4.6-4.4 4.6 4.4"/><path d="M4.4 4.6h15.2"/>',
  cloud: '<path d="M7 18.4a4.2 4.2 0 0 1-.4-8.4 5.6 5.6 0 0 1 10.7-1.3A3.9 3.9 0 0 1 17.6 18.4z"/>',
  cloud_upload: '<path d="M7 18.4a4.2 4.2 0 0 1-.4-8.4 5.6 5.6 0 0 1 10.7-1.3A3.9 3.9 0 0 1 17.6 18.4"/><path d="M12 20.2v-7"/><path d="m9.2 15.6 2.8-2.6 2.8 2.6"/>',
  open_in_new: '<path d="M18.5 13.6V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5h5.4"/><path d="M14.4 3.5h6v6"/><path d="M10.6 13.4 20.4 3.6"/>',
  attach_file: '<path d="M16.8 7.2v8.4a4.8 4.8 0 0 1-9.6 0V6.4a3.2 3.2 0 0 1 6.4 0v9a1.6 1.6 0 0 1-3.2 0V7.6"/>',
  link_off: '<path d="M9.6 14.4 8.4 15.6a3.9 3.9 0 0 1-5.5-5.5l1.6-1.6"/><path d="m14.4 9.6 1.2-1.2a3.9 3.9 0 0 1 5.5 5.5l-1.6 1.6"/><path d="m3.6 3.6 16.8 16.8"/>',

  // Run / stop. power_settings_new is the unbroken twin of `power_off`, which
  // carries the slash — the pair is "turn this on" versus "this is off".
  power_settings_new: '<path d="M12 3.4v8.2"/><path d="M7.4 6.6a7.2 7.2 0 1 0 9.2 0"/>',
  play_circle: '<circle cx="12" cy="12" r="8.8"/><path d="M10.3 8.9 15.4 12l-5.1 3.1z"/>',
  stop_circle: '<circle cx="12" cy="12" r="8.8"/><rect x="9.2" y="9.2" width="5.6" height="5.6" rx="1.1"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  rocket_launch: '<path d="M12 2.8c2.6 2.3 4 5.5 4 9v3.6H8v-3.6c0-3.5 1.4-6.7 4-9z"/><circle cx="12" cy="9.6" r="1.6"/><path d="M8 12.4 5.2 15.4v3.2L8 16.2"/><path d="m16 12.4 2.8 3v3.2L16 16.2"/><path d="M10.8 17.6h2.4l-1.2 3.4z"/>',

  // Secrets and trust. All four reuse the `security` shield outline so the
  // security pages read as one family rather than four unrelated marks.
  shield: '<path d="M12 3.2 19 6v5.4c0 4.3-2.9 7.6-7 9.4-4.1-1.8-7-5.1-7-9.4V6z"/>',
  shield_lock: '<path d="M12 3.2 19 6v5.4c0 4.3-2.9 7.6-7 9.4-4.1-1.8-7-5.1-7-9.4V6z"/><rect x="9.6" y="11" width="4.8" height="4" rx="1"/><path d="M10.7 11v-1a1.3 1.3 0 0 1 2.6 0v1"/>',
  verified_user: '<path d="M12 3.2 19 6v5.4c0 4.3-2.9 7.6-7 9.4-4.1-1.8-7-5.1-7-9.4V6z"/><path d="m9.3 12 1.9 1.9 3.6-3.7"/>',
  key: '<circle cx="7.6" cy="15.4" r="3.6"/><path d="m10.4 12.8 8-8"/><path d="m15.4 7.8 2.2 2.2M17.8 5.4l2.4 2.4"/>',
  lock_open: '<rect x="4.2" y="10.4" width="15.6" height="9.4" rx="2"/><path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.5-.8"/><path d="M12 14v2.4"/>',
  visibility: '<path d="M2.2 12S5.8 5.5 12 5.5 21.8 12 21.8 12 18.2 18.5 12 18.5 2.2 12 2.2 12"/><circle cx="12" cy="12" r="2.8"/>',
  visibility_off: '<path d="M9.6 6a9.4 9.4 0 0 1 2.4-.3c6.2 0 9.8 6.3 9.8 6.3a16.6 16.6 0 0 1-3 3.8"/><path d="M6.4 7.6A16.8 16.8 0 0 0 2.2 12s3.6 6.3 9.8 6.3a9.6 9.6 0 0 0 3.6-.7"/><path d="M10.1 10.1a2.8 2.8 0 0 0 3.8 3.8"/><path d="m3.6 3.6 16.8 16.8"/>',

  // Topology.
  route: '<circle cx="6" cy="18.4" r="2.4"/><circle cx="18" cy="5.6" r="2.4"/><path d="M15.6 5.6H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8.4"/>',
  hub: '<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="4.2" r="1.8"/><circle cx="12" cy="19.8" r="1.8"/><circle cx="4.2" cy="12" r="1.8"/><circle cx="19.8" cy="12" r="1.8"/><path d="M12 6v3.4M12 14.6V18M6 12h3.4M14.6 12H18"/>',
  wifi: '<path d="M2.6 9.2a13.4 13.4 0 0 1 18.8 0"/><path d="M6 12.6a8.6 8.6 0 0 1 12 0"/><path d="M9.3 16a4 4 0 0 1 5.4 0"/><path d="M12 19.4h.01"/>',
  wifi_tethering: '<path d="M6.6 16.2a7 7 0 1 1 10.8 0"/><path d="M3.8 19a11 11 0 1 1 16.4 0"/><circle cx="12" cy="12.6" r="2.2"/>',
  database: '<ellipse cx="12" cy="5.8" rx="7.4" ry="2.8"/><path d="M4.6 5.8v12.4c0 1.5 3.3 2.8 7.4 2.8s7.4-1.3 7.4-2.8V5.8"/><path d="M4.6 12c0 1.5 3.3 2.8 7.4 2.8s7.4-1.3 7.4-2.8"/>',
  computer: '<rect x="2.6" y="4.4" width="18.8" height="11.4" rx="2"/><path d="M7.4 19.6h9.2M12 15.8v3.8"/>',

  // Work surfaces.
  code: '<path d="m8.6 8.4-4.4 3.6 4.4 3.6"/><path d="m15.4 8.4 4.4 3.6-4.4 3.6"/><path d="m13.4 5-2.8 14"/>',
  monitoring: '<rect x="2.8" y="4.4" width="18.4" height="12.6" rx="2"/><path d="m6.4 13.4 3.2-3.6 2.6 2.4 4.2-4.6"/><path d="M8.6 20.6h6.8"/>',
  grid_view: '<rect x="3.6" y="3.6" width="7" height="7" rx="1.6"/><rect x="13.4" y="3.6" width="7" height="7" rx="1.6"/><rect x="3.6" y="13.4" width="7" height="7" rx="1.6"/><rect x="13.4" y="13.4" width="7" height="7" rx="1.6"/>',
  checklist: '<path d="M9.6 6.4h10.8M9.6 12h10.8M9.6 17.6h10.8"/><path d="m3.4 6.2 1.4 1.4 2.2-2.4M3.4 11.8l1.4 1.4 2.2-2.4M3.4 17.4l1.4 1.4 2.2-2.4"/>',
  psychology: '<path d="M11.4 5.2a3 3 0 0 0-5.3 1.9 2.8 2.8 0 0 0-1.4 4.6 3 3 0 0 0 1.1 4.3 3 3 0 0 0 5.6 1.4z"/><path d="M12.6 5.2a3 3 0 0 1 5.3 1.9 2.8 2.8 0 0 1 1.4 4.6 3 3 0 0 1-1.1 4.3 3 3 0 0 1-5.6 1.4z"/><path d="M12 5v13.4"/>',
  business: '<rect x="3.6" y="7.6" width="7.4" height="12.8" rx="1.2"/><path d="M11 20.4V4.8a1.2 1.2 0 0 1 1.2-1.2h6.2a1.2 1.2 0 0 1 1.2 1.2v15.6"/><path d="M6.4 11h1.8M6.4 15.2h1.8M14 7.4h2.4M14 11.4h2.4M14 15.4h2.4"/>',
  gavel: '<rect x="6.2" y="3.4" width="11.6" height="4.6" rx="1.4"/><path d="M12 8v8.6"/><rect x="4.6" y="17.4" width="14.8" height="3" rx="1.2"/>',
  account_circle: '<circle cx="12" cy="12" r="8.8"/><circle cx="12" cy="10" r="2.8"/><path d="M6.4 18.4a6.2 6.2 0 0 1 11.2 0"/>',
  help: '<circle cx="12" cy="12" r="8.8"/><path d="M9.7 9.6a2.3 2.3 0 1 1 2.3 2.6v1.4"/><path d="M12 16.6h.01"/>',
  star: '<path d="m12 4 2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>',
  emergency: '<path d="M12 4.6v14.8M5.6 8.3l12.8 7.4M18.4 8.3 5.6 15.7"/>',
  // ---- Names reached only through a conditional, e.g. {ok ? "check_circle"
  // : "radio_button_unchecked"}. Easy to miss when scanning for literals. ----
  apps: '<circle cx="6" cy="6" r="1.7"/><circle cx="12" cy="6" r="1.7"/><circle cx="18" cy="6" r="1.7"/><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/><circle cx="6" cy="18" r="1.7"/><circle cx="12" cy="18" r="1.7"/><circle cx="18" cy="18" r="1.7"/>',
  expand_less: '<path d="m6 14.5 6-6 6 6"/>',
  radio_button_unchecked: '<circle cx="12" cy="12" r="8.8"/>',
  play_arrow: '<path d="M8.2 5.4 18.4 12 8.2 18.6z"/>',
  pause_circle: '<circle cx="12" cy="12" r="8.8"/><path d="M10.2 9.4v5.2M13.8 9.4v5.2"/>',
  lock: '<rect x="4.2" y="10.4" width="15.6" height="9.4" rx="2"/><path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8"/><path d="M12 14v2.4"/>',
  cloud_off: '<path d="M7 18.4a4.2 4.2 0 0 1-.4-8.4 5.6 5.6 0 0 1 10.7-1.3A3.9 3.9 0 0 1 17.6 18.4z"/><path d="m3.6 3.6 16.8 16.8"/>',
  open_in_browser: '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2"/><path d="M3.4 8.8h17.2"/><path d="M12 18v-6.4"/><path d="m9.4 14 2.6-2.6 2.6 2.6"/>',
  hourglass_top: '<path d="M6.4 3.6h11.2M6.4 20.4h11.2"/><path d="M7.4 3.6v3.2c0 2.2 1.6 3.6 4.6 5.2 3-1.6 4.6-3 4.6-5.2V3.6"/><path d="M7.4 20.4v-3.2c0-2.2 1.6-3.6 4.6-5.2 3 1.6 4.6 3 4.6 5.2v3.2"/>',
  science: '<path d="M9.6 3.6v6.2L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3l-4.8-8.2V3.6"/><path d="M8.4 3.6h7.2"/><path d="M7.4 14.4h9.2"/>',
  smart_toy: '<rect x="3.4" y="8.6" width="17.2" height="11.2" rx="2.6"/><path d="M12 8.6V5.4"/><circle cx="12" cy="4" r="1.4"/><path d="M8.6 13.2h.01M15.4 13.2h.01"/><path d="M9.6 16.6h4.8"/>',
  // An X inside the lens, not a slash across it: a slash lands on the handle
  // and reads as "search is disabled" rather than "nothing matched".
  search_off: '<circle cx="10.6" cy="10.6" r="6.4"/><path d="m15.2 15.2 5.2 5.2"/><path d="m8.4 8.4 4.4 4.4M12.8 8.4l-4.4 4.4"/>',
  verified: '<path d="m12 3 2.3 2.1 3.1-.2.6 3 2.7 1.6-1.2 2.9 1.2 2.9-2.7 1.6-.6 3-3.1-.2L12 21l-2.3-2.1-3.1.2-.6-3-2.7-1.6 1.2-2.9-1.2-2.9 2.7-1.6.6-3 3.1.2z"/><path d="m9.3 12.2 1.9 1.9 3.5-4"/>',
  // The knob is filled only in the on state, so the pair reads at a glance
  // without colour doing the work.
  toggle_on: '<rect x="2.6" y="7.4" width="18.8" height="9.2" rx="4.6"/><circle cx="16.8" cy="12" r="2.8" fill="currentColor" stroke="none"/>',
  toggle_off: '<rect x="2.6" y="7.4" width="18.8" height="9.2" rx="4.6"/><circle cx="7.2" cy="12" r="2.8"/>',
  light_mode: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8"/>',
  dark_mode: '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2"/>',
  contrast: '<circle cx="12" cy="12" r="8.8"/><path d="M12 3.2a8.8 8.8 0 0 1 0 17.6z" fill="currentColor" stroke="none"/>',
  // ---- Names that reach Icon through data, not JSX: provider registries and
  // tool manifests carry `icon: "…"` strings, so grepping the components alone
  // misses them. These surfaced by rendering the pages and reading the
  // fallback's warnings. ----
  person_add: '<circle cx="9.6" cy="8.4" r="3.6"/><path d="M3.4 19.4a6.2 6.2 0 0 1 12.4 0"/><path d="M18.4 8.4v5.2M15.8 11h5.2"/>',
  group: '<circle cx="9.4" cy="9" r="3.2"/><path d="M3.4 19a6 6 0 0 1 12 0"/><path d="M16.4 6.4a3.2 3.2 0 0 1 0 6"/><path d="M17.4 14.2a6 6 0 0 1 3.2 4.8"/>',
  group_work: '<circle cx="12" cy="12" r="8.8"/><circle cx="12" cy="8.2" r="1.9"/><circle cx="8.6" cy="14.4" r="1.9"/><circle cx="15.4" cy="14.4" r="1.9"/>',
  face: '<circle cx="12" cy="12" r="8.8"/><path d="M8.6 10.4h.01M15.4 10.4h.01"/><path d="M8.4 14.4a4.4 4.4 0 0 0 7.2 0"/>',
  logout: '<path d="M14.4 4.6h4.2a1.8 1.8 0 0 1 1.8 1.8v11.2a1.8 1.8 0 0 1-1.8 1.8h-4.2"/><path d="M3.6 12h11.2"/><path d="m11.4 8.6 3.4 3.4-3.4 3.4"/>',
  input: '<path d="M14.4 4.6h4.4a1.8 1.8 0 0 1 1.8 1.8v11.2a1.8 1.8 0 0 1-1.8 1.8h-4.4"/><path d="M3.4 12h10.4"/><path d="m10.2 8.6 3.6 3.4-3.6 3.4"/>',
  output: '<path d="M9.6 4.6H5.2a1.8 1.8 0 0 0-1.8 1.8v11.2a1.8 1.8 0 0 0 1.8 1.8h4.4"/><path d="M10.2 12h10.4"/><path d="m17 8.6 3.6 3.4-3.6 3.4"/>',

  sync: '<path d="M19.4 11A7.6 7.6 0 0 0 6.6 6.6"/><path d="M19.6 4.6v4.2h-4.2"/><path d="M4.6 13a7.6 7.6 0 0 0 12.8 4.4"/><path d="M4.4 19.4v-4.2h4.2"/>',
  restart_alt: '<path d="M19 9.2A7.8 7.8 0 1 1 13.6 4.3"/><path d="M13.4 1.6 16.2 4.4l-2.8 2.8"/>',
  swap_horiz: '<path d="M4 8.8h13.2"/><path d="m14 5.6 3.4 3.2-3.4 3.2"/><path d="M20 15.2H6.8"/><path d="M10 12 6.6 15.2 10 18.4"/>',
  upload: '<path d="M12 20V8.8"/><path d="m7.4 13.2 4.6-4.4 4.6 4.4"/><path d="M4.4 4.6h15.2"/>',
  send: '<path d="M21 3.6 10.6 14"/><path d="M21 3.6 14.4 21l-3.8-7-7-3.8z"/>',
  mail: '<rect x="2.8" y="5" width="18.4" height="14" rx="2"/><path d="m3.6 6.8 8.4 6 8.4-6"/>',
  link: '<path d="M10 13.4a3.9 3.9 0 0 0 5.6 0l2.4-2.4a3.9 3.9 0 0 0-5.5-5.5l-1.4 1.4"/><path d="M14 10.6a3.9 3.9 0 0 0-5.6 0L6 13a3.9 3.9 0 0 0 5.5 5.5l1.4-1.4"/>',
  remove: '<path d="M5 12h14"/>',

  cloud_queue: '<path d="M7 18.4a4.2 4.2 0 0 1-.4-8.4 5.6 5.6 0 0 1 10.7-1.3A3.9 3.9 0 0 1 17.6 18.4z"/>',
  cloud_circle: '<circle cx="12" cy="12" r="8.8"/><path d="M9.2 15.2a2.4 2.4 0 0 1-.2-4.8 3.4 3.4 0 0 1 6.4-.8 2.3 2.3 0 0 1-.2 5.6z"/>',
  cloud_sync: '<path d="M7.4 16.4a4 4 0 0 1-.6-7.9 5.4 5.4 0 0 1 10.3-1.3A3.8 3.8 0 0 1 18.4 14"/><path d="M16.6 19.6a3.4 3.4 0 1 1 3.2-4.4"/><path d="M20.4 12.8v2.6h-2.6"/>',
  public: '<circle cx="12" cy="12" r="8.8"/><path d="M3.3 12h17.4"/><path d="M12 3.2a13.4 13.4 0 0 1 0 17.6 13.4 13.4 0 0 1 0-17.6z"/>',
  router: '<rect x="3.4" y="13.6" width="17.2" height="6.4" rx="1.8"/><path d="M7 16.8h.01M10.4 16.8h.01M17.6 16.8h.01"/><path d="M8.6 9.4a4.8 4.8 0 0 1 6.8 0"/><path d="M6.2 6.8a8.2 8.2 0 0 1 11.6 0"/>',
  vpn_lock: '<circle cx="10.4" cy="10.4" r="7.4"/><path d="M3 10.4h14.8"/><path d="M10.4 3a11.6 11.6 0 0 1 2.6 7.4"/><path d="M10.4 3a11.6 11.6 0 0 0 0 14.8"/><rect x="14.8" y="14.4" width="6.4" height="5.6" rx="1.2"/><path d="M16.4 14.4v-1.2a1.6 1.6 0 0 1 3.2 0v1.2"/>',
  account_tree: '<rect x="13.4" y="3.4" width="7.2" height="4.2" rx="1"/><rect x="13.4" y="9.9" width="7.2" height="4.2" rx="1"/><rect x="13.4" y="16.4" width="7.2" height="4.2" rx="1"/><path d="M13.4 5.5H6.6v13h6.8"/><path d="M6.6 12h6.8"/>',
  scatter_plot: '<circle cx="8" cy="8.4" r="2.6"/><circle cx="8" cy="16.4" r="2.2"/><circle cx="16.2" cy="13.4" r="2.8"/>',
  dashboard: '<rect x="3.4" y="3.4" width="7.4" height="8.6" rx="1.4"/><rect x="13.2" y="3.4" width="7.4" height="5.2" rx="1.4"/><rect x="3.4" y="14.4" width="7.4" height="6.2" rx="1.4"/><rect x="13.2" y="10.8" width="7.4" height="9.8" rx="1.4"/>',
  speed: '<path d="M4.2 17.4a9 9 0 1 1 15.6 0"/><path d="m12 13.4 4.2-4.6"/><circle cx="12" cy="15" r="1.6"/>',
  schedule: '<circle cx="12" cy="12" r="8.8"/><path d="M12 6.8V12l3.4 2"/>',

  developer_board: '<rect x="3.4" y="5.4" width="14.4" height="13.2" rx="1.8"/><path d="M17.8 8.8h2.8M17.8 12h2.8M17.8 15.2h2.8"/><path d="M6.6 9h5M6.6 12.4h5M6.6 15.4h3"/>',
  deployed_code: '<path d="M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6z"/><path d="m4 7.6 8 4.4 8-4.4M12 12v8.8"/>',
  deployed_code_history: '<path d="M11.4 20.6 4 16.4V7.6l8-4.4 8 4.4v3.6"/><path d="m4 7.6 8 4.4 8-4.4M12 12v8.6"/><circle cx="17.4" cy="17.4" r="3.4"/><path d="M17.4 15.8v1.8l1.2.8"/>',
  system_update: '<rect x="6.4" y="2.8" width="11.2" height="18.4" rx="2.2"/><path d="M12 7.6v6.8"/><path d="m9.2 11.6 2.8 2.8 2.8-2.8"/><path d="M10.4 18.4h3.2"/>',
  data_object: '<path d="M9 3.6c-2 0-2.6 1-2.6 2.6v2.6c0 1.6-.8 2.4-2.4 2.4v1.6c1.6 0 2.4.8 2.4 2.4v2.6c0 1.6.6 2.6 2.6 2.6"/><path d="M15 3.6c2 0 2.6 1 2.6 2.6v2.6c0 1.6.8 2.4 2.4 2.4v1.6c-1.6 0-2.4.8-2.4 2.4v2.6c0 1.6-.6 2.6-2.6 2.6"/>',
  token: '<path d="m12 3.4 7.4 4.3v8.6L12 20.6l-7.4-4.3V7.7z"/><circle cx="12" cy="12" r="3"/>',
  toll: '<circle cx="9" cy="12" r="7.4"/><path d="M14 5a7.4 7.4 0 0 1 0 14"/>',
  diamond: '<path d="M7.6 3.6h8.8l4 5.6L12 20.4 3.6 9.2z"/><path d="M3.6 9.2h16.8"/>',
  sell: '<path d="M11.4 3.6H5.4a1.8 1.8 0 0 0-1.8 1.8v6a1.8 1.8 0 0 0 .5 1.3l7.6 7.6a1.8 1.8 0 0 0 2.6 0l6-6a1.8 1.8 0 0 0 0-2.6l-7.6-7.6a1.8 1.8 0 0 0-1.3-.5z"/><path d="M8 8h.01"/>',
  storefront: '<path d="M3.6 9.8v8.8a1.8 1.8 0 0 0 1.8 1.8h13.2a1.8 1.8 0 0 0 1.8-1.8V9.8"/><path d="M2.6 9.8 4.4 4.6a1.2 1.2 0 0 1 1.2-.8h12.8a1.2 1.2 0 0 1 1.2.8l1.8 5.2z"/><path d="M8.4 3.8 7.6 9.8M15.6 3.8l.8 6"/><path d="M9.2 20.4v-5.2h5.6v5.2"/>',

  manage_search: '<path d="M3.4 6.4h5M3.4 10.4h5M3.4 14.4h5"/><circle cx="14.4" cy="11.4" r="4.4"/><path d="m17.6 14.6 3.4 3.4"/>',
  saved_search: '<circle cx="10.6" cy="10.6" r="6.6"/><path d="m15.4 15.4 5 5"/><path d="m10.6 7.4 1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z"/>',
  filter_alt_off: '<path d="M4.6 4.8h14.6l-5.5 6.7v6.2l-3.6 2.2v-8.4z"/><path d="m3.6 3.6 16.8 16.8"/>',
  help_outline: '<circle cx="12" cy="12" r="8.8"/><path d="M9.7 9.6a2.3 2.3 0 1 1 2.3 2.6v1.4"/><path d="M12 16.6h.01"/>',
  menu_book: '<path d="M12 7.4a6.6 6.6 0 0 0-4.6-1.8H3.6v12.2h3.8A6.6 6.6 0 0 1 12 19.4"/><path d="M12 7.4a6.6 6.6 0 0 1 4.6-1.8h3.8v12.2h-3.8a6.6 6.6 0 0 0-4.6 1.6"/><path d="M12 7.4v12"/>',
  school: '<path d="m12 4.2 9.4 4.4-9.4 4.4-9.4-4.4z"/><path d="M6.6 11v4.6c0 1.6 2.4 2.8 5.4 2.8s5.4-1.2 5.4-2.8V11"/><path d="M21.4 8.6v5"/>',
  edit_note: '<path d="M3.6 6.4h12M3.6 11h8M3.6 15.6h6"/><path d="M12.6 20.4h2.8l5.4-5.4a2 2 0 0 0-2.8-2.8l-5.4 5.4z"/>',
  playlist_add: '<path d="M3.4 7h11M3.4 11.4h11M3.4 15.8h6.6"/><path d="M17.6 11.4v7.2M14 15h7.2"/>',
  delete_sweep: '<path d="M3.4 6.4h7M3.4 10.4h7M3.4 14.4h4.6"/><path d="M12.4 8.4h8.2"/><path d="m13.6 8.4.8 10.2a1.4 1.4 0 0 0 1.4 1.3h2.2a1.4 1.4 0 0 0 1.4-1.3l.8-10.2"/><path d="M15.4 8.4V6.6a1.2 1.2 0 0 1 1.2-1.2h1.8a1.2 1.2 0 0 1 1.2 1.2v1.8"/>',
  folder_open: '<path d="M3.6 8V6.4a1.6 1.6 0 0 1 1.6-1.6h3.8l2 2.4h6.2a1.6 1.6 0 0 1 1.6 1.6v1.2"/><path d="M3.6 9.6h17.2l-2 8.4a1.6 1.6 0 0 1-1.6 1.2H5.2a1.6 1.6 0 0 1-1.6-1.6z"/>',
  picture_as_pdf: '<path d="M13.6 3.6H6.4a1.8 1.8 0 0 0-1.8 1.8v13.2a1.8 1.8 0 0 0 1.8 1.8h11.2a1.8 1.8 0 0 0 1.8-1.8V9.2z"/><path d="M13.6 3.6v5.6h5.8"/><path d="M8.4 16.8v-4.2h1.3a1.4 1.4 0 0 1 0 2.8H8.4"/><path d="M13 16.8v-4.2h.9a1.5 1.5 0 0 1 1.5 1.5v1.2a1.5 1.5 0 0 1-1.5 1.5z"/>',

  // The brain is two mirrored lobes with a midline; the variants differ only in
  // what sits inside, so the three read as one idea at nav size.
  neurology: '<path d="M11.4 5.2a3 3 0 0 0-5.3 1.9 2.8 2.8 0 0 0-1.4 4.6 3 3 0 0 0 1.1 4.3 3 3 0 0 0 5.6 1.4z"/><path d="M12.6 5.2a3 3 0 0 1 5.3 1.9 2.8 2.8 0 0 1 1.4 4.6 3 3 0 0 1-1.1 4.3 3 3 0 0 1-5.6 1.4z"/><path d="M12 5v13.4"/><path d="m8.4 10.4 1.8 1.8-1.8 1.8M15.6 10.4l-1.8 1.8 1.8 1.8"/>',
  psychology_alt: '<path d="M11.4 5.2a3 3 0 0 0-5.3 1.9 2.8 2.8 0 0 0-1.4 4.6 3 3 0 0 0 1.1 4.3 3 3 0 0 0 5.6 1.4z"/><path d="M12.6 5.2a3 3 0 0 1 5.3 1.9 2.8 2.8 0 0 1 1.4 4.6 3 3 0 0 1-1.1 4.3 3 3 0 0 1-5.6 1.4z"/><path d="M10.1 9.4a2 2 0 1 1 1.9 2.4v1.4"/><path d="M12 15.8h.01"/>',

  auto_awesome: '<path d="m12 3.4 1.9 4.7 4.7 1.9-4.7 1.9L12 16.6l-1.9-4.7-4.7-1.9 4.7-1.9z"/><path d="m18.6 15.6.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
  auto_fix_high: '<path d="M4 20 14.4 9.6"/><path d="m13 7.4 3.6 3.6"/><path d="m17.4 3 .8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/><path d="m7.6 3.4.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
  local_fire_department: '<path d="M12 3.4s4.6 3.6 4.6 8.4a4.6 4.6 0 0 1-9.2 0c0-1.6.6-2.8 1.4-3.8 0 1.4.8 2.2 1.6 2.2 1.2 0 1.8-1 1.6-2.6-.2-1.6 0-3 0-4.2z"/>',
  water_drop: '<path d="M12 3.4c3.2 3.6 5.8 6.6 5.8 9.8a5.8 5.8 0 0 1-11.6 0c0-3.2 2.6-6.2 5.8-9.8z"/>',
  waves: '<path d="M3 7.6c1.6-1.6 3.2-1.6 4.8 0s3.2 1.6 4.8 0 3.2-1.6 4.8 0 3.2 1.6 4.6 0"/><path d="M3 12.4c1.6-1.6 3.2-1.6 4.8 0s3.2 1.6 4.8 0 3.2-1.6 4.8 0 3.2 1.6 4.6 0"/><path d="M3 17.2c1.6-1.6 3.2-1.6 4.8 0s3.2 1.6 4.8 0 3.2-1.6 4.8 0 3.2 1.6 4.6 0"/>',
  air: '<path d="M3.4 8.4h10a2.8 2.8 0 1 0-2.8-2.8"/><path d="M3.4 12.8h13.6a2.8 2.8 0 1 1-2.8 2.8"/><path d="M3.4 17.2h6"/>',
  blur_on: '<circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="6.6" r="1"/><circle cx="12" cy="17.4" r="1"/><circle cx="6.6" cy="12" r="1"/><circle cx="17.4" cy="12" r="1"/><circle cx="8.2" cy="8.2" r=".8"/><circle cx="15.8" cy="8.2" r=".8"/><circle cx="8.2" cy="15.8" r=".8"/><circle cx="15.8" cy="15.8" r=".8"/>',
  graphic_eq: '<path d="M4.4 10.4v3.2M8.8 6.4v11.2M13.2 3.6v16.8M17.6 8v8M21 10.8v2.4"/>',
  speaker: '<rect x="5.4" y="2.8" width="13.2" height="18.4" rx="2.2"/><circle cx="12" cy="15" r="3.4"/><circle cx="12" cy="7" r="1.3"/>',
  spatial_audio: '<rect x="4.4" y="9.4" width="8" height="11.2" rx="1.8"/><circle cx="8.4" cy="16" r="2.2"/><path d="M15.4 4.6a6.4 6.4 0 0 1 0 9"/><path d="M18.2 2.6a9.6 9.6 0 0 1 0 13"/>',
  shield_with_heart: '<path d="M12 3.2 19 6v5.4c0 4.3-2.9 7.6-7 9.4-4.1-1.8-7-5.1-7-9.4V6z"/><path d="M12 17s-3.6-2.3-3.6-4.8a2.1 2.1 0 0 1 3.6-1.5 2.1 2.1 0 0 1 3.6 1.5c0 2.5-3.6 4.8-3.6 4.8z"/>',
  cookie: '<path d="M20.8 12.2A8.8 8.8 0 1 1 12 3.2a3.4 3.4 0 0 0 3.2 3.6 3 3 0 0 0 2.6 3.6 3.1 3.1 0 0 0 3 1.8z"/><path d="M9 9.4h.01M8 14.4h.01M13.4 14.8h.01M12.6 11.4h.01"/>',
  restaurant: '<path d="M6.4 3.4v5.4a2.6 2.6 0 0 0 5.2 0V3.4"/><path d="M9 9.6v11"/><path d="M17.6 20.6v-7.4h-1.4a1.4 1.4 0 0 1-1.4-1.4V7a3.6 3.6 0 0 1 2.8-3.6z"/>',
  // The registry names this after the Flutter mascot, but it is the fallback
  // glyph for Featherless; a feather says more than a bird would.
  flutter_dash: '<path d="M19.4 4.6a8.8 8.8 0 0 1-2.6 6.3l-6.4 6.4-3.7-3.7 6.4-6.4a8.8 8.8 0 0 1 6.3-2.6z"/><path d="M4.6 19.4 9 15M13.4 8.2l2.4 2.4M11 10.6l2.4 2.4"/>',
});

export const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS));
