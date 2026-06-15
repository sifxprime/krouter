const { log, err } = require("../logger");

// ─── AWS EventStream exception-frame builder (self-contained) ─────────────────
// Used to surface upstream HTTP errors to Kiro as a parseable EventStream frame
// instead of dropping them silently and triggering "Truncated event message received".
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();
function _crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function _encodeHeader(name, value) {
  const nameBuf = Buffer.from(name, "utf8");
  const valueBuf = Buffer.from(value, "utf8");
  if (nameBuf.length > 255) throw new Error("EventStream header name too long");
  if (valueBuf.length > 65535) throw new Error("EventStream header value too long");
  const buf = Buffer.alloc(1 + nameBuf.length + 1 + 2 + valueBuf.length);
  let o = 0;
  buf[o++] = nameBuf.length;
  nameBuf.copy(buf, o); o += nameBuf.length;
  buf[o++] = 7;
  buf.writeUInt16BE(valueBuf.length, o); o += 2;
  valueBuf.copy(buf, o);
  return buf;
}
function buildExceptionFrame(message, exceptionType = "internalServerException") {
  const payloadBuf = Buffer.from(JSON.stringify({ message: String(message || "Upstream error") }), "utf8");
  const headersBuf = Buffer.concat([
    _encodeHeader(":message-type", "exception"),
    _encodeHeader(":exception-type", exceptionType),
    _encodeHeader(":content-type", "application/json"),
  ]);
  const totalLen = 12 + headersBuf.length + payloadBuf.length + 4;
  const frame = Buffer.alloc(totalLen);
  frame.writeUInt32BE(totalLen, 0);
  frame.writeUInt32BE(headersBuf.length, 4);
  frame.writeUInt32BE(_crc32(frame.slice(0, 8)), 8);
  headersBuf.copy(frame, 12);
  payloadBuf.copy(frame, 12 + headersBuf.length);
  frame.writeUInt32BE(_crc32(frame.slice(0, totalLen - 4)), totalLen - 4);
  return frame;
}

async function _readErrorMessage(routerRes) {
  try {
    const text = await routerRes.text();
    if (!text) return `Upstream ${routerRes.status}`;
    try {
      const j = JSON.parse(text);
      return j?.error?.message || j?.message || j?.error || text.slice(0, 500);
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return `Upstream ${routerRes.status}`;
  }
}

const DEFAULT_LOCAL_ROUTER = "http://localhost:20128";
const ROUTER_BASE = String(process.env.MITM_ROUTER_BASE || DEFAULT_LOCAL_ROUTER)
  .trim()
  .replace(/\/+$/, "") || DEFAULT_LOCAL_ROUTER;
const API_KEY = process.env.ROUTER_API_KEY;

// Headers that must not be forwarded to 9Router
const STRIP_HEADERS = new Set([
  "host", "content-length", "connection", "transfer-encoding",
  "content-type", "authorization"
]);

/**
 * Send body to 9Router at the given path and return the fetch Response object.
 * Optionally forwards client headers (stripped of hop-by-hop / overridden keys).
 */
async function fetchRouter(openaiBody, path = "/v1/chat/completions", clientHeaders = {}) {
  const forwarded = {};
  for (const [k, v] of Object.entries(clientHeaders)) {
    if (!STRIP_HEADERS.has(k.toLowerCase())) forwarded[k] = v;
  }

  const response = await fetch(`${ROUTER_BASE}${path}`, {
    method: "POST",
    headers: {
      ...forwarded,
      "Content-Type": "application/json",
      ...(API_KEY && { "Authorization": `Bearer ${API_KEY}` })
    },
    body: JSON.stringify(openaiBody)
  });

  // Forward response as-is (status + body). pipeSSE will propagate status.
  return response;
}

/**
 * Pipe SSE stream from router directly to client response.
 * Optional dumper tees the stream into a debug file.
 */
async function pipeSSE(routerRes, res, dumper) {
  const ct = routerRes.headers.get("content-type") || "application/json";
  const status = routerRes.status || 200;
  const resHeaders = { "Content-Type": ct, "Cache-Control": "no-cache", "Connection": "keep-alive" };
  if (ct.includes("text/event-stream")) resHeaders["X-Accel-Buffering"] = "no";
  res.writeHead(status, resHeaders);
  if (dumper) dumper.writeHeader(routerRes.status, Object.fromEntries(routerRes.headers));

  if (!routerRes.body) {
    const text = await routerRes.text().catch(() => "");
    if (dumper) { dumper.writeChunk(text); dumper.end(); }
    res.end(text);
    return;
  }

  const reader = routerRes.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) { if (dumper) dumper.end(); res.end(); break; }
    if (dumper) dumper.writeChunk(value);
    res.write(decoder.decode(value, { stream: true }));
  }
}

