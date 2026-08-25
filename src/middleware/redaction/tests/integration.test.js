/**
 * Integration tests for Redaction Middleware
 *
 * Tests cover:
- Full round-trip with sample PII data
- All regex patterns redact correctly
- ML entities redact correctly
- Performance under load
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRedactionMiddleware } from "../middleware.js";

// Mock fetch globally
global.fetch = vi.fn();

// Mock settings repository — the middleware gates redaction on the dynamic
// presidio toggles before it ever reaches the sidecar. Without this stub the
// gate reads the real SQLite settings (both toggles off) and short-circuits,
// so no redaction ever happens.
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn().mockResolvedValue({
    presidioEnabled: true,
    presidioPiiRedaction: true,
    presidioCustomRegex: false,
  }),
}));

describe("Redaction Middleware Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("full redaction flow", () => {
    it("should redact PII in a complete chat request", async () => {
      const mockHandler = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "Response" } }] }), {
          headers: { "Content-Type": "application/json" },
        })
      );

      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://presidio-sidecar:5001/redact",
      });

      // Mock realistic redaction response from Presidio
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          redacted_texts: [
            "My name is <PERSON> and my email is <EMAIL_ADDRESS>",
            "Sure, <PERSON>! How can I help you today?",
            "Please call me at <PHONE_NUMBER>. My card is <CREDIT_CARD>",
          ],
        }),
      });

      const requestBody = {
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content: "My name is John Doe and my email is john.doe@example.com",
          },
          {
            role: "assistant",
            content: "Sure, John! How can I help you today?",
          },
          {
            role: "user",
            content: "Please call me at 555-123-4567. My card is 4111-1111-1111-1111",
          },
        ],
        temperature: 0.7,
      };

      const request = new Request("http://localhost:20128/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-key",
        },
        body: JSON.stringify(requestBody),
      });

      const result = await middleware(request, mockHandler);

      // Verify sidecar was called
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://presidio-sidecar:5001/redact",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            texts: [
              "My name is John Doe and my email is john.doe@example.com",
              "Sure, John! How can I help you today?",
              "Please call me at 555-123-4567. My card is 4111-1111-1111-1111",
            ],
          }),
        })
      );

      // Verify handler was called with modified request
      expect(mockHandler).toHaveBeenCalledTimes(1);

      // Get the modified request and verify redaction
      const modifiedRequest = mockHandler.mock.calls[0][0];
      const modifiedBody = await modifiedRequest.json();

      expect(modifiedBody.messages[0].content).toBe(
        "My name is <PERSON> and my email is <EMAIL_ADDRESS>"
      );
      expect(modifiedBody.messages[1].content).toBe(
        "Sure, <PERSON>! How can I help you today?"
      );
      expect(modifiedBody.messages[2].content).toBe(
        "Please call me at <PHONE_NUMBER>. My card is <CREDIT_CARD>"
      );

      // Verify other fields are preserved
      expect(modifiedBody.model).toBe("gpt-4");
      expect(modifiedBody.temperature).toBe(0.7);

      // Verify final response
      expect(result).toBeInstanceOf(Response);
    });

    it("should handle multimodal messages with images", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));

      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://presidio-sidecar:5001/redact",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          redacted_texts: ["Here's my photo, email me at <EMAIL_ADDRESS>"],
        }),
      });

      const requestBody = {
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Here's my photo, email me at john@example.com",
              },
              {
                type: "image_url",
                image_url: {
                  url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...",
                },
              },
            ],
          },
        ],
      };

      const request = new Request("http://localhost:20128/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      await middleware(request, mockHandler);

      const modifiedRequest = mockHandler.mock.calls[0][0];
      const modifiedBody = await modifiedRequest.json();

      // Verify text was redacted but image was preserved
      expect(modifiedBody.messages[0].content[0].text).toBe(
        "Here's my photo, email me at <EMAIL_ADDRESS>"
      );
      expect(modifiedBody.messages[0].content[1].type).toBe("image_url");
      expect(modifiedBody.messages[0].content[1].image_url.url).toContain("data:image");
    });

    it("should handle empty and minimal requests", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));

      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://presidio-sidecar:5001/redact",
      });

      const request = new Request("http://localhost:20128/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4", messages: [] }),
      });

      await middleware(request, mockHandler);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockHandler).toHaveBeenCalledWith(request);
    });
  });

  describe("pattern-specific redaction", () => {
    it("should redact API keys correctly", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));

      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://presidio-sidecar:5001/redact",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          redacted_texts: ["My OpenAI key is <OPENAI_KEY>"],
        }),
      });

      const request = new Request("http://localhost:20128/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "user", content: "My OpenAI key is sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz" },
          ],
        }),
      });

      await middleware(request, mockHandler);

      const modifiedRequest = mockHandler.mock.calls[0][0];
      const modifiedBody = await modifiedRequest.json();

      expect(modifiedBody.messages[0].content).toBe("My OpenAI key is <OPENAI_KEY>");
    });

    it("should redact multiple PII types in one message", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));

      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://presidio-sidecar:5001/redact",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          redacted_texts: [
            "Contact <PERSON> at <EMAIL_ADDRESS> or <PHONE_NUMBER>. ID: <INTERNAL_ID>",
          ],
        }),
      });

      const request = new Request("http://localhost:20128/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content:
                "Contact Jane Smith at jane.smith@company.com or 555-987-6543. ID: USR-12345",
            },
          ],
        }),
      });

      await middleware(request, mockHandler);

      const modifiedRequest = mockHandler.mock.calls[0][0];
      const modifiedBody = await modifiedRequest.json();

      expect(modifiedBody.messages[0].content).toBe(
        "Contact <PERSON> at <EMAIL_ADDRESS> or <PHONE_NUMBER>. ID: <INTERNAL_ID>"
      );
    });
  });

  describe("error scenarios", () => {
    it("should fail open when sidecar is unavailable", async () => {
      const mockHandler = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ result: "success" }), {
          headers: { "Content-Type": "application/json" },
        })
      );

      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://presidio-sidecar:5001/redact",
        failOpen: true, // Fail-open is opt-in; the default is fail-closed for security
      });

      global.fetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const request = new Request("http://localhost:20128/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "My email is john@example.com" }],
        }),
      });

      const result = await middleware(request, mockHandler);

      // Should still call handler with original request
      expect(mockHandler).toHaveBeenCalled();

      // Verify original text was preserved
      const modifiedRequest = mockHandler.mock.calls[0][0];
      const modifiedBody = await modifiedRequest.json();

      expect(modifiedBody.messages[0].content).toBe("My email is john@example.com");

      // Should still get a response
      expect(result).toBeInstanceOf(Response);
    });

    it("should fail open when sidecar times out", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));

      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://presidio-sidecar:5001/redact",
        timeout: 50,
        failOpen: true, // Fail-open is opt-in; the default is fail-closed for security
      });

      // Mock a slow response that resolves after timeout
      global.fetch.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            setTimeout(() => {
              // Check if already aborted
              resolve({
                ok: true,
                json: async () => ({ redacted_texts: ["test"] }),
              });
            }, 200);
          })
      );

      const request = new Request("http://localhost:20128/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Test" }],
        }),
      });

      const result = await middleware(request, mockHandler);

      expect(mockHandler).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Response);
    });

    it("should fail open when sidecar returns 500", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));

      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://presidio-sidecar:5001/redact",
        failOpen: true, // Fail-open is opt-in; the default is fail-closed for security
      });

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const request = new Request("http://localhost:20128/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Test" }],
        }),
      });

      const result = await middleware(request, mockHandler);

      expect(mockHandler).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Response);
    });
  });

  describe("performance", () => {
    it("should handle large message arrays efficiently", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));

      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://presidio-sidecar:5001/redact",
      });

      // Create a conversation with 50 messages
      const messages = [];
      for (let i = 0; i < 50; i++) {
        messages.push({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i} with email user${i}@example.com`,
        });
      }

      const redactedTexts = messages.map((m) =>
        m.content.replace(/user\d+@example\.com/g, "<EMAIL_ADDRESS>")
      );

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redacted_texts: redactedTexts }),
      });

      const startTime = Date.now();

      const request = new Request("http://localhost:20128/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });

      await middleware(request, mockHandler);

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 100ms for the test, not including actual sidecar)
      expect(duration).toBeLessThan(100);

      // Verify all messages were processed
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const modifiedRequest = mockHandler.mock.calls[0][0];
      const modifiedBody = await modifiedRequest.json();

      expect(modifiedBody.messages.length).toBe(50);
      for (let i = 0; i < 50; i++) {
        expect(modifiedBody.messages[i].content).toContain("<EMAIL_ADDRESS>");
      }
    });
  });

  describe("configuration integration", () => {
    it("should respect REDACTION_ENABLED=false", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));

      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://presidio-sidecar:5001/redact",
        enabled: false,
      });

      const request = new Request("http://localhost:20128/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "My email is john@example.com" }],
        }),
      });

      await middleware(request, mockHandler);

      // Should not call sidecar
      expect(global.fetch).not.toHaveBeenCalled();

      // Should pass original request to handler
      expect(mockHandler).toHaveBeenCalledWith(request);
    });

    it("should use custom timeout", async () => {
      const mockHandler = vi.fn().mockResolvedValue(new Response("OK"));

      const middleware = createRedactionMiddleware({
        sidecarUrl: "http://presidio-sidecar:5001/redact",
        timeout: 50, // Very short timeout
      });

      // Mock a slow response
      global.fetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => ({ redacted_texts: ["test"] }),
                }),
              100
            );
          })
      );

      const request = new Request("http://localhost:20128/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Test" }],
        }),
      });

      await middleware(request, mockHandler);

      // Should fail open and call handler
      expect(mockHandler).toHaveBeenCalled();
    });
  });
});
