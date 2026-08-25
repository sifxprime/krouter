import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { withRedaction } from "@/middleware/redaction/index.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/responses/compact - Compact conversation context
 * Reuses the same handleChat pipeline, signals compact via body._compact
 *
 * Wrapped with redaction middleware to automatically redact PII from
 * request messages before passing to the chat handler.
 *
 * Security: Redaction fails-closed by default. If the redaction service
 * is unavailable, requests are rejected with 503 Service Unavailable.
 *
 * Middleware configuration (via environment variables):
 * - SIDECAR_URL: URL of Presidio sidecar (default: http://presidio-sidecar:5001/redact)
 * - REDACTION_ENABLED: Set to "false" to disable redaction (default: true)
 * - REDACTION_FAIL_OPEN: Set to "true" to allow requests to proceed on redaction failure (NOT RECOMMENDED - default: false)
 */
export const POST = withRedaction(async (request) => {
  await ensureInitialized();
  const body = await request.json();
  body._compact = true;
  const newRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body)
  });
  return await handleChat(newRequest);
});
