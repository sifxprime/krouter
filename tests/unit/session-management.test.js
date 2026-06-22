// Tests for the session-management modules (0.5.29):
// sessionManager (deterministic id derivation + pool tracking)
// fingerprintRotator (per-account stable browser fingerprint)
import { describe, expect, it, beforeEach } from "vitest";
import {
  generateSessionId,
  touchSession,
  getSessionInfo,
  getActiveSessionCount,
  getActiveSessions,
  clearSessions,
  registerKeySession,
  isSessionRegisteredForKey,
  unregisterKeySession,
  getActiveSessionCountForKey,
  markToolFinish,
  consumeToolFinishTime,
} from "../../open-sse/services/sessionManager.js";
import {
  getFingerprint,
  applyFingerprint,
  clearFingerprintCache,
  getFingerprintCacheSize,
} from "../../open-sse/services/fingerprintRotator.js";

const sampleBody = {
  model: "gemini-3-flash",
  system: "You are a helpful assistant.",
  tools: [{ name: "fetch", function: { name: "fetch" } }, { name: "shell" }],
  messages: [
    { role: "user", content: "Hello, please help me write code." },
  ],
};

describe("sessionManager — generateSessionId", () => {
  it("returns the same id for identical input", () => {
    const a = generateSessionId(sampleBody, { provider: "antigravity", connectionId: "acct-1" });
    const b = generateSessionId(sampleBody, { provider: "antigravity", connectionId: "acct-1" });
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it("returns different ids for different accounts", () => {
    const a = generateSessionId(sampleBody, { provider: "antigravity", connectionId: "acct-1" });
    const b = generateSessionId(sampleBody, { provider: "antigravity", connectionId: "acct-2" });
    expect(a).not.toBe(b);
  });

  it("returns different ids for different providers", () => {
    const a = generateSessionId(sampleBody, { provider: "antigravity", connectionId: "acct-1" });
    const b = generateSessionId(sampleBody, { provider: "kiro", connectionId: "acct-1" });
    expect(a).not.toBe(b);
  });

  it("changes id when first user message changes", () => {
    const body2 = { ...sampleBody, messages: [{ role: "user", content: "Different prompt" }] };
    const a = generateSessionId(sampleBody, { provider: "antigravity", connectionId: "acct-1" });
    const b = generateSessionId(body2, { provider: "antigravity", connectionId: "acct-1" });
    expect(a).not.toBe(b);
  });

  it("changes id when tools change", () => {
    const body2 = { ...sampleBody, tools: [{ name: "fetch" }] };
    const a = generateSessionId(sampleBody, { provider: "antigravity", connectionId: "acct-1" });
    const b = generateSessionId(body2, { provider: "antigravity", connectionId: "acct-1" });
    expect(a).not.toBe(b);
  });

  it("treats tool ORDER as irrelevant (names sorted)", () => {
    const flipped = { ...sampleBody, tools: [{ name: "shell" }, { name: "fetch" }] };
    const a = generateSessionId(sampleBody, { provider: "antigravity", connectionId: "acct-1" });
    const b = generateSessionId(flipped, { provider: "antigravity", connectionId: "acct-1" });
    expect(a).toBe(b);
  });

  it("returns null on empty / non-object input", () => {
    expect(generateSessionId(null)).toBeNull();
    expect(generateSessionId({})).toBeNull();
    expect(generateSessionId("not an object")).toBeNull();
  });
});

describe("sessionManager — pool tracking", () => {
  beforeEach(() => clearSessions());

  it("touchSession registers a new session", () => {
    touchSession("sid-1", "acct-A");
    expect(getActiveSessionCount()).toBe(1);
    expect(getSessionInfo("sid-1").requestCount).toBe(1);
  });

  it("touchSession is idempotent on the same id", () => {
    touchSession("sid-2", "acct-A");
    touchSession("sid-2", "acct-A");
    touchSession("sid-2", "acct-A");
    expect(getActiveSessionCount()).toBe(1);
    expect(getSessionInfo("sid-2").requestCount).toBe(3);
  });

  it("getActiveSessions returns session details", () => {
    touchSession("sid-3", "acct-X");
    const all = getActiveSessions();
    expect(all).toHaveLength(1);
    expect(all[0].sessionId).toBe("sid-3");
    expect(all[0].connectionId).toBe("acct-X");
    expect(all[0].ageMs).toBeGreaterThanOrEqual(0);
  });
});

describe("sessionManager — per-key tracking", () => {
  beforeEach(() => clearSessions());

  it("tracks sessions per API key", () => {
    registerKeySession("key-1", "sid-a");
    registerKeySession("key-1", "sid-b");
    registerKeySession("key-2", "sid-c");
    expect(getActiveSessionCountForKey("key-1")).toBe(2);
    expect(getActiveSessionCountForKey("key-2")).toBe(1);
    expect(getActiveSessionCountForKey("key-3")).toBe(0);
  });

  it("isSessionRegisteredForKey reports correctly", () => {
    registerKeySession("key-1", "sid-a");
    expect(isSessionRegisteredForKey("key-1", "sid-a")).toBe(true);
    expect(isSessionRegisteredForKey("key-1", "sid-b")).toBe(false);
  });

  it("unregisterKeySession removes the session and cleans empty sets", () => {
    registerKeySession("key-1", "sid-a");
    unregisterKeySession("key-1", "sid-a");
    expect(isSessionRegisteredForKey("key-1", "sid-a")).toBe(false);
    expect(getActiveSessionCountForKey("key-1")).toBe(0);
  });
});

describe("sessionManager — tool finish tracking", () => {
  beforeEach(() => clearSessions());

  it("markToolFinish + consumeToolFinishTime work as a one-shot", () => {
    touchSession("sid-7", "acct-A");
    markToolFinish("sid-7");
    const t = consumeToolFinishTime("sid-7");
    expect(t).toBeGreaterThan(0);
    // Consumed once → null thereafter
    expect(consumeToolFinishTime("sid-7")).toBeNull();
  });

  it("returns null when no tool finish recorded", () => {
    touchSession("sid-8", "acct-A");
    expect(consumeToolFinishTime("sid-8")).toBeNull();
  });
});

describe("fingerprintRotator — getFingerprint", () => {
  beforeEach(() => clearFingerprintCache());

  it("returns the same fingerprint for the same (provider, account)", () => {
    const a = getFingerprint("antigravity", "acct-1");
    const b = getFingerprint("antigravity", "acct-1");
    expect(a).toEqual(b);
  });

  it("returns different fingerprints for different accounts", () => {
    const a = getFingerprint("antigravity", "acct-1");
    const b = getFingerprint("antigravity", "acct-2");
    expect(a.buildHash).not.toBe(b.buildHash);
  });

  it("produces valid sec-ch-ua-mobile values", () => {
    const fp = getFingerprint("antigravity", "acct-1");
    expect(["?0", "?1"]).toContain(fp.secChUaMobile);
  });

  it("produces a valid platform", () => {
    const fp = getFingerprint("antigravity", "acct-1");
    expect(["macOS", "Windows", "Linux"]).toContain(fp.platform);
  });

  it("buildHash is 7 hex chars", () => {
    const fp = getFingerprint("antigravity", "acct-1");
    expect(fp.buildHash).toMatch(/^[a-f0-9]{7}$/);
  });
});

describe("fingerprintRotator — applyFingerprint", () => {
  beforeEach(() => clearFingerprintCache());

  it("returns the headers unchanged (we intentionally don't mutate upstream)", () => {
    const input = { "Content-Type": "application/json" };
    const out = applyFingerprint(input, "antigravity", "acct-1");
    expect(out).toEqual(input);
  });

  it("populates the fingerprint cache as a side-effect (for dashboard read)", () => {
    expect(getFingerprintCacheSize()).toBe(0);
    applyFingerprint({}, "antigravity", "acct-1");
    expect(getFingerprintCacheSize()).toBe(1);
  });

  it("noop when provider or accountKey missing (fail-open)", () => {
    const headers = { "Content-Type": "application/json" };
    expect(applyFingerprint(headers, null, "acct")).toEqual(headers);
    expect(applyFingerprint(headers, "antigravity", null)).toEqual(headers);
    expect(getFingerprintCacheSize()).toBe(0);
  });
});

describe("fingerprintRotator — cache behavior", () => {
  beforeEach(() => clearFingerprintCache());

  it("caches per-(provider, account) combo", () => {
    getFingerprint("antigravity", "a");
    getFingerprint("antigravity", "b");
    getFingerprint("kiro", "a");
    expect(getFingerprintCacheSize()).toBe(3);
  });

  it("clearFingerprintCache empties the cache", () => {
    getFingerprint("antigravity", "a");
    clearFingerprintCache();
    expect(getFingerprintCacheSize()).toBe(0);
  });
});
