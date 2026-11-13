/**
 * The client's Anthropic-Beta flags must survive the trip upstream.
 *
 * A beta flag authorises the request-body fields that depend on it, so dropping
 * one does not make Anthropic ignore the field — it makes Anthropic reject the
 * request. `selectAnthropicBeta` returned a hardcoded list and the Claude
 * executor assigned it unconditionally, so every flag a newer client sent was
 * discarded. Captured from a real Claude Code through MITM, one turn:
 *
 *   400 safeguards: Extra inputs are not permitted
 *   400 thread: Extra inputs are not permitted
 *   400 tools.50: Input tag 'advisor_20260301' ... does not match any of the
 *       expected tags: 'bash_20250124', ... 'web_search_20260318'
 *   400 thinking.adaptive.display: Input should be 'summarized', 'omitted'
 *
 * then a fifth attempt succeeded. The body had reached Anthropic untouched —
 * the router even logged "PASSTHROUGH claude -> claude | native lossless" — so
 * the loss was entirely in the header. The client degraded its feature set on
 * each retry until a shape fit the flags we were sending, which is why some
 * turns worked at the cost of several rejected upstream calls, and why anything
 * it could not degrade failed outright.
 *
 * `anthropic-beta` was already whitelisted into credentials.rawHeaders by
 * pickForwardableClientHeaders. Nothing on the Claude path read it — the only
 * consumers were kiro, opencode, opencode-go and cursor — so it was collected
 * and thrown away.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { selectAnthropicBeta } from "../../open-sse/config/providers.js";

const split = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

// The four flag names are illustrative: the point is that ANY flag the client
// sends arrives, because we cannot know next month's.
const CLIENT_FLAGS = "safeguards-2026-03-01,threads-2026-02-18,advisor-2026-03-01,adaptive-thinking-2026-03-10";

describe("Anthropic-Beta merging", () => {
  it("keeps every flag the client sent", () => {
    const out = split(selectAnthropicBeta("claude-opus-5", {}, CLIENT_FLAGS));
    for (const flag of split(CLIENT_FLAGS)) {
      expect(out, `${flag} was dropped — Anthropic will 400 the field that needs it`).toContain(flag);
    }
  });

  it("still sends the flags we require", () => {
    // These are ours, not the client's: OAuth auth, the Claude Code identity the
    // upstream gates on, and caching. Losing them breaks the request entirely.
    const out = split(selectAnthropicBeta("claude-opus-5", {}, CLIENT_FLAGS));
    for (const flag of ["oauth-2025-04-20", "claude-code-20250219", "context-management-2025-06-27"]) {
      expect(out, `${flag} is required by this provider`).toContain(flag);
    }
  });

  it("adds the heavy-agent flags only for opus and sonnet", () => {
    const heavy = ["advanced-tool-use-2025-11-20", "effort-2025-11-24"];
    const opus = split(selectAnthropicBeta("claude-opus-5", {}, ""));
    const haiku = split(selectAnthropicBeta("claude-haiku-5-5", {}, ""));
    for (const f of heavy) {
      expect(opus).toContain(f);
      expect(haiku, `${f} is not wanted for haiku`).not.toContain(f);
    }
  });

  it("does not duplicate a flag the client also sent", () => {
    const out = split(selectAnthropicBeta("claude-opus-5", {}, "oauth-2025-04-20,safeguards-2026-03-01"));
    expect(out.filter((f) => f === "oauth-2025-04-20")).toHaveLength(1);
  });

  it("still drops redact-thinking when the body asks for summaries", () => {
    // Applied to the merged set, so a client sending it alongside
    // thinking.display "summarized" does not get blanked summaries.
    const body = { thinking: { display: "summarized" } };
    const out = split(selectAnthropicBeta("claude-opus-5", body, "redact-thinking-2026-02-12,safeguards-2026-03-01"));
    expect(out).not.toContain("redact-thinking-2026-02-12");
    expect(out, "the client's other flags are unaffected").toContain("safeguards-2026-03-01");
  });

  it("behaves exactly as before when the client sends nothing", () => {
    // No client header is the common case for translated requests, and it must
    // not change.
    const plain = selectAnthropicBeta("claude-opus-5", {});
    expect(selectAnthropicBeta("claude-opus-5", {}, "")).toBe(plain);
    expect(selectAnthropicBeta("claude-opus-5", {}, undefined)).toBe(plain);
    expect(selectAnthropicBeta("claude-opus-5", {}, null)).toBe(plain);
  });

  it("tolerates a malformed client header", () => {
    const out = split(selectAnthropicBeta("claude-opus-5", {}, " , ,,  safeguards-2026-03-01 , "));
    expect(out).toContain("safeguards-2026-03-01");
    expect(out.every((f) => f.length > 0)).toBe(true);
  });

  it("passes the client header at EVERY call site that talks to Anthropic", () => {
    // The first version of this fix wired only one of the two. The other branch
    // serves a node that fronts Anthropic with a real claude-* model, and its
    // own comment records this same 400 ("Extra inputs are not permitted") being
    // hit once and patched by adding a single flag to the static list. A merge
    // that covers one site leaves the other to keep recurring.
    const src = fs.readFileSync(path.join(process.cwd(), "open-sse/executors/default.js"), "utf8");
    const calls = [...src.matchAll(/selectAnthropicBeta\(([\s\S]{0,160}?)\)/g)].map((m) => m[1]);
    expect(calls.length, "expected both Anthropic call sites").toBeGreaterThanOrEqual(2);
    for (const args of calls) {
      expect(args, `a call site still discards the client flags: ${args.replace(/\s+/g, " ").trim()}`).toMatch(/rawHeaders/);
    }
  });

  it("is wired to the client header in the Claude executor", () => {
    // The merge is worthless if the executor keeps calling it with two
    // arguments; that was the whole defect.
    const src = fs.readFileSync(path.join(process.cwd(), "open-sse/executors/default.js"), "utf8");
    const call = src.match(/selectAnthropicBeta\(\s*model,\s*body,([\s\S]{0,120}?)\)/);
    expect(call, "the executor must pass a third argument").toBeTruthy();
    expect(call[1], "it must come from the client's forwarded headers").toMatch(/rawHeaders/);
    expect(call[1]).toMatch(/anthropic-beta/);
  });
});
