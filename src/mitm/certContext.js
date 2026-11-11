const fs = require("fs");
const path = require("path");
const tls = require("tls");
const { MITM_DIR } = require("./paths");
const { getCertForDomain } = require("./cert/generate");

// 0.5.175 — Per-host TLS contexts, shared by the :443 listener and the proxy.
//
// Both transports terminate TLS with a leaf minted for the hostname the client
// asked for and signed by our root. The :443 listener learns that name from SNI,
// the proxy learns it from the CONNECT line, but the context is built the same
// way and the leaf must be sent with the root appended or clients that only
// trust the root reject an incomplete chain.
//
// This throws rather than exiting: server.js is a standalone process and can
// exit, but the proxy is spawned alongside a running app and must report the
// failure instead of taking anything down with it.

const contextCache = new Map();
let root = null;

function loadRoot() {
  if (root) return root;
  const key = fs.readFileSync(path.join(MITM_DIR, "rootCA.key"));
  const cert = fs.readFileSync(path.join(MITM_DIR, "rootCA.crt"));
  root = { key, cert, pem: cert.toString("utf8") };
  return root;
}

/** TLS context presenting a leaf for `servername`, chained to our root. */
function getSecureContext(servername) {
  if (contextCache.has(servername)) return contextCache.get(servername);
  const leaf = getCertForDomain(servername);
  if (!leaf) throw new Error(`Failed to generate cert for ${servername}`);
  const ctx = tls.createSecureContext({
    key: leaf.key,
    cert: `${leaf.cert}\n${loadRoot().pem}`,
  });
  contextCache.set(servername, ctx);
  return ctx;
}

/** https.createServer SNICallback form. */
function sniCallback(servername, cb) {
  try {
    cb(null, getSecureContext(servername));
  } catch (e) {
    cb(e);
  }
}

/** Root key/cert, used as the listener's default credentials before SNI. */
function rootCredentials() {
  const r = loadRoot();
  return { key: r.key, cert: r.cert };
}

module.exports = {
  getSecureContext,
  sniCallback,
  rootCredentials,
  _resetCache: () => { contextCache.clear(); root = null; },
};
