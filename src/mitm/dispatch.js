const { MODEL_NO_MAP, getToolForHost, isChatRequest } = require("./config");
const { getMappedModel } = require("./modelMap");
const { decodeRequestBody } = require("./bodyCodec");

// 0.5.175 — One routing decision, two transports.
//
// This logic used to live inline in the https.createServer callback in server.js.
// The proxy capture mode (proxy.js) has to reach exactly the same verdict for the
// same request, and a second copy of it would drift: every MITM bug worth shipping
// a release for -- the alias-map ordering in 0.5.169, the Claude ladder, the
// gzip bodies in 0.5.174 -- was a bug in this decision. Keeping one copy is also
// the only way to test it, since server.js opens a TLS listener on require.

const INTERNAL_REQUEST_HEADER = { name: "x-request-source", value: "local" };

/** Detect binary data vs JSON text (AWS EventStream, protobuf, ...). */
function isBinaryData(buffer) {
  if (!buffer || buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(100, buffer.length));
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) nonPrintable++;
    if (byte > 0x7e) nonPrintable++;
  }
  return nonPrintable / sample.length > 0.3;
}

/** Model from the URL path (Gemini), the body (OpenAI/Anthropic), or Kiro's conversationState. */
function extractModel(url, body) {
  const urlMatch = String(url || "").match(/\/models\/([^/:]+)/);
  if (urlMatch) return urlMatch[1];
  if (isBinaryData(body)) return null;
  try {
    const parsed = JSON.parse(body.toString());
    if (parsed.conversationState) {
      return parsed.conversationState.currentMessage?.userInputMessage?.modelId || null;
    }
    return parsed.model || null;
  } catch {
    return null;
  }
}

/**
 * Decide what to do with one intercepted request. Pure: no sockets, no I/O
 * beyond reading the saved alias map, so both transports can call it and tests
 * can drive it directly.
 *
 * `body` is the decoded body the handler should parse. Callers must still send
 * the ORIGINAL bytes on passthrough, because passthrough forwards the client's
 * own headers and those still say gzip.
 *
 * @returns {{action: "passthrough"|"intercept", reason: string, tool: string|null,
 *            model: string|null, mappedModel: string|null, body: Buffer}}
 */
function decideRoute(req, bodyBuffer) {
  const pass = (reason, extra = {}) => ({
    action: "passthrough", reason, tool: null, model: null, mappedModel: null,
    body: bodyBuffer, ...extra,
  });

  // Anti-loop: kRouter's own outbound requests must never be re-intercepted.
  if (req.headers?.[INTERNAL_REQUEST_HEADER.name] === INTERNAL_REQUEST_HEADER.value) {
    return pass("internal-request");
  }

  const tool = getToolForHost(req.headers?.host);
  if (!tool) return pass("host-not-intercepted");
  if (!isChatRequest(tool, req)) return pass("not-a-chat-request", { tool });

  // Cursor speaks binary proto; its handler decodes the payload itself.
  if (tool === "cursor") {
    return { action: "intercept", reason: "cursor-proto", tool, model: null, mappedModel: null, body: bodyBuffer };
  }

  const body = decodeRequestBody(bodyBuffer, req.headers || {});
  const model = extractModel(req.url, body);

  // Deliberate: some models must stay native (Antigravity tab-autocomplete fires
  // per keystroke and is latency-critical). Not a leak. See MODEL_NO_MAP.
  if (model && (MODEL_NO_MAP[tool] || []).some((re) => re.test(model))) {
    return pass("model-pinned-native", { tool, model });
  }

  const mappedModel = getMappedModel(tool, model);
  if (!mappedModel) return pass("no-mapping", { tool, model, body });

  return { action: "intercept", reason: "mapped", tool, model, mappedModel, body };
}

module.exports = { decideRoute, extractModel, isBinaryData, INTERNAL_REQUEST_HEADER };
