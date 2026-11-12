import { MITM_TOOL_HEADER, normalizeMitmTool } from "@/shared/constants/mitmToolHosts";

/**
 * The tool a captured request came from, or null for a direct caller.
 *
 * `clientRawRequest.headers` is the client's own header bag, captured in
 * handlers/chat.js. Some callers build that object themselves and omit headers,
 * so every lookup here is optional — a missing bag means "not from the MITM",
 * which is the right answer for anything that called /v1/* directly.
 *
 * Header names arrive lower-cased from `request.headers.entries()`, but a
 * hand-built bag may not be normalised, so check both rather than trusting one.
 */
export function mitmToolFromRequest(clientRawRequest) {
  const headers = clientRawRequest?.headers;
  if (!headers || typeof headers !== "object") return null;

  const direct = headers[MITM_TOOL_HEADER];
  if (direct != null) return normalizeMitmTool(direct);

  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === MITM_TOOL_HEADER) return normalizeMitmTool(v);
  }
  return null;
}
