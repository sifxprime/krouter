// antigravityHeaderScrub (0.5.29) — port of OmniRoute's antigravityHeaderScrub.
//
// Real Antigravity is a Node.js client. Its outbound HTTP requests never
// include proxy-tracing headers, Stainless SDK headers, or Chromium
// Sec-Ch-* headers. Sending any of these reveals the request came through
// a third-party proxy (kRouter) and risks account flagging.
//
// We scrub these headers on outbound requests to Antigravity upstream.

const HEADERS_TO_REMOVE = new Set([
  // Proxy tracing
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "forwarded",
  "via",
  // Stainless SDK fingerprints (Claude Code / OpenAI Node SDK)
  "x-title",
  "x-stainless-lang",
  "x-stainless-package-version",
  "x-stainless-os",
  "x-stainless-arch",
  "x-stainless-runtime",
  "x-stainless-runtime-version",
  "x-stainless-timeout",
  "x-stainless-retry-count",
  "x-stainless-helper-method",
  "http-referer",
  "referer",
  // Browser / Chromium fingerprint (Electron clients only — Antigravity isn't)
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-dest",
  "priority",
  // Encoding mismatch: Antigravity uses "gzip, deflate, br"; Electron adds "zstd"
  "accept-encoding",
]);

// Scrub headers + reorder so Authorization lands last (matches the native
// Antigravity wire-format byte order). Returns a NEW object; original
// untouched.
export function scrubProxyAndFingerprintHeaders(headers) {
  if (!headers || typeof headers !== "object") return headers;
  const cleaned = {};
  let authorizationValue;
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    // Drop our own prefix in case any internal header leaked in
    if (lower.startsWith("x-krouter-")) continue;
    if (HEADERS_TO_REMOVE.has(lower)) continue;
    if (lower === "authorization") {
      authorizationValue = value;
      continue;
    }
    cleaned[key] = value;
  }
  // Note: we used to force "Accept-Encoding: gzip, deflate, br" to mimic
  // Antigravity's native Node fingerprint, but Google then sent a gzipped
  // response that our raw-fetch path tried to JSON.parse → "Unexpected token �".
  // Drop the encoding header entirely so the runtime auto-handles compression.
  if (authorizationValue !== undefined) {
    cleaned["Authorization"] = authorizationValue;
  }
  return cleaned;
}
