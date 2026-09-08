/**
 * OpenCode Go quota was not tracked at all, so a subscriber saw nothing on the
 * usage dashboard for the provider — including when a window was exhausted and
 * their requests started failing.
 *
 * Ported from upstream 0da803ee. Upstream keeps this in services/usage/opencode-go.js
 * and reads the URL from its provider registry; this fork has neither, so the
 * function lives inline in services/usage.js with the URL literal.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", async (o) => {
  const actual = await o();
  return { ...actual, proxyAwareFetch: vi.fn() };
});

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(process.cwd(), "open-sse/services/usage.js"), "utf-8");
const call = (apiKey = "k") => getUsageForProvider({ provider: "opencode-go", apiKey });

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => proxyAwareFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("OpenCode Go usage", () => {
  it("is wired into the provider dispatch", () => {
    expect(src).toContain('case "opencode-go":');
    expect(src).toContain("https://opencode.ai/zen/go/v1/usage");
  });

  it("maps each period to a named quota window", async () => {
    proxyAwareFetch.mockResolvedValue(json(200, {
      usage: {
        rolling: { percent: 25, resetsAt: "2026-09-09T00:00:00Z" },
        weekly: { percent: 60 },
        monthly: { percent: 10 },
      },
    }));
    const out = await call();
    expect(out.plan).toBe("OpenCode Go");
    expect(Object.keys(out.quotas).sort()).toEqual(["Monthly", "Rolling", "Weekly"]);
    expect(out.quotas.Rolling.used).toBe(25);
    expect(out.quotas.Rolling.remaining).toBe(75);
  });

  it("accepts a percent sent as a string", async () => {
    proxyAwareFetch.mockResolvedValue(json(200, { usage: { rolling: { percent: "42" } } }));
    expect((await call()).quotas.Rolling.used).toBe(42);
  });

  it("clamps a percent outside 0-100", async () => {
    proxyAwareFetch.mockResolvedValue(json(200, { usage: { rolling: { percent: 140 } } }));
    expect((await call()).quotas.Rolling.used).toBe(100);
  });

  it("distinguishes a missing subscription from plain forbidden", async () => {
    proxyAwareFetch.mockResolvedValue(json(403, { error: { type: "EntitlementError" } }));
    expect((await call()).message).toContain("subscription required");

    proxyAwareFetch.mockResolvedValue(json(403, { error: { type: "Other" } }));
    expect((await call()).message).toContain("forbidden");
  });

  it("reports an auth failure distinctly", async () => {
    proxyAwareFetch.mockResolvedValue(json(401, {}));
    expect((await call()).message).toContain("authentication failed");
  });

  it("says so when the payload carries no usable quota", async () => {
    proxyAwareFetch.mockResolvedValue(json(200, { usage: {} }));
    expect((await call()).message).toContain("did not contain valid quota data");
  });

  it("asks for a key rather than calling out without one", async () => {
    const out = await getUsageForProvider({ provider: "opencode-go", apiKey: "" });
    expect(out.message).toContain("API key not available");
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});
