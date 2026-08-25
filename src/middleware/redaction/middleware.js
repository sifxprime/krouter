/**
 * Redaction Middleware for kRouter
 *
 * This middleware intercepts incoming chat completion requests,
 * extracts text from messages, sends them to the Presidio sidecar
 * for PII redaction, and modifies the request body before passing
 * it to the main handler.
 */

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
    timeout = 2000,
    enabled = process.env.REDACTION_ENABLED !== "false",
    failOpen = process.env.REDACTION_FAIL_OPEN === "true", // Default to fail-closed for security
  } = options;

  return async function redactionMiddleware(request, handler) {
    // Skip redaction if disabled
    if (!enabled) {
      return handler(request);
    }

    // Only process POST requests with a body
    if (request.method !== "POST") {
      return handler(request);
    }

    try {
      // Clone the request to read the body
      const body = await request.clone().json();

      // Skip if no messages array
      if (!body.messages || !Array.isArray(body.messages)) {
        return handler(request);
      }

      // Extract text from all messages
      const textsToRedact = [];
      const textPaths = []; // Track where each text came from

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
      } else if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
        statusCode = 503;
        errorType = "redaction_service_unavailable";
        userMessage = "PII redaction service unavailable. Please try again later.";
      } else if (error.message.includes('redact') || error.message.includes('sidecar')) {
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
      throw new Error(`Sidecar returned ${response.status}`);
    }

    const data = await response.json();

    if (!data.redacted_texts || !Array.isArray(data.redacted_texts)) {
      throw new Error("Invalid response from sidecar");
    }

    if (data.redacted_texts.length !== texts.length) {
      throw new Error("Sidecar returned wrong number of redacted texts");
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
