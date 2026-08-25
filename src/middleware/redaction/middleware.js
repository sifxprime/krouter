/**
 * Redaction Middleware for kRouter
 *
 * This middleware intercepts incoming chat completion requests,
 * extracts text from messages, sends them to the Presidio sidecar
 * for PII redaction, and modifies the request body before passing
 * it to the main handler.
 *
 * Redaction is only performed when BOTH of these are true:
 * 1. The REDACTION_ENABLED environment variable is set (static config)
 * 2. The presidioEnabled and presidioPiiRedaction toggles are true (dynamic settings)
 */

/**
 * Cached enablement decision.
 *
 * getSettings() is an uncached SQLite read and this middleware sits in front of
 * every LLM route, so calling it per request puts the database back on the hot
 * path that the in-memory HealthCache exists to keep it off. Caching only the
 * boolean decision here leaves the other ~48 getSettings() call sites untouched,
 * so a toggle anywhere else in the dashboard still applies immediately.
 *
 * TTL matches src/shared/services/healthCache.js.
 */
const SETTINGS_CACHE_TTL_MS = 10 * 1000;
let _redactionOn = null;      // null = never successfully read
let _redactionOnAt = 0;

/** Exposed for tests, and lets a settings write invalidate immediately. */
export function invalidateRedactionSettingsCache() {
  _redactionOn = null;
  _redactionOnAt = 0;
}

/**
 * Create a redaction middleware that calls the Presidio sidecar
 *
 * @param {Object} options - Middleware options
 * @param {string} options.sidecarUrl - URL of the Presidio sidecar (e.g., "http://presidio-sidecar:5001/redact")
 * @param {number} options.timeout - Request timeout in milliseconds (default: 2000)
 * @param {boolean} options.enabled - Whether redaction is enabled (default: true)
 * @param {boolean} options.failOpen - If true, continue with original request on redaction failure (default: false for security)
 * @returns {Function} Middleware function
 */
