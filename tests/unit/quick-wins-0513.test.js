import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("v0.5.113 quick wins", () => {
  it("SEARXNG_URL env overrides the searxng base url", () => {
    const src = readFileSync("open-sse/handlers/search/callers.js", "utf8");
    expect(src).toMatch(/SEARXNG_URL_OVERRIDE/);
    expect(src).toMatch(/process\.env\.SEARXNG_URL/);
    const cfg = readFileSync("open-sse/config/runtimeConfig.js", "utf8");
    expect(cfg).toMatch(/export const SEARXNG_URL/);
  });

  it("bulk-delete handler + button are wired", () => {
    const src = readFileSync("src/app/(dashboard)/dashboard/providers/[id]/page.js", "utf8");
    expect(src).toMatch(/const handleBulkDelete/);
    expect(src).toMatch(/Delete Selected \(\{selectedConnectionIds\.length\}\)/);
  });

  it("kiro publishes the GPT-5.6 base models", () => {
    const ids = PROVIDER_MODELS.kr.map((m) => m.id);
    expect(ids).toContain("gpt-5.6-sol");
    expect(ids).toContain("gpt-5.6-terra");
    expect(ids).toContain("gpt-5.6-luna");
  });

  it("responses->openai strips client_metadata", () => {
    const out = openaiResponsesToOpenAIRequest("gpt-5", {
      input: [{ role: "user", content: "hi" }],
      client_metadata: { foo: "bar" },
      store: true,
    }, false, {});
    expect(out.client_metadata).toBeUndefined();
  });

  it("startup gates the auto-ping scheduler on an enabled connection", () => {
    const src = readFileSync("src/shared/services/initializeApp.js", "utf8");
    expect(src).toMatch(/function hasQuotaAutoPingEnabled/);
    expect(src).toMatch(/if \(hasQuotaAutoPingEnabled\(settings\)\) startQuotaAutoPing\(\)/);
    // The gate must return true only when a connection is toggled on.
    const on = { claudeAutoPing: { connections: { c1: true } }, codexAutoPing: {} };
    const off = { claudeAutoPing: { connections: { c1: false } }, codexAutoPing: { connections: {} } };
    const check = (s) => [s?.claudeAutoPing, s?.codexAutoPing].some((c) => Object.values(c?.connections || {}).some(Boolean));
    expect(check(on)).toBe(true);
    expect(check(off)).toBe(false);
  });
});
