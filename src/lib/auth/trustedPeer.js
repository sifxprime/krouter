/**
 * 0.5.135 — Proof that peer metadata came from OUR socket wrapper, not a client.
 *
 * GHSA-pjm4-8fpg-f9p6 class: `isLocalRequest()` used to decide "is this caller on
 * the loopback interface?" from the `Host` header, which the caller controls. A
 * remote request carrying `Host: localhost` was therefore treated as local, which
 * grants API-key-less access to /v1 and disables the auth rate limiter.
 *
 * The only unspoofable source of the peer address is the TCP socket, which lives in
 * custom-server.js. That wrapper stamps the real IP into `x-9r-real-ip` — but a
 * header alone proves nothing, since a client can send the same header. So the
 * wrapper also stamps a per-process secret that a client cannot know, and deletes
 * any client-supplied copy of both before doing so. If the secret matches, the
 * accompanying IP is genuinely ours.
 */

export const PEER_TOKEN_HEADER = "x-9r-peer-token";
export const REAL_IP_HEADER = "x-9r-real-ip";
export const PEER_TOKEN_ENV = "KROUTER_PEER_TOKEN";

/** Constant-time-ish compare (lengths differ → immediate false). */
function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when this request carries proof it passed through our socket wrapper. */
export function hasTrustedPeerHeaders(request) {
  const secret = process.env[PEER_TOKEN_ENV];
  if (!secret) return false; // wrapper not active (e.g. `next dev`)
  return safeEq(request.headers.get(PEER_TOKEN_HEADER) || "", secret);
}

/** The socket-derived peer IP, or null when it isn't provably ours. */
export function getTrustedPeerIp(request) {
  if (!hasTrustedPeerHeaders(request)) return null;
  return request.headers.get(REAL_IP_HEADER) || null;
}

/**
 * Loopback test that understands the shapes Node actually produces:
 * "127.0.0.1", "::1", "::ffff:127.0.0.1", and any 127.0.0.0/8 address.
 */
export function isLoopbackIp(ip) {
  if (!ip) return false;
  const v = String(ip).trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::1" || v === "0:0:0:0:0:0:0:1") return true;
  const v4 = v.startsWith("::ffff:") ? v.slice(7) : v;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}
