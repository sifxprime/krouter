/**
 * Unit tests for the Anthropic header pipeline.
 *
 * 0.5.123 (upstream 13ed1456): the global claudeHeaderCache singleton was REMOVED
 * (it leaked one client's identity headers onto every later request). The claude
 * executor now uses the static per-provider CLI fingerprint + a per-MODEL
 * anthropic-beta. These tests assert the new, leak-free behavior:
 *  - default.js buildHeaders(): static fingerprint + per-model anthropic-beta
 *  - default.js buildHeaders(): no shared state across calls
 *  - default.js buildHeaders(): anthropic-compatible non-Anthropic host stripping
 *  - default.js buildHeaders(): anthropic-compatible official host keeps headers
 *  - proxyFetch.js: api.anthropic.com routing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── DefaultExecutor.buildHeaders() — claude provider ────────────────────────

describe("DefaultExecutor.buildHeaders() — claude provider", () => {
  let DefaultExecutor;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("open-sse/executors/default.js");
    DefaultExecutor = mod.DefaultExecutor || mod.default;
  });

  it("uses the static Claude CLI fingerprint (no per-client cache to leak)", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "sk-test" }, true, null, "claude-opus-4-8");
    // Static spoof identity from CLAUDE_CLI_SPOOF_HEADERS — same for every caller.
    expect(headers["User-Agent"]).toContain("claude-cli/");
    expect(headers["X-App"]).toBe("cli");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("computes anthropic-beta PER MODEL — heavy flags only for opus/sonnet", () => {
    const executor = new DefaultExecutor("claude");
    const opus = executor.buildHeaders({ apiKey: "k" }, true, null, "claude-opus-4-8");
    const haiku = executor.buildHeaders({ apiKey: "k" }, true, null, "claude-haiku-4-5");
    expect(opus["Anthropic-Beta"]).toContain("advanced-tool-use-2025-11-20");
    expect(opus["Anthropic-Beta"]).toContain("effort-2025-11-24");
    expect(haiku["Anthropic-Beta"]).not.toContain("advanced-tool-use-2025-11-20");
    expect(haiku["Anthropic-Beta"]).not.toContain("effort-2025-11-24");
    // base flags on both
    expect(opus["Anthropic-Beta"]).toContain("claude-code-20250219");
    expect(haiku["Anthropic-Beta"]).toContain("claude-code-20250219");
  });

  it("does not carry state between calls (two clients can't cross-contaminate)", () => {
    const executor = new DefaultExecutor("claude");
    const a = executor.buildHeaders({ apiKey: "k" }, true, null, "claude-opus-4-8");
    const b = executor.buildHeaders({ apiKey: "k" }, true, null, "claude-haiku-4-5");
    // b must NOT inherit a's heavy flags — the whole point of removing the cache.
    expect(b["Anthropic-Beta"]).not.toContain("effort-2025-11-24");
    // and a is unchanged by b's call
    const a2 = executor.buildHeaders({ apiKey: "k" }, true, null, "claude-opus-4-8");
    expect(a2["Anthropic-Beta"]).toBe(a["Anthropic-Beta"]);
  });

  it("sets x-api-key auth when apiKey is provided", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ apiKey: "sk-live-key" }, true, null, "claude-opus-4-8");
    expect(headers["x-api-key"]).toBe("sk-live-key");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("sets Bearer Authorization when only accessToken is provided", () => {
    const executor = new DefaultExecutor("claude");
    const headers = executor.buildHeaders({ accessToken: "tok-abc" }, true, null, "claude-opus-4-8");
    expect(headers["Authorization"]).toBe("Bearer tok-abc");
    expect(headers["x-api-key"]).toBeUndefined();
  });
});

// ─── anthropic-compatible header stripping (unchanged by 13ed1456) ────────────

describe("DefaultExecutor.buildHeaders() — anthropic-compatible stripping", () => {
  let DefaultExecutor;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("open-sse/executors/default.js");
    DefaultExecutor = mod.DefaultExecutor || mod.default;
  });

  it("strips x-app and dangerous-direct-browser-access for non-Anthropic host", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const headers = executor.buildHeaders(
      { apiKey: "key", providerSpecificData: { baseUrl: "https://myproxy.example.com/v1" } },
      true
    );
    expect(headers["x-app"]).toBeUndefined();
    expect(headers["X-App"]).toBeUndefined();
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
    expect(headers["Anthropic-Dangerous-Direct-Browser-Access"]).toBeUndefined();
  });

  it("removes claude-code-20250219 from anthropic-beta for non-Anthropic host", () => {
    const executor = new DefaultExecutor("anthropic-compatible-custom");
    const headers = executor.buildHeaders(
      { apiKey: "key", providerSpecificData: { baseUrl: "https://myproxy.example.com/v1" } },
      true
    );
    const betaVal = headers["anthropic-beta"] || headers["Anthropic-Beta"] || "";
    expect(betaVal).not.toContain("claude-code-20250219");
  });

  it("does NOT strip headers when baseUrl is api.anthropic.com", () => {
    const executor = new DefaultExecutor("anthropic-compatible-official");
    const headers = executor.buildHeaders(
      { apiKey: "key", providerSpecificData: { baseUrl: "https://api.anthropic.com/v1" } },
      true
    );
    expect(headers["Anthropic-Version"] || headers["anthropic-version"]).toBeDefined();
  });

  it("does NOT strip headers when baseUrl is empty (defaults to Anthropic)", () => {
    const executor = new DefaultExecutor("anthropic-compatible-official");
    const headers = executor.buildHeaders(
      { apiKey: "key", providerSpecificData: {} },
      true
    );
    expect(headers["Anthropic-Version"] || headers["anthropic-version"]).toBeDefined();
  });
});

// ─── proxyFetch anthropicFetch routing ────────────────────────────────────────

describe("proxyAwareFetch — api.anthropic.com routing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT route non-Anthropic hosts through gotScraping", async () => {
    const gotScrapingMock = vi.fn();
    vi.doMock("got-scraping", () => ({ gotScraping: gotScrapingMock }));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      body: null,
      text: async () => "{}",
      json: async () => ({}),
    });

    vi.resetModules();
    const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");

    await proxyAwareFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(gotScrapingMock).not.toHaveBeenCalled();
  });
});
