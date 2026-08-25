import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";
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
 * POST /v1/api/chat - Ollama-compatible chat endpoint
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
  
  const clonedReq = request.clone();
  let modelName = "llama3.2";
  try {
    const body = await clonedReq.json();
    modelName = body.model || "llama3.2";
  } catch {}

  const response = await handleChat(request);
  return transformToOllama(response, modelName);
});

