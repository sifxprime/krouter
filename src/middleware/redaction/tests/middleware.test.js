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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRedactionMiddleware, withRedaction } from "../middleware.js";

// Mock fetch globally
global.fetch = vi.fn();

// Mock settings repository
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn().mockResolvedValue({
    presidioEnabled: true,
    presidioPiiRedaction: true,
    presidioCustomRegex: false,
  }),
}));

describe("createRedactionMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("text extraction", () => {
    it("should extract text from simple string content", async () => {
      const mockHandler = vi.fn();
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
      });

      // Mock sidecar response
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redacted_texts: ["My email is <EMAIL>"] }),
      });

      const body = {
        messages: [{ role: "user", content: "My email is john@example.com" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test:5001/redact",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: ["My email is john@example.com"] }),
        })
      );
    });

    it("should extract text from multimodal array content", async () => {
      const mockHandler = vi.fn();
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redacted_texts: ["My email is <EMAIL>"] }),
      });

      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "My email is john@example.com" },
              { type: "image_url", image_url: { url: "http://example.com/image.png" } },
            ],
          },
        ],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test:5001/redact",
        expect.objectContaining({
          body: JSON.stringify({ texts: ["My email is john@example.com"] }),
        })
      );
    });

    it("should extract text from multiple messages", async () => {
      const mockHandler = vi.fn();
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          redacted_texts: ["Hello <NAME>", "Hi!", "My email is <EMAIL>"],
        }),
      });

      const body = {
        messages: [
          { role: "user", content: "Hello John Doe" },
          { role: "assistant", content: "Hi!" },
          { role: "user", content: "My email is john@example.com" },
        ],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://test:5001/redact",
        expect.objectContaining({
          body: JSON.stringify({
            texts: ["Hello John Doe", "Hi!", "My email is john@example.com"],
          }),
        })
      );
    });

    it("should skip messages with no content", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
      });

      const body = {
        messages: [
          { role: "assistant" }, // No content
          { role: "user", content: null }, // Null content
          { role: "user" }, // No content field
        ],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockHandler).toHaveBeenCalled();
    });

    it("should skip non-text content blocks", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
      });

      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "http://example.com/image.png" } },
            ],
          },
        ],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("redacted text injection", () => {
    it("should inject redacted text back into simple string content", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redacted_texts: ["My email is <EMAIL>"] }),
      });

      const body = {
        messages: [{ role: "user", content: "My email is john@example.com" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      expect(mockHandler).toHaveBeenCalled();

      // Get the modified request body
      const modifiedRequest = mockHandler.mock.calls[0][0];
      const modifiedBody = await modifiedRequest.json();

      expect(modifiedBody.messages[0].content).toBe("My email is <EMAIL>");
    });

    it("should inject redacted text back into multimodal content", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redacted_texts: ["My email is <EMAIL>"] }),
      });

      const originalContent = [
        { type: "text", text: "My email is john@example.com" },
        { type: "image_url", image_url: { url: "http://example.com/image.png" } },
      ];

      const body = {
        messages: [{ role: "user", content: originalContent }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      const modifiedRequest = mockHandler.mock.calls[0][0];
      const modifiedBody = await modifiedRequest.json();

      expect(modifiedBody.messages[0].content[0].text).toBe("My email is <EMAIL>");
      expect(modifiedBody.messages[0].content[1].type).toBe("image_url");
    });

    it("should preserve order of redacted texts", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          redacted_texts: ["<NAME>", "<EMAIL>", "<PHONE>"],
        }),
      });

      const body = {
        messages: [
          { role: "user", content: "John Doe" },
          { role: "user", content: "john@example.com" },
          { role: "user", content: "555-123-4567" },
        ],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      const modifiedRequest = mockHandler.mock.calls[0][0];
      const modifiedBody = await modifiedRequest.json();

      expect(modifiedBody.messages[0].content).toBe("<NAME>");
      expect(modifiedBody.messages[1].content).toBe("<EMAIL>");
      expect(modifiedBody.messages[2].content).toBe("<PHONE>");
    });
  });

  describe("error handling - fail-closed (default)", () => {
    it("should fail closed when sidecar returns error", async () => {
      const mockHandler = vi.fn();
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
        failOpen: false, // Default, explicit for clarity
      });

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const body = {
        messages: [{ role: "user", content: "My email is john@example.com" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await middleware(request, mockHandler);

      // Should NOT call handler (fail-closed)
      expect(mockHandler).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(502); // Bad Gateway - service error
    });

    it("should fail closed when sidecar is unreachable", async () => {
      const mockHandler = vi.fn();
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
        failOpen: false,
      });

      // Simulate ECONNREFUSED error
      const error = new Error("fetch failed");
      error.name = "TypeError";
      global.fetch.mockRejectedValueOnce(error);

      const body = {
        messages: [{ role: "user", content: "My email is john@example.com" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await middleware(request, mockHandler);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(503); // Service Unavailable
    });

    it("should fail closed when sidecar times out", async () => {
      const mockHandler = vi.fn();
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
        timeout: 100,
        failOpen: false,
      });

      // Simulate timeout - fetch throws AbortError when aborted
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      global.fetch.mockRejectedValueOnce(abortError);

      const body = {
        messages: [{ role: "user", content: "My email is john@example.com" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await middleware(request, mockHandler);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(503); // Service Unavailable - timeout
    });

    it("should fail closed when response has invalid format", async () => {
      const mockHandler = vi.fn();
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
        failOpen: false,
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ invalid: "response" }),
      });

      const body = {
        messages: [{ role: "user", content: "My email is john@example.com" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await middleware(request, mockHandler);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(502); // Bad Gateway - invalid response
    });

    it("should fail closed when sidecar returns wrong number of texts", async () => {
      const mockHandler = vi.fn();
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
        failOpen: false,
      });

      // Return 2 texts when we sent 1
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redacted_texts: ["<EMAIL>", "<PHONE>"] }),
      });

      const body = {
        messages: [{ role: "user", content: "My email is john@example.com" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await middleware(request, mockHandler);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(502); // Bad Gateway - invalid response
    });

    it("should return structured error response", async () => {
      const mockHandler = vi.fn();
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
        failOpen: false,
      });

      global.fetch.mockRejectedValueOnce(new Error("Network error"));

      const body = {
        messages: [{ role: "user", content: "My email is john@example.com" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await middleware(request, mockHandler);
      const responseData = await result.json();

      expect(responseData).toHaveProperty("error");
      expect(responseData.error).toHaveProperty("message");
      expect(responseData.error).toHaveProperty("code");
      expect(responseData.error).toHaveProperty("type");
    });
  });

  describe("error handling - fail-open (for compatibility)", () => {
    it("should fail open when configured", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
        failOpen: true, // Explicitly enable fail-open
      });

      global.fetch.mockRejectedValueOnce(new Error("Network error"));

      const body = {
        messages: [{ role: "user", content: "My email is john@example.com" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await middleware(request, mockHandler);

      // Should call handler (fail-open)
      expect(mockHandler).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Response);
    });
  });

  describe("conditional processing", () => {
    it("should skip non-POST requests", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
      });

      const request = new Request("http://test", {
        method: "GET",
      });

      await middleware(request, mockHandler);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockHandler).toHaveBeenCalledWith(request);
    });

    it("should skip when disabled", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
        enabled: false,
      });

      const body = {
        messages: [{ role: "user", content: "My email is john@example.com" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockHandler).toHaveBeenCalledWith(request);
    });

    it("should skip when no messages array", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
      });

      const body = { model: "gpt-4" };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should skip empty messages array", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
      });

      const body = { messages: [] };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should skip when messages have no text content", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
      });

      const body = {
        messages: [
          { role: "system", content: [{ type: "image", image: "data" }] },
        ],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("configuration", () => {
    it("should use custom sidecar URL from options", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://custom:8080/redact",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redacted_texts: ["test"] }),
      });

      const body = {
        messages: [{ role: "user", content: "test" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://custom:8080/redact",
        expect.any(Object)
      );
    });

    it("should use custom timeout from options", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://test:5001/redact",
        timeout: 5000,
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redacted_texts: ["test"] }),
      });

      const body = {
        messages: [{ role: "user", content: "test" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      // Verify the request was made (timeout is internal)
      expect(global.fetch).toHaveBeenCalled();
    });

    it("should use environment variable for sidecar URL", async () => {
      const originalEnv = process.env.SIDECAR_URL;
      process.env.SIDECAR_URL = "http://env:6000/redact";

      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));
      const middleware = createRedactionMiddleware();

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redacted_texts: ["test"] }),
      });

      const body = {
        messages: [{ role: "user", content: "test" }],
      };

      const request = new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await middleware(request, mockHandler);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://env:6000/redact",
        expect.any(Object)
      );

      process.env.SIDECAR_URL = originalEnv;
    });
  });
});

describe("withRedaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should wrap a handler with redaction middleware", async () => {
    const mockHandler = vi.fn().mockResolvedValue(new Response("Handled"));
    const wrapped = withRedaction(mockHandler, {
      sidecarUrl: "http://test:5001/redact",
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redacted_texts: ["test"] }),
    });

    const body = {
      messages: [{ role: "user", content: "test" }],
    };

    const request = new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await wrapped(request);

    expect(mockHandler).toHaveBeenCalled();
    expect(result).toBeInstanceOf(Response);
  });

  it("should pass additional arguments to handler", async () => {
    const mockHandler = vi.fn().mockResolvedValue(new Response("Handled"));
    const wrapped = withRedaction(mockHandler, {
      sidecarUrl: "http://test:5001/redact",
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redacted_texts: ["test"] }),
    });

    const body = {
      messages: [{ role: "user", content: "test" }],
    };

    const request = new Request("http://test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const extraArg = { context: "test" };
    await wrapped(request, extraArg);

    expect(mockHandler).toHaveBeenCalledWith(
      expect.any(Request),
      extraArg
    );
  });
});
