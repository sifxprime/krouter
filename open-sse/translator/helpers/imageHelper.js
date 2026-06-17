/**
 * Fetch a remote image URL and return it as a base64 data URI.
 * Used when upstream providers (Codex, etc.) require inline base64 images
 * instead of remote URLs they cannot fetch.
 *
 * Security: this function is called with user-supplied URLs (from chat
 * messages forwarded by the LLM client), so it must defeat SSRF including:
 *   - direct internal IPs (169.254.169.254, 127.0.0.1, RFC1918 ranges, link-local)
 *   - DNS rebinding (TOCTOU between assertHost and fetch)
 *   - multi-A records mixing public + private IPs
 *   - HTTP redirects from a public URL to an internal one
 *   - oversize payloads draining memory
 *
 * Returns null if fetch fails or any guard rejects.
 * Ported from upstream c7d0744 (GHSA-cmhj-wh2f-9cgx), adapted for our simpler shape.
 *
 * @param {string} imageUrl - HTTP(S) URL of the image
 * @param {object} options - { signal, timeoutMs, maxBytes }
 * @returns {Promise<{url: string, mimeType: string}|null>}
 */

import { lookup } from "node:dns/promises";
import { Agent } from "undici";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024; // 20 MiB hard cap
const DEFAULT_TIMEOUT_MS = 10_000;

// Hosts that resolve to public IPs but represent infrastructure attackers
// might want to reach (covered by IP check too but explicit is safer).
const BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata",
]);

// True if an IPv4/IPv6 address is private/reserved (SSRF target).
function isPrivateIp(ip) {
  if (!ip) return true;
  const lower = ip.toLowerCase();

  // IPv6 first — must check before IPv4 because v4-mapped form contains a "."
  // e.g. "::ffff:127.0.0.1" — strip the v4-mapped prefix and re-check.
  if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
  if (lower.includes(":")) {
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    if (lower.startsWith("fe80")) return true;                         // link-local
    return false;
  }

  // IPv4
  if (lower.includes(".")) {
    const [a, b] = lower.split(".").map(Number);
    if (a === 10) return true;                          // 10.0.0.0/8
    if (a === 127) return true;                         // loopback
    if (a === 169 && b === 254) return true;            // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
    if (a === 192 && b === 168) return true;            // 192.168.0.0/16
    if (a === 0) return true;                           // 0.0.0.0/8
    if (a >= 224) return true;                          // multicast + reserved
    return false;
  }
  return false;
}

// Resolve host once and return only public-IP records.
// Rejects if any A/AAAA record is private (defeats multi-A round-robin tricks).
// Returns null on any rejection so the caller can refuse without leaking which check failed.
async function resolvePinnedIps(hostname) {
  if (!hostname) return null;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host)) return null;
  try {
    const records = await lookup(hostname, { all: true });
    if (!records.length) return null;
    if (records.some((r) => isPrivateIp(r.address))) return null;
    return records;
  } catch {
    return null;
  }
}

export async function fetchImageAsBase64(imageUrl, options = {}) {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = options;
  if (!imageUrl || (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://"))) {
    return null;
  }

  let url;
  try { url = new URL(imageUrl); } catch { return null; }

  const pinnedIps = await resolvePinnedIps(url.hostname);
  if (!pinnedIps) return null;

  const controller = new AbortController();
  const timeout = signal ? null : setTimeout(() => controller.abort(), timeoutMs);
  const fetchSignal = signal || controller.signal;

  // Pin connect() to the validated IP so no second DNS resolution can rebind
  // (TOCTOU defense). undici's Agent.connect.lookup is called instead of
  // node's net.lookup at socket establishment.
  const dispatcher = new Agent({
    connect: {
      lookup: (_h, _o, cb) => cb(null, [{ address: pinnedIps[0].address, family: pinnedIps[0].family }]),
    },
  });

  try {
    // redirect:"manual" prevents a public URL from 30x-ing to an internal one.
    const response = await fetch(imageUrl, { signal: fetchSignal, redirect: "manual", dispatcher });
    if (!response.ok || !response.body) return null;

    // Stream-read with a hard byte cap so a malicious server can't drain memory.
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { try { reader.cancel(); } catch {} return null; }
      chunks.push(value);
    }

    const buffer = Buffer.concat(chunks.map(c => Buffer.from(c)));
    const mimeType = response.headers.get("Content-Type") || "image/jpeg";
    const base64 = buffer.toString("base64");
    return { url: `data:${mimeType};base64,${base64}`, mimeType };
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
    dispatcher.close().catch(() => {});
  }
}

// Test hook: lets unit tests exercise the IP / host guards without network.
export const __test__ = { isPrivateIp, resolvePinnedIps, BLOCKED_HOSTS };
