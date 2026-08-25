# Test Suite Update Report

**Date:** 2025-01-10
**Component:** Redaction Middleware
**Test File:** `src/middleware/redaction/tests/middleware.test.js`
**Status:** ✅ All tests passing

---

## Executive Summary

Updated the redaction middleware test suite to align with the fail-closed security behavior implemented in production. All 25 tests now pass successfully, validating that the middleware properly rejects requests when redaction fails instead of silently allowing PII through.

---

## Changes Made

### 1. Updated Test Header Documentation

**Before:**
```javascript
/**
 * Unit tests for Redaction Middleware
 *
 * Tests cover:
- Text extraction from various message formats
- Sidecar call with proper request format
- Redacted text injection back into request
- Empty/invalid input handling
- Error handling and fail-open behavior
- Environment variable configuration
 */
```

**After:**
```javascript
/**
 * Unit tests for Redaction Middleware
 *
 * Tests cover:
- Text extraction from various message formats
- Sidecar call with proper request format
- Redacted text injection back into request
- Empty/invalid input handling
- Error handling and fail-CLOSED behavior (default for security)
- Error handling and fail-OPEN behavior (for compatibility/testing)
- Environment variable configuration
- Structured error responses
 */
```

---

### 2. Added Database Mock

Added a mock for the settings repository to prevent test failures due to database access:

```javascript
// Mock settings repository
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn().mockResolvedValue({
    presidioEnabled: true,
    presidioPiiRedaction: true,
    presidioCustomRegex: false,
  }),
}));
```

**Rationale:** The middleware attempts to read dynamic settings from the database before redacting. Without this mock, tests would fail with database connection errors.

---

### 3. Reorganized Error Handling Tests

Split error handling tests into two categories:

#### A. Fail-Closed Tests (Default Behavior - Security Focused)
- `should fail closed when sidecar returns error` → Returns 502 Bad Gateway
- `should fail closed when sidecar is unreachable` → Returns 503 Service Unavailable
- `should fail closed when sidecar times out` → Returns 503 Service Unavailable
- `should fail closed when response has invalid format` → Returns 502 Bad Gateway
- `should fail closed when sidecar returns wrong number of texts` → Returns 502 Bad Gateway
- `should return structured error response` → Validates error response structure

#### B. Fail-Open Tests (For Compatibility)
- `should fail open when configured` → Validates that fail-open still works when explicitly enabled

**Key Change:** Tests now verify that the handler is **NOT** called when redaction fails (fail-closed), instead of verifying it **IS** called (old fail-open behavior).

---

### 4. Updated Test Assertions

#### Example: Sidecar Error Test

**Before (Fail-Open):**
```javascript
it("should fail open when sidecar returns error", async () => {
  const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
  const middleware = createRedactionMiddleware({
    sidecarUrl: "http://test:5001/redact",
  });

  global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

  // ... setup request ...

  const result = await middleware(request, mockHandler);

  expect(mockHandler).toHaveBeenCalled(); // ❌ Expected to proceed
  expect(result).toBeInstanceOf(Response);
});
```

**After (Fail-Closed):**
```javascript
it("should fail closed when sidecar returns error", async () => {
  const mockHandler = vi.fn();
  const middleware = createRedactionMiddleware({
    sidecarUrl: "http://test:5001/redact",
    failOpen: false, // Explicit for clarity
  });

  global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

  // ... setup request ...

  const result = await middleware(request, mockHandler);

  expect(mockHandler).not.toHaveBeenCalled(); // ✅ Should NOT proceed
  expect(result).toBeInstanceOf(Response);
  expect(result.status).toBe(502); // Bad Gateway - service error
});
```

---

### 5. Improved Error Simulation

#### Network Error Test

**Before:**
```javascript
global.fetch.mockRejectedValueOnce(new Error("Network error"));
```

**After:**
```javascript
// Simulate ECONNREFUSED error
const error = new Error("fetch failed");
error.name = "TypeError";
global.fetch.mockRejectedValueOnce(error);
```

