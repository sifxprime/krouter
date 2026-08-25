# Code Review: Redaction Middleware Implementation

**Review Date:** $(date +%Y-%m-%d)
**Review Scope:** PII redaction middleware implementation across kRouter endpoints
**Security Focus:** PII protection, fail-open behavior, input validation, error handling
**Code Quality Focus:** Consistency, maintainability, edge case handling

---

## Executive Summary

**Overall Assessment:** ⚠️ **Needs Improvements**

The redaction middleware implementation is functional and successfully redacts PII from request messages. However, there are **critical security concerns** and code quality issues that should be addressed before production use.

**Critical Issues:** 1
**High Priority:** 3
**Medium Priority:** 4
**Low Priority:** 2

---

## 🔴 Critical Issues

### 1. Fail-Open Behavior is a Security Risk

**Location:** `src/middleware/redaction/middleware.js:84-86`

```javascript
} catch (error) {
  // Fail open: if redaction fails, continue with original request
  console.error("[Redaction Middleware] Error:", error.message);
  return handler(request);  // ❌ SECURITY ISSUE
}
```

**Problem:** When redaction fails for ANY reason (sidecar down, timeout, network error, malformed response), the request passes through UNREDACTED. This is a **silent security failure**.

**Attack Vector:** An attacker could:
1. Flood the Presidio sidecar with requests to cause it to become unresponsive
2. Manipulate DNS/network to prevent sidecar communication
3. Send malformed requests that trigger exceptions
4. Result: All subsequent PII bypasses redaction

**Evidence:** The user initially had redaction not working, and the middleware silently failed to redact. The issue was only discovered through manual testing.

**Recommended Fix:**

```javascript
} catch (error) {
  // Fail closed: if redaction fails, reject the request
  console.error("[Redaction Middleware] Error:", error.message);

  // Check if this is a timeout or network error
  if (error.name === 'AbortError' || error.message.includes('fetch')) {
    // Redaction service unavailable
    return new Response(
      JSON.stringify({
        error: {
          message: "PII redaction service unavailable. Please try again later.",
          code: "REDACTION_SERVICE_ERROR",
          type: "service_unavailable"
        }
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  // Other errors - fail safe
  return new Response(
    JSON.stringify({
      error: {
        message: "Request processing failed",
        code: "INTERNAL_ERROR",
        type: "internal_error"
      }
    }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
}
```

**Alternative:** Add a configuration option for fail-open vs fail-closed, but **default to fail-closed**.

---

## 🟠 High Priority Issues

### 2. No Rate Limiting on Redaction Endpoint

**Location:** `src/middleware/redaction/middleware.js` (callSidecar function)

**Problem:** The sidecar can be flooded with requests, causing:
- Denial of service for legitimate users
- Exhaustion of Presidio resources
- Potential to trigger fail-open behavior

**Recommended Fix:**

```javascript
// Add rate limiting using in-memory counter or Redis
const rateLimiter = new Map(); // Map<userId, {count, resetTime}>

async function checkRateLimit(userId) {
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxRequests = 100;

  const user = rateLimiter.get(userId) || { count: 0, resetTime: now + windowMs };

  if (now > user.resetTime) {
    // Reset window
    user.count = 1;
    user.resetTime = now + windowMs;
  } else {
    user.count++;
  }

  rateLimiter.set(userId, user);

  if (user.count > maxRequests) {
    throw new Error("Rate limit exceeded");
  }
}
```

### 3. Sidecar URL Can Be Manipulated via Environment Variable

**Location:** `src/middleware/redaction/middleware.js:17`

```javascript
sidecarUrl = process.env.SIDECAR_URL || "http://presidio-sidecar:5001/redact",
```

**Problem:** While environment variables are typically secure, an attacker with code execution could:
- Set `SIDECAR_URL` to a malicious server
- Send all PII to an attacker-controlled endpoint

**Recommended Fix:**

```javascript
// Validate sidecar URL is from allowed domains
const ALLOWED_SIDECAR_DOMAINS = [
  'http://presidio-sidecar:5001',
  'http://localhost:5001',
  'https://presidio.internal.yourdomain.com'
];

function validateSidecarUrl(url) {
  try {
    const parsed = new URL(url);
    const origin = `${parsed.protocol}//${parsed.host}`;
    if (!ALLOWED_SIDECAR_DOMAINS.includes(origin)) {
      throw new Error(`Invalid sidecar URL: ${url}`);
    }
    return url;
  } catch (e) {
    throw new Error(`Invalid sidecar URL format: ${url}`);
  }
}

// In createRedactionMiddleware:
const {
  sidecarUrl = validateSidecarUrl(
    process.env.SIDECAR_URL || "http://presidio-sidecar:5001/redact"
  ),
  ...
} = options;
```

### 4. Inconsistent Middleware Application Pattern

**Location:** Multiple files

**Problem:** The `v1beta/models/[...path]/route.js` uses a different pattern:

```javascript
// Other files (correct pattern):
export const POST = withRedaction(async (request) => {
  return await handleChat(request);
});

