/**
 * A failed web search must not take the account offline for chat.
 *
 * providerId in src/sse/handlers/search.js is an ordinary AI_PROVIDERS entry, so
 * search draws on the same connections chat does. markAccountUnavailable with no
 * model writes modelLock___all — an account-level lock that isModelLockActive()
 * honours for every model — so one search error disabled chat on that connection.
 *
 * Ported from upstream ec669280, adapted: upstream scopes via its credentialFallback
 * path, which this fork does not have; here the same collision arrives through the
 * shared provider id, and our lock key is the existing `model` parameter.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { buildModelLockUpdate, isModelLockActive } from "../../open-sse/services/accountFallback.js";

const src = () => fs.readFileSync(
  path.join(process.cwd(), "src/sse/handlers/search.js"), "utf-8")
  .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("web search locks are scoped to search", () => {
  it("passes a search-scoped key when marking an account unavailable", () => {
    const s = src();
    expect(s).toContain("const searchLockKey = `websearch:${providerId}`");
    expect(s).toContain("result.error, providerId, searchLockKey)");
  });

  it("reads credentials back under the same key it locks with", () => {
    // Locking under one key and reading under another silently ignores the lock.
    expect(src()).toContain("getProviderCredentials(providerId, excludeConnectionIds, searchLockKey)");
  });

  it("a scoped key does not produce the account-wide lock", () => {
    const scoped = buildModelLockUpdate("websearch:gemini", 60000);
    const accountWide = buildModelLockUpdate(null, 60000);
    expect(Object.keys(accountWide)).toEqual(["modelLock___all"]);
    expect(Object.keys(scoped)).not.toEqual(["modelLock___all"]);
  });

  it("a search lock does not make the connection look locked for chat", () => {
    const conn = buildModelLockUpdate("websearch:gemini", 60_000);
    // Same connection, asked about a chat model: must read as usable.
    expect(isModelLockActive(conn, "gemini-2.5-pro")).toBe(false);
    // And the search scope itself is genuinely locked.
    expect(isModelLockActive(conn, "websearch:gemini")).toBe(true);
  });

  it("an account-wide lock still blocks everything", () => {
    const conn = buildModelLockUpdate(null, 60_000);
    expect(isModelLockActive(conn, "gemini-2.5-pro")).toBe(true);
  });
});