**Rationale:** The middleware's error categorization logic checks for specific error types and messages. Using `TypeError` with "fetch failed" ensures the error is properly categorized as a service unavailable error (503).

#### Timeout Test

**Before:**
```javascript
// Simulate timeout by never resolving
global.fetch.mockImplementationOnce(
  () =>
    new Promise((resolve) => {
      setTimeout(() => resolve({ ok: true, json: async () => ({ redacted_texts: ["test"] }) }), 500);
    })
);
```

**After:**
```javascript
// Simulate timeout - fetch throws AbortError when aborted
const abortError = new Error("The operation was aborted");
abortError.name = "AbortError";
global.fetch.mockRejectedValueOnce(abortError);
```

**Rationale:** The original test relied on actual timing, which is unreliable in test environments. By directly mocking an `AbortError`, we test the error handling logic without timing dependencies.

---

### 6. Added Structured Error Response Test

```javascript
it("should return structured error response", async () => {
  const mockHandler = vi.fn();
  const middleware = createRedactionMiddleware({
    sidecarUrl: "http://test:5001/redact",
    failOpen: false,
  });

  global.fetch.mockRejectedValueOnce(new Error("Network error"));

  // ... setup request ...

  const result = await middleware(request, mockHandler);
  const responseData = await result.json();

  expect(responseData).toHaveProperty("error");
  expect(responseData.error).toHaveProperty("message");
  expect(responseData.error).toHaveProperty("code");
  expect(responseData.error).toHaveProperty("type");
});
```

**Rationale:** Validates that error responses follow the structured format used for monitoring and alerting.

---

## Test Results

### Before Update
```
Test Files  1 failed (1)
     Tests  2 failed (2)
```

**Issues:**
1. Tests expected fail-open behavior (handler called on error)
2. Database settings not mocked → test failures
3. Mocked errors didn't match middleware error categorization logic

### After Update
```
Test Files  1 passed (1)
     Tests  25 passed (25)
   Start at  16:06:43
   Duration  214ms (transform 53ms, setup 0ms, import 66ms, tests 34ms, environment 0ms)
```

**Summary:** All 25 tests pass, covering:
- 5 text extraction tests
- 3 redacted text injection tests
- 6 fail-closed error handling tests
- 1 fail-open compatibility test
- 5 conditional processing tests
- 3 configuration tests
- 2 `withRedaction` wrapper tests

---

## Error Code Coverage

The updated tests validate the following HTTP status codes for redaction failures:

| Status Code | Error Type | Scenario |
|-------------|------------|----------|
| 502 | `redaction_service_error` | Sidecar returns non-2xx status |
| 502 | `redaction_service_error` | Sidecar returns invalid response format |
| 502 | `redaction_service_error` | Sidecar returns wrong number of redacted texts |
| 503 | `redaction_service_unavailable` | Network error / connection refused |
| 503 | `redaction_timeout` | Request timeout (AbortError) |

---

## Middleware Code Changes

### Updated Error Messages in `callSidecar()`

**Before:**
```javascript
if (!response.ok) {
  throw new Error(`Sidecar returned ${response.status}`);
}

if (!data.redacted_texts || !Array.isArray(data.redacted_texts)) {
  throw new Error("Invalid response from sidecar");
}

if (data.redacted_texts.length !== texts.length) {
  throw new Error("Sidecar returned wrong number of redacted texts");
}
```

**After:**
```javascript
if (!response.ok) {
  throw new Error(`Sidecar redaction service error: HTTP ${response.status}`);
}

if (!data.redacted_texts || !Array.isArray(data.redacted_texts)) {
  throw new Error("Sidecar redaction service returned invalid response");
}

if (data.redacted_texts.length !== texts.length) {
  throw new Error("Sidecar redaction service returned wrong number of redacted texts");
}
```

**Rationale:** Error messages now include "redaction" and "sidecar" keywords, ensuring proper categorization by the error handling logic.

---

### Enhanced Error Categorization

