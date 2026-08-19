const http = require("http");
const crypto = require("crypto");

// 0.5.135 (GHSA-pjm4-8fpg-f9p6 class) — per-process secret proving that the peer
// metadata below was stamped by THIS wrapper and not sent by the client. Published
// to the env so route handlers can verify it (src/lib/auth/trustedPeer.js).
const PEER_TOKEN = crypto.randomBytes(24).toString("hex");
process.env.KROUTER_PEER_TOKEN = PEER_TOKEN;

const origCreate = http.createServer.bind(http);

// Wrap Next standalone HTTP server: derive client IP from the TCP socket
// (unspoofable) and strip client-supplied forwarding headers so downstream
// rate-limiting keys on the real peer address instead of attacker-controlled XFF.
http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const ip = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
    // Forwarding headers present = request arrived via a reverse proxy
    // (Cloudflare, nginx, Caddy, Tailscale Funnel, etc.). The loopback socket
    // is then the proxy hop, NOT the end-user, so downstream must not treat
    // this connection as "local" (which would bypass our rate limiter and
    // grant API-key-less access to /v1 endpoints).
    const viaProxy = !!(req.headers["x-forwarded-for"] || req.headers["x-real-ip"]);
    // Strip every client-supplied copy BEFORE stamping ours, so a caller can
    // neither forge the peer IP nor replay the proof token.
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-9r-via-proxy"];
    delete req.headers["x-9r-peer-token"];
    req.headers["x-9r-real-ip"] = ip;
    req.headers["x-9r-peer-token"] = PEER_TOKEN;
    if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    return handler(req, res);
  };
  return origCreate(...rest, wrapped);
};