// v1beta (inconsistent pattern):
let redactionMiddleware = null;
// ... in POST handler:
const redactedRequest = await redactionMiddleware(newRequest, (req) => req);
```

**Issues:**
1. Middleware state stored globally (`let redactionMiddleware = null`)
2. Middleware applied AFTER request transformation instead of BEFORE
3. Redaction happens on the converted request, not the original
4. Inconsistent with other endpoints

**Recommended Fix:**

```javascript
// Apply withRedaction at the export level, like other endpoints
export const POST = withRedaction(async (request, { params }) => {
  await ensureInitialized();

  try {
    const { path } = await params;
    // ... existing conversion logic ...

    const newRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(convertedBody),
    });

    // The withRedaction wrapper will handle redaction before calling this handler
    // But we need to ensure redaction happens on the converted body
    // This requires a different approach - see recommendation below
  }
}, {
  // Options for middleware
  skipRedaction: false // or similar flag
});
```

**Better Approach for v1beta:** Move format conversion OUTSIDE the redaction layer, or implement a two-phase middleware that handles format conversion then redaction.

---

## 🟡 Medium Priority Issues

### 5. No Logging/Telemetry for Redaction Failures

**Location:** `src/middleware/redaction/middleware.js:84-86`

**Problem:** When redaction fails, only `console.error` is called. No:
- Structured logging
- Metrics/counters
- Alerting
- Audit trail

**Recommended Fix:**

```javascript
import { logSecurityEvent } from "@/lib/telemetry.js";

} catch (error) {
  console.error("[Redaction Middleware] Error:", error.message);

  // Log security event for monitoring
  await logSecurityEvent({
    event: "redaction_failure",
    error: error.message,
    requestId: request.headers.get("x-request-id"),
    timestamp: new Date().toISOString(),
    severity: "high"
  });

  // ... rest of error handling
}
```

### 6. No Request Size Limits

**Location:** `src/middleware/redaction/middleware.js`

**Problem:** Large requests could:
- Exhaust memory
- Cause timeout in sidecar
- Trigger fail-open behavior

**Recommended Fix:**

```javascript
const MAX_REQUEST_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_LENGTH = 100000; // 100K characters per text

// After parsing body:
const contentLength = request.headers.get("content-length");
if (contentLength && parseInt(contentLength) > MAX_REQUEST_SIZE) {
  return new Response(
    JSON.stringify({ error: "Request too large" }),
    { status: 413, headers: { "Content-Type": "application/json" } }
  );
}

// Before calling sidecar:
if (textsToRedact.some(t => t.length > MAX_TEXT_LENGTH)) {
  throw new Error("Text exceeds maximum length");
}
```

### 7. No Validation of Sidecar Response Structure

**Location:** `src/middleware/redaction/middleware.js:124-127`

```javascript
if (!data.redacted_texts || !Array.isArray(data.redacted_texts)) {
  throw new Error("Invalid response from sidecar");
}
```

**Problem:** This is good, but doesn't validate:
- Each element in `redacted_texts` is a string
- No null/undefined values in array
- No excessive length in redacted texts

**Recommended Fix:**

```javascript
if (!data.redacted_texts || !Array.isArray(data.redacted_texts)) {
  throw new Error("Invalid response from sidecar: missing redacted_texts array");
}

if (data.redacted_texts.length !== texts.length) {
  throw new Error(`Sidecar returned ${data.redacted_texts.length} texts, expected ${texts.length}`);
}

// Validate each redacted text
for (let i = 0; i < data.redacted_texts.length; i++) {
  const text = data.redacted_texts[i];
  if (typeof text !== "string") {
    throw new Error(`Invalid redacted text at index ${i}: expected string, got ${typeof text}`);
  }
  if (text.length > MAX_TEXT_LENGTH * 2) { // Redaction shouldn't double text size
    throw new Error(`Redacted text at index ${i} exceeds maximum length`);
  }
}
```

### 8. Error Messages Leak Implementation Details

**Location:** Multiple error messages

**Problem:** Error messages like "Sidecar returned 500" or "Invalid response from sidecar" leak internal implementation details to users.

**Recommended Fix:**

```javascript
// Instead of:
throw new Error(`Sidecar returned ${response.status}`);

// Use:
throw new Error("Redaction service error");

