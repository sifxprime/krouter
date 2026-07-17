import { describe, expect, it, vi } from "vitest";
import { compressWithPxpipe, formatPxpipeLog } from "../../open-sse/rtk/pxpipe.js";

const bigText = "x".repeat(30000);
const claudeBody = () => ({
  model: "claude-fable-5",
  max_tokens: 100,
  messages: [{ role: "user", content: bigText }],
});

// A transform double mimicking pxpipe-proxy/transform's contract.
const appliedTransform = (outBody) => async () => ({
  applied: true,
  reason: "applied",
  body: new TextEncoder().encode(JSON.stringify(outBody)),
  info: { compressedChars: 25000, imageCount: 2, imageBytes: 5000, imagePixels: 1500000 },
  cache: { ownsCacheControl: true, markerCount: 1 },
});

describe("compressWithPxpipe gates", () => {
  it("skips when disabled", async () => {
    const { body, summary } = await compressWithPxpipe(claudeBody(), { enabled: false });
    expect(body).toBeNull();
    expect(summary.reason).toBe("disabled");
  });

  it("skips when transform is unavailable (not installed)", async () => {
    const { body, summary } = await compressWithPxpipe(claudeBody(), { enabled: true, format: "claude", transform: null });
    expect(body).toBeNull();
    expect(summary.reason).toBe("not_installed");
  });

  it("skips non-Claude formats", async () => {
    const transform = vi.fn();
    const { body, summary } = await compressWithPxpipe(claudeBody(), { enabled: true, format: "openai", transform });
    expect(body).toBeNull();
    expect(summary.reason).toBe("unsupported_format");
    expect(transform).not.toHaveBeenCalled();
  });

  it("bypasses small prompts below minChars", async () => {
    const transform = vi.fn();
    const small = { model: "claude-fable-5", messages: [{ role: "user", content: "hi" }] };
    const { body, summary } = await compressWithPxpipe(small, { enabled: true, format: "claude", minChars: 25000, transform });
    expect(body).toBeNull();
    expect(summary.reason).toBe("below_threshold");
    expect(transform).not.toHaveBeenCalled();
  });

  it("applies the transform and reports savings", async () => {
    const compressed = { model: "claude-fable-5", messages: [{ role: "user", content: "imaged" }] };
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "claude", minChars: 1000, transform: appliedTransform(compressed),
    });
    expect(body).toEqual(compressed);
    expect(summary.applied).toBe(true);
    expect(summary.imageCount).toBe(2);
    expect(summary.tokensBeforeEst).toBeGreaterThan(summary.tokensAfterEst);
    expect(summary.savedPct).toBeGreaterThan(0);
    expect(formatPxpipeLog(summary)).toContain("2 image(s)");
  });

  it("passes through when the transform declines (not_profitable)", async () => {
    const transform = async () => ({ applied: false, reason: "not_profitable", body: new Uint8Array(), info: {} });
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "claude", minChars: 1000, transform,
    });
    expect(body).toBeNull();
    expect(summary.reason).toBe("not_profitable");
  });

  it("fails open when the transform throws", async () => {
    const transform = async () => { throw new Error("boom"); };
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "claude", minChars: 1000, transform,
    });
    expect(body).toBeNull();
    expect(summary.reason).toBe("transform_error");
    expect(summary.detail).toBe("boom");
  });

  it("fails open on timeout", async () => {
    const transform = () => new Promise(() => {}); // never resolves
    const { body, summary } = await compressWithPxpipe(claudeBody(), {
      enabled: true, format: "claude", minChars: 1000, timeoutMs: 50, transform,
    });
    expect(body).toBeNull();
    expect(summary.reason).toBe("timeout");
  });

  it("does not log skipped requests as savings", () => {
    expect(formatPxpipeLog({ applied: false, reason: "below_threshold" })).toBeNull();
    expect(formatPxpipeLog(null)).toBeNull();
  });
});

describe("pxpipe integration wiring (0.5.111)", () => {
  it("chat.js passes the pxpipe transform + event hook to both chatCore calls", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/sse/handlers/chat.js", "utf8");
    // Loaded lazily and only when enabled (fail-open when not installed).
    // resolvePxpipeTransform configures the model allowlist then loads the transform.
    expect(src).toMatch(/pxpipeTransform: await resolvePxpipeTransform\(settings\)/);
    expect(src).toMatch(/onPxpipeEvent: appendPxpipeEvent/);
    // Both the primary and fallback handleChatCore calls must be wired.
    const occurrences = src.match(/pxpipeTransform:/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("chatCore runs pxpipe last in the token-saver block and threads the summary", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("open-sse/handlers/chatCore.js", "utf8");
    expect(src).toMatch(/compressWithPxpipe\(translatedBody/);
    // Threaded to the request-detail log via sharedCtx.
    expect(src).toMatch(/pxpipe: pxpipeSummary/);
  });

  it("settings default pxpipe off with a sane threshold", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/db/repos/settingsRepo.js", "utf8");
    expect(src).toMatch(/pxpipeEnabled: false/);
    expect(src).toMatch(/pxpipeMinChars: 25000/);
  });
});

describe("pxpipe model allowlist (0.5.112 fix — feature was inert without it)", () => {
  it("chat.js configures the allowlist before loading the transform", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/sse/handlers/chat.js", "utf8");
    // Without this, pxpipe-proxy images ONLY claude-fable-5 and real traffic
    // (claude-opus-4-8, …) returns unsupported_model — the feature does nothing.
    expect(src).toMatch(/configurePxpipeModels\(settings\.pxpipeModels\)/);
    expect(src).toMatch(/resolvePxpipeTransform\(settings\)/);
  });

  it("settings default the allowlist to vision-capable Claude bases", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/db/repos/settingsRepo.js", "utf8");
    expect(src).toMatch(/pxpipeModels:\s*\[/);
    expect(src).toMatch(/claude-opus-4/);
  });

  it("the loader exposes configureModelBases + install exposes applicabilityEntry", async () => {
    const loader = await import("@/lib/pxpipe/loader.js");
    const install = await import("@/lib/pxpipe/install.js");
    expect(typeof loader.configureModelBases).toBe("function");
    expect(typeof install.applicabilityEntry).toBe("function");
    // configureModelBases must not throw when the package isn't loadable.
    await loader.configureModelBases(["claude-opus-4"]);
  });
});
