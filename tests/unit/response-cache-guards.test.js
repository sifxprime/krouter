import { describe, it, expect, beforeEach } from "vitest";
import { lookupCache, saveToCache, resetCache } from "../../open-sse/services/responseCache.js";

// 0.5.99 — Cache-safety guard regressions.
// User-reported bug: with Response Cache ON, Antigravity conversations returned
// duplicate replies ("Hi" → "Hello, how can I help?" then next unrelated turn
// echoed the same reply). Root cause: Antigravity IDE fires small deterministic
// probe requests whose hashes collide with real user turns, leaking canned
// replies into future responses.

describe("responseCache 0.5.99 guards", () => {
  beforeEach(() => resetCache());

  const baseSave = {
    model: "some-model",
    body: { messages: [{ role: "user", content: "hi" }], temperature: 0, max_tokens: 200 },
    status: 200,
    contentType: "application/json",
    responseBody: JSON.stringify({ choices: [{ message: { content: "hi there this is a long enough reply body to be cacheable across the new 100 byte minimum" } }] }),
  };

  it("caches a normal safe request end-to-end", () => {
    expect(saveToCache(baseSave)).toBe(true);
    const hit = lookupCache({ model: baseSave.model, body: baseSave.body });
    expect(hit).not.toBeNull();
  });

  it("refuses to cache Antigravity provider (id AND alias forms)", () => {
    // 0.5.101 — model strings arrive as ALIASES ("ag/..."), not ids. Both must be blocked.
    for (const model of ["antigravity/gemini-2.5-pro", "ag/gemini-3-flash-agent"]) {
      const cfg = { ...baseSave, model };
      expect(saveToCache(cfg), `should block ${model}`).toBe(false);
      expect(lookupCache({ model, body: cfg.body })).toBeNull();
    }
  });

  it("refuses to cache gemini + gemini-cli (id AND alias forms)", () => {
    for (const model of ["gemini/gemini-2.0-flash", "gemini-cli/gemini-2.5-pro", "gc/gemini-2.5-pro"]) {
      const cfg = { ...baseSave, model };
      expect(saveToCache(cfg), `should block ${model}`).toBe(false);
    }
  });

  it("refuses to cache max_tokens < 32 (IDE probe pattern)", () => {
    const cfg = { ...baseSave, body: { ...baseSave.body, max_tokens: 8 } };
    expect(saveToCache(cfg)).toBe(false);
  });

  it("refuses to cache responseBody < 100 bytes (empty/probe reply)", () => {
    const cfg = { ...baseSave, responseBody: "ok" };
    expect(saveToCache(cfg)).toBe(false);
  });

  it("still caches short max_output_tokens variant if it's >= 32", () => {
    const cfg = { ...baseSave, body: { ...baseSave.body, max_tokens: undefined, max_output_tokens: 64 } };
    expect(saveToCache(cfg)).toBe(true);
  });

  it("still refuses caching for stream:true (unchanged v0.5.99 semantic)", () => {
    const cfg = { ...baseSave, body: { ...baseSave.body, stream: true } };
    expect(saveToCache(cfg)).toBe(false);
  });

  it("still refuses caching for temperature > 0.3 (unchanged v0.5.99 semantic)", () => {
    const cfg = { ...baseSave, body: { ...baseSave.body, temperature: 0.7 } };
    expect(saveToCache(cfg)).toBe(false);
  });
});
