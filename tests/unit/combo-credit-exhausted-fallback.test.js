// A provider that answers HTTP 400 "insufficient credits" has a drained credential, not
// a bad request. No ERROR_RULES entry claimed that wording, so it fell through to the
// request-scoped 4xx branch: cooldownMs 0 and shouldFallback false. A combo did still
// advance to its next member (that part came with the request-scoped change), but the
// exhausted key took no cooldown, so the account picker kept choosing it for every
// later request and each one burned another round trip on a key with no money on it.
//
// kRouter already named Anthropic's wording ("credit balance is too low"); this adds the
// phrasing the other upstreams use. Upstream b82f5c4a, #4713.
import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("a credit-exhausted 400 cools the credential down", () => {
  it("fails over and cools down on 'insufficient credits'", () => {
    const r = checkFallbackError(400, "You have insufficient credits for this request", 0, "deepseek");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
    expect(r.requestScoped).toBeUndefined();
  });

  // Substring matching means the singular rule covers both spellings.
  it("matches the singular wording too", () => {
    const r = checkFallbackError(400, "Error: insufficient credit", 0, "openai");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("is case-insensitive and tolerates a JSON error body", () => {
    const r = checkFallbackError(400, { error: { message: "INSUFFICIENT CREDITS" } }, 0, "glm");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  // The rule kRouter already had, kept here so the pair cannot drift apart.
  it("still handles Anthropic's wording", () => {
    const r = checkFallbackError(400, "Your credit balance is too low to access the API", 0, "claude");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  // Not a permanent condition: topping up restores the key, so it must not be
  // account-locked or marked permanent the way a suspension is.
  it("does not lock the whole account or mark it permanent", () => {
    const r = checkFallbackError(400, "insufficient credits", 0, "deepseek");
    expect(r.accountLock).toBe(false);
    expect(r.permanent).toBe(false);
  });
});

describe("unrelated 400s are still request-scoped", () => {
  it("leaves a genuine validation error alone", () => {
    const r = checkFallbackError(400, "Unsupported parameter: 'top_k'", 0, "openai");
    expect(r.requestScoped).toBe(true);
    expect(r.shouldFallback).toBe(false);
    expect(r.cooldownMs).toBe(0);
  });

  // "credit" on its own must not trip the rule — only the exhaustion wordings.
  it("does not match an unrelated mention of credit", () => {
    const r = checkFallbackError(400, "field 'credit_card' is not supported", 0, "openai");
    expect(r.requestScoped).toBe(true);
    expect(r.cooldownMs).toBe(0);
  });
});