/**
 * Pipe SSE stream from router, transforming each chunk through a user function.
 * Reads SSE data: lines, parses JSON, calls transformFn(parsed, state),
 * and writes returned SSE strings to the client response.
 *
 * @param {Response} routerRes - Fetch Response from 9Router
 * @param {http.ServerResponse} res - Client response
 * @param {Function} transformFn - (parsedChunk, state) => string|string[]|null
 * @param {object} state - Mutable state object shared across chunks and flush
 */
async function pipeTransformedSSE(routerRes, res, transformFn, state) {
  const ct = routerRes.headers.get("content-type") || "application/json";
  const resHeaders = { "Content-Type": ct, "Cache-Control": "no-cache", "Connection": "keep-alive" };
  if (ct.includes("text/event-stream")) resHeaders["X-Accel-Buffering"] = "no";
  res.writeHead(200, resHeaders);

  if (!routerRes.body) {
    res.end(await routerRes.text().catch(() => ""));
    return;
  }

  const reader = routerRes.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;

      if (process.env.DEBUG_MITM) {
        log(`[SSE in] ${data.slice(0, 200)}`);
      }

      try {
        const parsed = JSON.parse(data);
        const result = transformFn(parsed, state);
        if (result != null) {
          const outputs = Array.isArray(result) ? result : [result];
          for (const output of outputs) {
            if (process.env.DEBUG_MITM) {
              const len = output.length || output.byteLength || 0;
              log(`[write binary frame] (${len}B) first 20B: ${Array.from(output.slice(0, 20)).join(',')}`);
            }
            res.write(Buffer.from(output));
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  // Flush: pass null to signal stream end
  try {
    const flushed = transformFn(null, state);
    if (flushed != null) {
      const outputs = Array.isArray(flushed) ? flushed : [flushed];
      for (const output of outputs) {
        res.write(output);
      }
    }
  } catch { /* ignore flush errors */ }

  res.end();
}

/**
 * Pipe SSE stream from router, transforming each chunk through a user function,
 * and writing binary EventStream frames to the client.
 *
 * Reads SSE data: lines, parses JSON, calls transformFn(parsed, state),
 * and writes returned Uint8Array frames to the client response.
 *
 * @param {Response} routerRes - Fetch Response from 9Router
 * @param {http.ServerResponse} res - Client response
 * @param {Function} transformFn - (parsedChunk, state) => Uint8Array|Uint8Array[]|null
 * @param {object} state - Mutable state object shared across chunks and flush
 */
async function pipeTransformedEventStream(routerRes, res, transformFn, state) {
  const resHeaders = {
    "Content-Type": "application/vnd.amazon.eventstream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  };

  // Upstream error: emit a parseable exception frame so Kiro shows the real
  // provider error instead of "Truncated event message received".
  if (!routerRes.ok) {
    const message = await _readErrorMessage(routerRes);
    err(`[MITM] upstream ${routerRes.status}: ${message}`);
    res.writeHead(200, resHeaders);
    try { res.write(buildExceptionFrame(`[${routerRes.status}] ${message}`)); } catch (e) { err(`[MITM] exception frame write failed: ${e.message}`); }
    res.end();
    return;
  }

  res.writeHead(200, resHeaders);

  if (!routerRes.body) {
    res.end(await routerRes.text().catch(() => ""));
    return;
  }

  const reader = routerRes.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;

      if (process.env.DEBUG_MITM) {
        log(`[SSE in] ${data.slice(0, 200)}`);
      }

      try {
        const parsed = JSON.parse(data);
        const result = transformFn(parsed, state);
        if (result != null) {
          const outputs = Array.isArray(result) ? result : [result];
          for (const output of outputs) {
            if (process.env.DEBUG_MITM) {
              const len = output.length || output.byteLength || 0;
              log(`[write binary frame] (${len}B) first 20B: ${Array.from(output.slice(0, 20)).join(',')}`);
            }
            res.write(Buffer.from(output));
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  // Flush: pass null to signal stream end
  try {
    const flushed = transformFn(null, state);
    if (flushed != null) {
      const outputs = Array.isArray(flushed) ? flushed : [flushed];
      for (const output of outputs) {
        res.write(output);
      }
    }
  } catch { /* ignore flush errors */ }

  res.end();
}

module.exports = { fetchRouter, pipeSSE, pipeTransformedSSE, pipeTransformedEventStream };