export function createRedactionMiddleware(options = {}) {
  const {
    sidecarUrl = process.env.SIDECAR_URL || "http://presidio-sidecar:5001/redact",
    // Presidio analyses each text in a serial spaCy loop, so the time scales
    // with total conversation size, not request count. A fixed 2s ceiling meant
    // enabling redaction 503'd any large-context client. Overridable, and the
    // default is generous enough to survive a long thread.
    timeout = Number(process.env.REDACTION_TIMEOUT_MS) || 15000,
    enabled = process.env.REDACTION_ENABLED !== "false",
    failOpen = process.env.REDACTION_FAIL_OPEN === "true", // Default to fail-closed for security
  } = options;

  return async function redactionMiddleware(request, handler) {
    // Skip redaction if disabled via environment variable
    if (!enabled) {
      return handler(request);
    }

    // Check dynamic settings - only redact if both toggles are enabled.
    if (Date.now() - _redactionOnAt > SETTINGS_CACHE_TTL_MS) {
      try {
        const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
        const settings = await getSettings();
        _redactionOn = !!(settings.presidioEnabled && settings.presidioPiiRedaction);
        _redactionOnAt = Date.now();
      } catch (error) {
        console.error("[Redaction Middleware] Failed to read settings:", error);

        // Fail closed only for users who actually turned redaction ON. If it was
        // never enabled (_redactionOn === null) or was last seen off, a
        // settings-read failure must not 500 their requests -- that would break
        // traffic to protect data they never asked us to protect.
        if (_redactionOn === true && !failOpen) {
          return new Response(
            JSON.stringify({
              error: {
                message: "Unable to verify redaction settings",
                code: "SETTINGS_ERROR",
                type: "settings_error"
              }
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" }
            }
          );
        }
        return handler(request);
      }
    }

    if (!_redactionOn) {
      return handler(request);
    }

    // Only process POST requests with a body
    if (request.method !== "POST") {
      return handler(request);
    }

    try {
      // Clone the request to read the body
      const body = await request.clone().json();

      // Extract text from every field that can carry user content.
      //
      // This used to return early unless body.messages existed, which made
      // redaction a silent no-op on /v1/responses and /v1/responses/compact --
      // the Responses API carries content in `input`/`instructions`, not
      // `messages` -- while the dashboard still reported redaction as on. The
      // Anthropic top-level `system` prompt was missed for the same reason.
      const textsToRedact = [];
      const textPaths = []; // Track where each text came from

      // Chat Completions / Anthropic Messages: body.messages[]
      if (Array.isArray(body.messages)) {
        for (let i = 0; i < body.messages.length; i++) {
          const msg = body.messages[i];
          const content = msg?.content;

          if (!content) continue;

          // Handle string content
          if (typeof content === "string") {
            textsToRedact.push(content);
            textPaths.push({ type: "string", index: i });
          }
          // Handle array content (e.g., multimodal messages with text blocks)
          else if (Array.isArray(content)) {
            for (let j = 0; j < content.length; j++) {
              const block = content[j];
              if (block?.type === "text" && typeof block?.text === "string") {
                textsToRedact.push(block.text);
                textPaths.push({ type: "array", msgIndex: i, blockIndex: j });
              }
            }
          }
        }
      }

      // Anthropic Messages: top-level `system` (string or block array).
      if (typeof body.system === "string") {
        textsToRedact.push(body.system);
        textPaths.push({ type: "system-string" });
      } else if (Array.isArray(body.system)) {
        for (let j = 0; j < body.system.length; j++) {
          const block = body.system[j];
          if (block?.type === "text" && typeof block?.text === "string") {
            textsToRedact.push(block.text);
            textPaths.push({ type: "system-block", blockIndex: j });
          }
        }
      }

      // Responses API: `instructions` is the system-prompt equivalent.
      if (typeof body.instructions === "string") {
        textsToRedact.push(body.instructions);
        textPaths.push({ type: "instructions" });
      }

      // Responses API: `input` is either a bare string or an array of items
      // whose content blocks are input_text / output_text (not `text`).
      if (typeof body.input === "string") {
        textsToRedact.push(body.input);
        textPaths.push({ type: "input-string" });
      } else if (Array.isArray(body.input)) {
        for (let i = 0; i < body.input.length; i++) {
          const item = body.input[i];
          const content = item?.content;
          if (typeof content === "string") {
            textsToRedact.push(content);
            textPaths.push({ type: "input-item-string", index: i });
          } else if (Array.isArray(content)) {
            for (let j = 0; j < content.length; j++) {
              const block = content[j];
              const isText =
                block?.type === "input_text" ||
                block?.type === "output_text" ||
                block?.type === "text";
              if (isText && typeof block?.text === "string") {
                textsToRedact.push(block.text);
                textPaths.push({ type: "input-item-block", itemIndex: i, blockIndex: j });
              }
            }
          }
        }
      }

      // Skip if no text to redact
      if (textsToRedact.length === 0) {
        return handler(request);
      }

      // Call sidecar for redaction
      const redactedTexts = await callSidecar(sidecarUrl, textsToRedact, { timeout });

      // Inject redacted text back into the request
      let textIndex = 0;
      for (const path of textPaths) {
        if (path.type === "string") {
          body.messages[path.index].content = redactedTexts[textIndex];
        } else if (path.type === "array") {
          body.messages[path.msgIndex].content[path.blockIndex].text = redactedTexts[textIndex];
        } else if (path.type === "system-string") {
          body.system = redactedTexts[textIndex];
        } else if (path.type === "system-block") {
          body.system[path.blockIndex].text = redactedTexts[textIndex];
        } else if (path.type === "instructions") {
          body.instructions = redactedTexts[textIndex];
        } else if (path.type === "input-string") {
          body.input = redactedTexts[textIndex];
        } else if (path.type === "input-item-string") {
          body.input[path.index].content = redactedTexts[textIndex];
        } else if (path.type === "input-item-block") {
          body.input[path.itemIndex].content[path.blockIndex].text = redactedTexts[textIndex];
        }
        textIndex++;
      }

      // Create a new request with the modified body
      const modifiedRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(body),
      });

      // Continue with the modified request
      return handler(modifiedRequest);
    } catch (error) {
      // Fail-closed by default for security, unless failOpen is explicitly set
      const errorMessage = `[Redaction Middleware] Error: ${error.message}`;
      console.error(errorMessage);

      // If failOpen is explicitly enabled (not recommended for production), continue with original request
      if (failOpen) {
        console.warn("[Redaction Middleware] Fail-open enabled - proceeding with original request");
        return handler(request);
      }

      // Fail-closed: reject the request with appropriate error response
      let statusCode = 500;
      let errorType = "internal_error";
      let userMessage = "Request processing failed";

      // Categorize errors for better debugging
      if (error.name === 'AbortError' || error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
        statusCode = 503;
        errorType = "redaction_timeout";
        userMessage = "PII redaction service unavailable. Please try again later.";
      } else if (
        error.message.includes('fetch') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('ECONNRESET') ||
        error.name === 'TypeError' && error.message.includes('fetch')
      ) {
        statusCode = 503;
        errorType = "redaction_service_unavailable";
        userMessage = "PII redaction service unavailable. Please try again later.";
      } else if (
        error.message.includes('redact') ||
        error.message.includes('sidecar') ||
        error.message.includes('HTTP 5')
      ) {
        statusCode = 502;
        errorType = "redaction_service_error";
        userMessage = "PII redaction service error. Please try again later.";
      } else if (error.message.includes('Invalid') || error.message.includes('format')) {
        statusCode = 400;
        errorType = "invalid_request";
        userMessage = "Invalid request format.";
      }

      // Log structured error for monitoring
      const logEntry = {
        timestamp: new Date().toISOString(),
        event: "redaction_failure",
        errorType,
        errorMessage: error.message,
        statusCode,
        path: new URL(request.url).pathname,
        method: request.method
      };
      console.error(JSON.stringify(logEntry));

      return new Response(
        JSON.stringify({
          error: {
            message: userMessage,
            code: errorType.toUpperCase(),
            type: errorType,
            requestId: request.headers.get("x-request-id") || undefined
          }
        }),
        {
          status: statusCode,
          headers: {
            "Content-Type": "application/json",
            "X-Redaction-Failed": "true"
          }
        }
      );
    }
  };
}

/**
 * Call the Presidio sidecar to redact text
 *
 * @param {string} url - Sidecar URL
 * @param {string[]} texts - Texts to redact
 * @param {Object} options - Fetch options
 * @param {number} options.timeout - Request timeout in milliseconds
 * @returns {Promise<string[]>} Redacted texts
 */
async function callSidecar(url, texts, { timeout = 2000 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Sidecar redaction service error: HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.redacted_texts || !Array.isArray(data.redacted_texts)) {
      throw new Error("Sidecar redaction service returned invalid response");
    }

    if (data.redacted_texts.length !== texts.length) {
      throw new Error("Sidecar redaction service returned wrong number of redacted texts");
    }

    return data.redacted_texts;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Wrap a Next.js route handler with redaction middleware
 *
 * @param {Function} handler - The original route handler
 * @param {Object} options - Middleware options
 * @param {boolean} [options.failOpen] - If true, continue with original request on redaction failure. Default is false (fail-closed for security).
 * @returns {Function} Wrapped handler
 */
export function withRedaction(handler, options = {}) {
  const middleware = createRedactionMiddleware(options);

  return async function wrappedHandler(request, ...args) {
    return middleware(request, (req) => handler(req, ...args));
  };
}
