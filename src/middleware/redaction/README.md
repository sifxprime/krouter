# Redaction Middleware

PII redaction middleware for kRouter using Microsoft Presidio.

## Overview

This middleware intercepts incoming chat completion requests, extracts text from messages, sends them to the Presidio sidecar for PII redaction, and modifies the request body before passing it to the main handler.

## Features

- **Automatic text extraction**: Handles both simple string content and multimodal array content
- **Batch processing**: Sends all texts in a single request to minimize latency
- **Fail-open**: If redaction fails, the request continues with original text
- **Configurable**: Enable/disable via environment variable or options
- **Type-safe**: Works with Next.js API routes

## Usage

### Basic Usage in API Route

```javascript
import { withRedaction } from "@/middleware/redaction";
import { handleChat } from "@/sse/handlers/chat.js";

export const POST = withRedaction(async (request) => {
  return await handleChat(request);
});
```

### With Custom Options

```javascript
export const POST = withRedaction(async (request) => {
  return await handleChat(request);
}, {
  sidecarUrl: "http://presidio-sidecar:5001/redact",
  timeout: 3000,  // 3 seconds
  enabled: true
});
```

### Environment Variables

- `SIDECAR_URL`: URL of the Presidio sidecar (default: "http://presidio-sidecar:5001/redact")
- `REDACTION_ENABLED`: Set to "false" to disable redaction (default: true)

## Configuration

The middleware extracts text from request bodies in the following formats:

### Simple String Content
```json
{
  "messages": [
    { "role": "user", "content": "My email is john@example.com" }
  ]
}
```

### Multimodal Array Content
```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "My email is john@example.com" },
        { "type": "image_url", "image_url": { "url": "..." } }
      ]
    }
  ]
}
```

## Sidecar API

The middleware expects the Presidio sidecar to implement the following API:

### POST /redact

**Request:**
```json
{
  "texts": [
    "My email is john@example.com",
    "Call me at 555-123-4567"
  ]
}
```

**Response:**
```json
{
  "redacted_texts": [
    "My email is <EMAIL>",
    "Call me at <PHONE_NUMBER>"
  ]
}
```

## Error Handling

The middleware follows a "fail-open" strategy:

- If the sidecar is unreachable, the request continues with original text
- If the sidecar returns an error, the request continues with original text
- If redaction times out, the request continues with original text

Errors are logged to console for debugging.

## Performance

- Target latency: < 2ms per request (within same Docker network)
- Batch processing reduces per-request overhead
- Timeout prevents hanging on slow sidecar responses

## Testing

```bash
# Run unit tests
npm test -- src/middleware/redaction/tests

# Run with coverage
npm test -- --coverage src/middleware/redaction/tests
```