**Before:**
```javascript
if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
  statusCode = 503;
  errorType = "redaction_service_unavailable";
} else if (error.message.includes('redact') || error.message.includes('sidecar')) {
  statusCode = 502;
  errorType = "redaction_service_error";
}
```

**After:**
```javascript
if (
  error.message.includes('fetch') ||
  error.message.includes('ECONNREFUSED') ||
  error.message.includes('ENOTFOUND') ||
  error.message.includes('ECONNRESET') ||
  error.name === 'TypeError' && error.message.includes('fetch')
) {
  statusCode = 503;
  errorType = "redaction_service_unavailable";
} else if (
  error.message.includes('redact') ||
  error.message.includes('sidecar') ||
  error.message.includes('HTTP 5')
) {
  statusCode = 502;
  errorType = "redaction_service_error";
}
```

**Rationale:** Added support for `ECONNRESET` and `TypeError` with "fetch" message, plus HTTP 5xx status codes in error messages.

---

## Structured Logging Output

Tests now validate that structured logging occurs on failures:

```json
{
  "timestamp": "2026-08-25T06:06:44.036Z",
  "event": "redaction_failure",
  "errorType": "redaction_service_unavailable",
  "errorMessage": "fetch failed",
  "statusCode": 503,
  "path": "/",
  "method": "POST"
}
```

This format enables:
- Monitoring and alerting
- Log aggregation and analysis
- Failure rate tracking
- Root cause analysis

---

## Security Validation

### Fail-Closed Behavior Verified

✅ Tests confirm that when redaction fails, the request is **rejected** with appropriate error codes:
- Handler is **NOT** called
- Error response is returned to client
- Structured logging occurs
- PII is **not** sent to LLM providers

### Fail-Open Behavior Preserved (Optional)

✅ Tests confirm that `failOpen: true` still works for compatibility scenarios where administrators want to continue processing even if redaction fails.

---

## Recommendations

### Immediate (Completed)
- ✅ Update tests to match fail-closed behavior
- ✅ Add database mock to prevent connection errors
- ✅ Improve error message categorization
- ✅ Add structured error response validation

### Future Enhancements

1. **Add Integration Tests**
   - Test against actual Presidio sidecar container
   - Validate end-to-end redaction flow
   - Test with real PII data

2. **Add Performance Tests**
   - Measure redaction latency
   - Test with large payloads
   - Validate timeout behavior under load

3. **Add Security Tests**
   - Test ReDoS protection (when implemented)
   - Test path traversal protection (when implemented)
   - Test rate limiting (when implemented)

4. **Test Coverage**
   - Add tests for environment variable configuration
   - Add tests for concurrent requests
   - Add tests for edge cases (empty text, special characters, etc.)

---

## Conclusion

The test suite now accurately reflects the fail-closed security behavior of the redaction middleware. All 25 tests pass, providing confidence that:

1. PII redaction works correctly when the sidecar is healthy
2. Requests are rejected when redaction fails (fail-closed)
3. Appropriate error codes are returned for different failure scenarios
4. Structured logging occurs for monitoring
5. Fail-open behavior remains available as an optional compatibility mode

The test suite is now synchronized with the production implementation, eliminating the false confidence that existed when tests expected fail-open but production used fail-closed.

---

## Files Modified

1. `src/middleware/redaction/tests/middleware.test.js`
   - Updated header documentation
   - Added database mock
   - Reorganized error handling tests
   - Updated test assertions for fail-closed behavior
   - Improved error simulation

2. `src/middleware/redaction/middleware.js`
   - Updated error messages in `callSidecar()`
   - Enhanced error categorization logic

---

## Test Command

```bash
# Run redaction middleware tests
npx vitest run src/middleware/redaction/tests/middleware.test.js --reporter=verbose

# Run with coverage
npx vitest run src/middleware/redaction/tests/middleware.test.js --coverage

# Watch mode for development
npx vitest watch src/middleware/redaction/tests/middleware.test.js
```

---

**Report generated by:** AI Security Review
**Next steps:** Address remaining security issues (path traversal, ReDoS, rate limiting) identified in the security review.
