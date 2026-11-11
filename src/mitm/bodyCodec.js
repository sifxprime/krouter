const zlib = require("zlib");

// 0.5.174 — Claude Desktop and Claude Code send `/v1/messages` with
// `content-encoding: gzip`. Before this module the MITM read the raw bytes:
// isBinaryData() saw >30% non-printable bytes in the gzip header, extractModel()
// returned null, getMappedModel() got no model, and `if (!mappedModel) return
// passthrough(...)` sent the request straight on to api.anthropic.com — on the
// user's own Anthropic quota — with the DNS redirect, the certificate and the
// MITM listener all working perfectly. 33 of 34 sampled /v1/messages requests
// leaked that way, which is why "DNS is on but Claude is not using kRouter".
//
// Decoding is deliberately forgiving: anything we cannot decode is returned
// unchanged, so the caller's existing passthrough path still applies. A request
// is never failed because of this layer.

function inflateEither(buf) {
  // `deflate` on the wire is usually zlib-wrapped, but some clients send raw.
  try { return zlib.inflateSync(buf); } catch { return zlib.inflateRawSync(buf); }
}

const DECODERS = {
  gzip: zlib.gunzipSync,
  "x-gzip": zlib.gunzipSync,
  deflate: inflateEither,
  "x-deflate": inflateEither,
  br: zlib.brotliDecompressSync,
  // Node >= 22.15 / 23.8 only.
  zstd: typeof zlib.zstdDecompressSync === "function" ? zlib.zstdDecompressSync : undefined,
};

/**
 * Decode a request body according to its Content-Encoding header.
 * Returns the original buffer unchanged when there is nothing to do, when the
 * encoding is unknown, or when decoding fails.
 *
 * @param {Buffer} buffer raw request body as received
 * @param {Record<string, string|string[]>} headers incoming request headers
 * @returns {Buffer}
 */
function decodeRequestBody(buffer, headers = {}) {
  if (!buffer || buffer.length === 0) return buffer;

  const raw = headers["content-encoding"] ?? headers["Content-Encoding"];
  const encoding = String(Array.isArray(raw) ? raw.join(",") : raw || "").toLowerCase();
  if (!encoding.trim()) return buffer;

  // Multiple encodings are applied left-to-right on the wire, so undo them
  // right-to-left: `content-encoding: deflate, gzip` is gunzip then inflate.
  const steps = encoding.split(",").map((s) => s.trim()).filter(Boolean).reverse();
  if (!steps.length || steps.every((s) => s === "identity")) return buffer;

  let out = buffer;
  for (const step of steps) {
    if (step === "identity") continue;
    const decode = DECODERS[step];
    if (!decode) return buffer;
    try {
      out = decode(out);
    } catch {
      return buffer;
    }
  }
  return out;
}

module.exports = { decodeRequestBody };
