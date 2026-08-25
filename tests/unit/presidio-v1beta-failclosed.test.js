import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRedactionMiddleware } from "@/middleware/redaction/middleware.js";

/**
 * PR #1 review: the v1beta (Gemini-compat) route could not use withRedaction(),
 * because the Gemini -> OpenAI conversion must run before redaction. It called
 * the middleware imperatively with an identity handler:
 *
 *   const redactedRequest = await redactionMiddleware(newRequest, (req) => req);
 *   const response = await handleChat(redactedRequest);
 *
 * On success that yields a Request. On every fail-closed path the middleware
 * returns a Response, which was then handed to handleChat() -- a type confusion
 * that silently defeated the fail-closed guarantee on this one endpoint: the
 * 503 never reached the client.
 *
 * These tests pin the middleware's actual contract so the route can rely on it.
 */

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn().mockResolvedValue({
    presidioEnabled: true,
    presidioPiiRedaction: true,
  }),
}));

const makeRequest = () =>
  new Request("http://localhost:20128/v1beta/models/gemini-pro:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini-pro",
      messages: [{ role: "user", content: "contact me at john@example.com" }],
    }),
  });

describe("v1beta redaction contract (PR #1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a Response, not a Request, when the sidecar is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const mw = createRedactionMiddleware({ sidecarUrl: "http://presidio-sidecar:5001/redact" });

    const result = await mw(makeRequest(), (req) => req);

    // This is the discriminator the route now branches on.
    expect(result instanceof Response).toBe(true);
    expect(result.status).toBeGreaterThanOrEqual(500);
  });

  it("returns a Request on the success path so the route can forward it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ redacted_texts: ["contact me at <EMAIL>"] }),
      }),
    );
    const mw = createRedactionMiddleware({ sidecarUrl: "http://presidio-sidecar:5001/redact" });

    const result = await mw(makeRequest(), (req) => req);

    expect(result instanceof Response).toBe(false);
    expect(result instanceof Request).toBe(true);
  });

  it("a Response result is distinguishable from a Request without reading the body", () => {
    // The route must decide before consuming the body -- a body can only be
    // read once, so an instanceof check is the only safe discriminator.
    const res = new Response("{}", { status: 503 });
    const req = new Request("http://x/y", { method: "POST", body: "{}" });
    expect(res instanceof Response).toBe(true);
    expect(req instanceof Response).toBe(false);
  });
});
