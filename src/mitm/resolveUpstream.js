const dns = require("dns");
const net = require("net");
const { promisify } = require("util");

// 0.5.175 — Shared by both capture transports.
//
// Resolution has to go to a real DNS server rather than through the OS resolver,
// because the DNS capture mode puts `127.0.0.1 api.anthropic.com` in /etc/hosts.
// An ordinary lookup would then hand us our own listener and the request would
// loop back into itself instead of reaching the vendor. This is only correct for
// hosts we intercept; see proxy.js, which deliberately uses normal resolution for
// everything it merely tunnels, so internal and corporate names still work.

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function resolveTargetIP(hostname, { servers = ["8.8.8.8"] } = {}) {
  // Node v26: dns.resolve4() throws ENOTFOUND on a raw IPv4 literal.
  if (net.isIP(hostname)) return hostname;

  const hit = cache.get(hostname);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.ip;

  const resolver = new dns.Resolver();
  resolver.setServers(servers);
  const resolve4 = promisify(resolver.resolve4.bind(resolver));
  const addresses = await resolve4(hostname);
  if (!addresses || !addresses.length) throw new Error(`No A record for ${hostname}`);

  cache.set(hostname, { ip: addresses[0], ts: Date.now() });
  return addresses[0];
}

module.exports = { resolveTargetIP, CACHE_TTL_MS, _cache: cache };