// Or use error codes that map to user-friendly messages
const ERROR_MESSAGES = {
  SERVICE_UNAVAILABLE: "Redaction service temporarily unavailable",
  TIMEOUT: "Redaction request timed out",
  INVALID_RESPONSE: "Redaction service returned invalid response",
  RATE_LIMITED: "Too many requests, please try again later"
};
```

---

## 🔵 Low Priority Issues

### 9. No Timeout Configuration Per Request Type

**Location:** `src/middleware/redaction/middleware.js:18`

```javascript
timeout = 2000,
```

**Problem:** 2 second timeout is hardcoded. Long documents or complex redactions might timeout unnecessarily.

**Recommended Fix:**

```javascript
timeout = options.timeout || process.env.REDACTION_TIMEOUT || 2000,
```

### 10. Inconsistent Documentation Style

**Location:** Multiple files

**Problem:** JSDoc comments are inconsistent:
- Some have detailed examples, others don't
- `@param` types sometimes missing
- `@returns` descriptions inconsistent

**Example of good documentation:**

```javascript
/**
 * Create a redaction middleware that calls the Presidio sidecar
 *
 * @param {Object} options - Middleware configuration options
 * @param {string} [options.sidecarUrl] - URL of the Presidio sidecar.
 *                                        Defaults to SIDECAR_URL env var or
 *                                        "http://presidio-sidecar:5001/redact"
 * @param {number} [options.timeout=2000] - Request timeout in milliseconds
 * @param {boolean} [options.enabled=true] - Whether redaction is enabled.
 *                                            Can be overridden by REDACTION_ENABLED env var
 * @returns {function(request: Request, handler: function): Promise<Response>}
 *          Middleware function that can be used to wrap route handlers
 *
 * @example
 * const wrappedHandler = withRedaction(originalHandler, {
 *   sidecarUrl: "http://localhost:5001/redact",
 *   timeout: 5000
 * });
 *
 * @throws {Error} If options are invalid
 */
export function createRedactionMiddleware(options = {}) {
  // ...
}
```

---

## 📊 Code Quality Assessment

### Consistency Score: 6/10

**Good:**
- All chat endpoints now use `withRedaction` wrapper
- Consistent error handling structure

**Needs Improvement:**
- v1beta endpoint uses different pattern
- Some endpoints have detailed JSDoc, others minimal

### Maintainability Score: 7/10

**Good:**
- Middleware is modular and reusable
- Clear separation of concerns
- Environment variable configuration

**Needs Improvement:**
- Global state in v1beta endpoint
- Inconsistent middleware application patterns

### Security Score: 4/10

**Good:**
- Redaction actually works
- Input validation exists
- Timeout protection

**Critical Issues:**
- Fail-open behavior is dangerous
- No rate limiting
- URL validation missing

---

## ✅ What Was Done Well

1. **Middleware is properly modular** - `createRedactionMiddleware` and `withRedaction` are well-designed
2. **Supports multimodal messages** - Handles both string and array content formats
3. **Timeout protection** - Uses AbortController for timeout handling
4. **Environment variable configuration** - Easy to configure via env vars
5. **Comprehensive testing** - Unit tests cover most scenarios (though they mock the sidecar)
6. **Fail-safe request cloning** - Uses `request.clone()` to avoid consuming the stream

---

## 🎯 Recommended Action Plan

### Immediate (Before Production)

1. **[CRITICAL]** Change fail-open to fail-closed behavior
2. **[HIGH]** Add sidecar URL validation
3. **[HIGH]** Fix v1beta endpoint consistency

### Short Term (Next Sprint)

4. Add rate limiting
5. Improve logging and telemetry
6. Add request size limits
7. Better error messages (no implementation details)

### Long Term (Backlog)

8. Per-request timeout configuration
9. Standardize JSDoc documentation
10. Add integration tests with real Presidio instance
11. Add metrics dashboard for redaction success/failure rates

---

## 📝 Specific File Changes Review

### `src/app/api/v1/chat/completions/route.js`
- ✅ Clean implementation
- ✅ Good documentation
- ✅ Consistent with other endpoints

### `src/app/api/v1/api/chat/route.js`
- ✅ Clean implementation
- ✅ Good documentation
- ✅ Consistent with other endpoints

### `src/app/api/v1/messages/route.js`
- ✅ Already had redaction
- ✅ No issues

### `src/app/api/v1/responses/route.js`
- ✅ Clean implementation
- ✅ Good documentation

### `src/app/api/v1/responses/compact/route.js`
- ✅ Clean implementation
- ✅ Good documentation
- ✅ Redaction applied before compact flag is set

### `src/app/api/v1beta/models/[...path]/route.js`
- ❌ **PROBLEMATIC** - Uses different pattern
- ❌ Global state for middleware
- ❌ Redaction applied after format conversion
- **Recommendation:** Refactor to match other endpoints

### `src/middleware/redaction/middleware.js`
- ⚠️ **Needs Security Improvements** - See critical issues above
- ✅ Well-structured overall
- ✅ Good modularity

---

## 🔒 Security Checklist

- [ ] Fail-closed behavior (not fail-open)
- [ ] Sidecar URL validation
- [ ] Rate limiting on redaction requests
- [ ] Request size limits
- [ ] Timeout configuration
- [ ] Structured logging of security events
- [ ] Input validation on sidecar response
- [ ] No sensitive data in error messages
- [ ] Audit trail for redaction failures
- [ ] Integration tests with real sidecar

---

## Summary

The redaction middleware **works functionally** but has **critical security gaps** that must be addressed before production deployment. The most important fix is changing from fail-open to fail-closed behavior to prevent silent security failures.

**Recommended:** Address the critical and high-priority issues before merging to main branch or deploying to production.
