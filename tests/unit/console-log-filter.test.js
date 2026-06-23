// Tests for the access-log noise filter in src/lib/consoleLogBuffer.js
// (0.5.32). Drops dashboard-polling lines from the captured buffer so the
// real chat / auth / error traces survive maxLines eviction.

import { describe, expect, it } from "vitest";
import { isAccessLogNoise } from "../../src/lib/consoleLogBuffer.js";

describe("isAccessLogNoise — drops dashboard polling noise", () => {
  it("drops GET /api/version 200 (sidebar update banner poll)", () => {
    expect(isAccessLogNoise(" GET /api/version 200 in 391ms (next.js: 3ms, proxy.ts: 72ms, application-code: 316ms)")).toBe(true);
  });

  it("drops GET /api/settings 200 (many components poll it)", () => {
    expect(isAccessLogNoise(" GET /api/settings 200 in 11ms (next.js: 3ms, proxy.ts: 5ms, application-code: 3ms)")).toBe(true);
  });

  it("drops GET /api/auth/status 200", () => {
    expect(isAccessLogNoise(" GET /api/auth/status 200 in 985ms (next.js: 870ms)")).toBe(true);
  });

  it("drops GET /manifest.webmanifest", () => {
    expect(isAccessLogNoise(" GET /manifest.webmanifest 200 in 9ms (next.js: 3ms)")).toBe(true);
  });

  it("drops GET /api/cli-tools/antigravity-mitm (cli-tools polling)", () => {
    expect(isAccessLogNoise(" GET /api/cli-tools/antigravity-mitm 200 in 1084ms (next.js: 548ms)")).toBe(true);
  });

  it("drops GET /api/translator/console-logs/stream (the dashboard pulling its OWN logs)", () => {
    expect(isAccessLogNoise(" GET /api/translator/console-logs/stream 200 in 2.5s (next.js: 1985ms)")).toBe(true);
  });

  it("drops GET /dashboard/console-log page load", () => {
    expect(isAccessLogNoise(" GET /dashboard/console-log 200 in 407ms (next.js: 105ms)")).toBe(true);
  });

  it("drops GET /api/keys / models/alias / providers (sidebar fetches)", () => {
    expect(isAccessLogNoise(" GET /api/keys 200 in 933ms (next.js: 909ms)")).toBe(true);
    expect(isAccessLogNoise(" GET /api/models/alias 200 in 934ms (next.js: 909ms)")).toBe(true);
    expect(isAccessLogNoise(" GET /api/providers 200 in 934ms (next.js: 910ms)")).toBe(true);
  });
});

describe("isAccessLogNoise — preserves real signal", () => {
  it("KEEPS POST /v1/chat/completions (actual chat traffic)", () => {
    expect(isAccessLogNoise(" POST /v1/chat/completions 200 in 5.2s (next.js: 13ms)")).toBe(false);
  });

  it("KEEPS POST /v1/messages (Anthropic format)", () => {
    expect(isAccessLogNoise(" POST /v1/messages 200 in 3.1s")).toBe(false);
  });

  it("KEEPS 4xx / 5xx errors even on filtered paths", () => {
    expect(isAccessLogNoise(" GET /api/version 500 in 50ms")).toBe(false);
    expect(isAccessLogNoise(" GET /api/settings 401 in 5ms")).toBe(false);
    expect(isAccessLogNoise(" GET /api/keys 404 in 10ms")).toBe(false);
  });

  it("KEEPS bracketed log lines from the chat handler", () => {
    expect(isAccessLogNoise("[03:55:32] 🔍 [AUTH] antigravity | pinned to 79e7700a (movasee20@gmail.com)")).toBe(false);
    expect(isAccessLogNoise("[03:55:32] ℹ️  [ROUTING] gemini-1.5-flash → gemini/gemini-1.5-flash")).toBe(false);
    expect(isAccessLogNoise("[03:55:32] 🔍 [CACHE] Claude direct passthrough — token savers SKIPPED")).toBe(false);
  });

  it("KEEPS Next.js startup banner lines", () => {
    expect(isAccessLogNoise("▲ Next.js 16.2.9 (webpack)")).toBe(false);
    expect(isAccessLogNoise("✓ Ready in 265ms")).toBe(false);
    expect(isAccessLogNoise("[DB] Driver: better-sqlite3 | file: /Users/.../data.sqlite")).toBe(false);
  });

  it("KEEPS POST requests to filtered paths (settings save, key create, etc)", () => {
    expect(isAccessLogNoise(" POST /api/settings 200 in 50ms")).toBe(false);
    expect(isAccessLogNoise(" DELETE /api/keys 200 in 20ms")).toBe(false);
  });

  it("KEEPS unknown / future routes that aren't in the noise list", () => {
    expect(isAccessLogNoise(" GET /api/quota/refresh 200 in 100ms")).toBe(false);
    expect(isAccessLogNoise(" GET /api/some-new-endpoint 200 in 50ms")).toBe(false);
  });

  it("handles edge cases gracefully", () => {
    expect(isAccessLogNoise(null)).toBe(false);
    expect(isAccessLogNoise(undefined)).toBe(false);
    expect(isAccessLogNoise("")).toBe(false);
    expect(isAccessLogNoise("short")).toBe(false);
  });
});
