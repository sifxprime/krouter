/**
 * 0.5.169 — a parked model must not answer 503 "retry after 30m" to a 404.
 *
 * When every account for a model is inside its cooldown, 0.5.166 pinned the reply to
 * 503 + Retry-After rather than the last upstream status, because a stale 401 made
 * Claude Code treat a cooldown as a bad key (upstream 15687d19). Right for a credential
 * or rate-limit status — the account may genuinely recover.
 *
 * Wrong for 404. A 404 says the thing asked for is not there, and no wait changes that,
 * so 503 + Retry-After parks the client on something that will still be missing. Worse,
 * it replaces an actionable error ("that model id does not exist, pick another") with an
 * unactionable one ("service unavailable, try in 30 minutes").
 *
 * Reproduced on a live install against ag/gemini-3.8-flash-high, an id kRouter's own
 * /v1/models advertises:
 *   attempt 1   404 model_not_found   1.71s    the honest upstream answer
 *   attempt 2   503 "reset after 30m" 0.04s    locked
 *   attempt 3   503 "reset after 30m" 0.04s
 * The connection row held errorCode 404 and modelLock_* keys for nine models, two of
 * which serve fine, so healthy models reach this path too.
 *
 * After the fix the same three attempts return 404 with no Retry-After, still in 0.04s:
 * the cooldown's fast-skip is kept, only the reported status becomes honest.
 */
import { describe, it, expect } from "vitest";
import { parkedAccountStatus } from "../../open-sse/services/accountFallback.js";

const DEFAULT = 503;

describe("a request-scoped status is reported as itself", () => {
  it("404 is reported, not flattened to 503", () => {
    expect(parkedAccountStatus(404, DEFAULT)).toBe(404);
  });

  it("a string code from the DB is handled too", () => {
    // connection.data.errorCode round-trips through JSON and has been seen as a string.
    expect(parkedAccountStatus("404", DEFAULT)).toBe(404);
  });
});

describe("the 0.5.166 protection is kept for everything else", () => {
  it.each([
    ["401 — a stale credential status is what broke Claude Code", 401],
    ["403 — needs re-verification, may recover", 403],
    ["429 — rate limited, Retry-After is the right answer", 429],
    ["500", 500],
    ["502", 502],
    ["503", 503],
    ["529 — overloaded", 529],
    ["400 — not a naming error", 400],
    ["402 — billing", 402],
  ])("%s stays 503", (_label, code) => {
    expect(parkedAccountStatus(code, DEFAULT)).toBe(DEFAULT);
  });
});

describe("missing or junk codes fall back", () => {
  it.each([[null], [undefined], [""], ["nonsense"], [NaN], [0]])("%p falls back to the default", (code) => {
    expect(parkedAccountStatus(code, DEFAULT)).toBe(DEFAULT);
  });

  it("honours a caller's non-503 default", () => {
    expect(parkedAccountStatus(429, 500)).toBe(500);
  });
});

describe("the handlers that report it are wired", () => {
  it("chat and embeddings use the helper instead of a hardcoded 503", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/sse/handlers/chat.js", "src/sse/handlers/embeddings.js"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("parkedAccountStatus(credentials.lastErrorCode");
    }
  });

  it("chat sends no Retry-After when it reports a request-scoped status", () => {
    const { readFileSync } = require("node:fs");
    const src = readFileSync("src/sse/handlers/chat.js", "utf8");
    // unavailableResponse is what attaches Retry-After; the carve-out must bypass it.
    expect(src).toMatch(/if \(status !== HTTP_STATUS\.SERVICE_UNAVAILABLE\) \{\s*\n\s*return errorResponse\(status,/);
  });
});
