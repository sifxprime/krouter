// Tests for 0.5.32 cache preservation + cross-account stickiness.
//
// Three units under test:
//   1. generateConversationFingerprint  — same input → same fingerprint
//      regardless of connectionId, different from generateSessionId(...,
//      {connectionId})
//   2. bindConversationConnection + getStickyConnection — round-trip and TTL
//   3. prepareClaudeRequest(..., preserveCacheControl=true) — cache_control
//      markers survive byte-for-byte when the flag is set
import { describe, expect, it, beforeEach } from "vitest";
import {
  generateSessionId,
  generateConversationFingerprint,
  bindConversationConnection,
  getStickyConnection,
  clearStickyConnection,
} from "../../open-sse/services/sessionManager.js";
import { prepareClaudeRequest } from "../../open-sse/translator/helpers/claudeHelper.js";

const sampleBody = () => ({
  model: "claude-sonnet-4-7",
  system: [
    { type: "text", text: "You are a helpful assistant." },
    { type: "text", text: "Be concise.", cache_control: { type: "ephemeral", ttl: "1h" } },
  ],
  tools: [{ name: "bash" }, { name: "read_file" }],
  messages: [
    { role: "user", content: "Hello there" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Hi! How can I help?" },
        { type: "tool_use", id: "tu_1", name: "bash", input: {} },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_1", content: "ok" },
        { type: "text", text: "Continue" },
      ],
    },
  ],
});

describe("generateConversationFingerprint — account-agnostic", () => {
  it("returns the same fingerprint regardless of connectionId", () => {
    const body = sampleBody();
    const fp1 = generateConversationFingerprint(body, { provider: "claude" });
    const fp2 = generateConversationFingerprint(body, { provider: "claude" });
    expect(fp1).toBe(fp2);
    expect(typeof fp1).toBe("string");
    expect(fp1.length).toBeGreaterThan(0);
  });

  it("differs from generateSessionId() which DOES include connectionId", () => {
    const body = sampleBody();
    const fp = generateConversationFingerprint(body, { provider: "claude" });
    const sidA = generateSessionId(body, { provider: "claude", connectionId: "conn-A" });
    const sidB = generateSessionId(body, { provider: "claude", connectionId: "conn-B" });

    // Connection-scoped IDs differ from each other and from the connectionless
    // fingerprint. (sidA / sidB include c:conn-A / c:conn-B in the hash input.)
    expect(sidA).not.toBe(sidB);
    expect(fp).not.toBe(sidA);
    expect(fp).not.toBe(sidB);
  });

  it("differs when first user message changes (new conversation)", () => {
    const a = sampleBody();
    const b = sampleBody();
    b.messages[0].content = "A completely different opening question";
    const fpA = generateConversationFingerprint(a, { provider: "claude" });
    const fpB = generateConversationFingerprint(b, { provider: "claude" });
    expect(fpA).not.toBe(fpB);
  });

  it("returns null for empty / null body", () => {
    expect(generateConversationFingerprint(null)).toBeNull();
    expect(generateConversationFingerprint({})).toBeNull();
  });
});

describe("sticky connection binding", () => {
  const FP = "test-fingerprint-deadbeef";
  beforeEach(() => {
    clearStickyConnection(FP);
  });

  it("returns null when nothing was bound", () => {
    expect(getStickyConnection(FP)).toBeNull();
  });

  it("returns the bound connectionId after binding", () => {
    bindConversationConnection(FP, "conn-XYZ");
    expect(getStickyConnection(FP)).toBe("conn-XYZ");
  });

  it("clearStickyConnection removes the entry", () => {
    bindConversationConnection(FP, "conn-XYZ");
    clearStickyConnection(FP);
    expect(getStickyConnection(FP)).toBeNull();
  });

  it("ignores empty fingerprint / connectionId", () => {
    bindConversationConnection("", "conn-A");
    bindConversationConnection(FP, "");
    expect(getStickyConnection(FP)).toBeNull();
  });

  it("getStickyConnection returns null for null / undefined input", () => {
    expect(getStickyConnection(null)).toBeNull();
    expect(getStickyConnection(undefined)).toBeNull();
  });
});

describe("prepareClaudeRequest preserveCacheControl flag", () => {
  it("default (false) STRIPS and rewrites cache_control on system blocks", () => {
    const body = sampleBody();
    const before = JSON.stringify(body.system);
    const result = prepareClaudeRequest({ ...body, system: structuredClone(body.system) }, "claude");
    // Default behavior: first block's cache_control was removed, last block's
    // got rewritten to ttl: "1h"
    expect(result.system[0].cache_control).toBeUndefined();
    expect(result.system[result.system.length - 1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("preserveCacheControl=true leaves system cache_control markers byte-identical", () => {
    const body = sampleBody();
    const systemBefore = JSON.parse(JSON.stringify(body.system));
    const result = prepareClaudeRequest(
      { ...body, system: structuredClone(body.system) },
      "claude",
      null,
      null,
      true,
    );
    // System array should be unchanged — same blocks, same cache_control placement
    expect(result.system).toEqual(systemBefore);
  });

  it("preserveCacheControl=true leaves message content cache_control unchanged", () => {
    const body = sampleBody();
    // Add a cache_control to a tool_result content block
    const messagesBefore = structuredClone(body.messages);
    messagesBefore[2].content[0].cache_control = { type: "ephemeral" };
    body.messages[2].content[0].cache_control = { type: "ephemeral" };

    const result = prepareClaudeRequest(
      { ...body, messages: structuredClone(body.messages) },
      "claude",
      null,
      null,
      true,
    );

    // The cache_control marker on the tool_result block must survive
    expect(result.messages[2].content[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("preserveCacheControl=false (default) strips message content cache_control", () => {
    const body = sampleBody();
    body.messages[2].content[0].cache_control = { type: "ephemeral" };
    const result = prepareClaudeRequest(
      { ...body, messages: structuredClone(body.messages) },
      "claude",
    );
    // Stripped from content blocks
    expect(result.messages[2].content[0].cache_control).toBeUndefined();
  });

  it("preserveCacheControl=true does NOT add cache_control to the last assistant", () => {
    const body = sampleBody();
    // Strip any pre-existing cache_control so we can detect new injections
    for (const m of body.messages) {
      if (Array.isArray(m.content)) for (const b of m.content) delete b.cache_control;
    }
    const result = prepareClaudeRequest(
      { ...body, messages: structuredClone(body.messages) },
      "claude",
      null,
      null,
      true,
    );
    // No cache_control should have been added to any message content block
    for (const m of result.messages) {
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          expect(b.cache_control).toBeUndefined();
        }
      }
    }
  });
});
