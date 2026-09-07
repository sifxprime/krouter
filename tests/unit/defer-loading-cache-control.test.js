/**
 * Regression: Anthropic rejects a tool that carries BOTH `defer_loading: true`
 * and `cache_control`:
 *
 *   [400] Tool 'mcp__x__y' cannot both defer_loading=true cache_control set.
 *         Tools defer_loading cannot use prompt caching.
 *
 * We anchor the 1h cache breakpoint on the LAST tool of the array with no guard.
 * Clients that speak MCP (Claude Code) put deferred tools at the tail, so the
 * anchor lands exactly on a tool that cannot be cached and the request 400s
 * before combo fallback can try the next hop.
 *
 * The fix anchors on the last tool that is NOT deferred, so prompt caching is
 * kept for the tools that can use it instead of being dropped wholesale.
 *
 * Ported from upstream 6ab9ca9e (#3567). Upstream also patches anchorClaudeCache
 * in translator/formats/claude.js; this fork has no such function, so only the
 * prepareClaudeRequest path applies -- plus direct coverage of the helper.
 */

import { describe, it, expect } from "vitest";
import { prepareClaudeRequest, lastCacheableToolIndex } from "../../open-sse/translator/helpers/claudeHelper.js";

const tool = (name, extra = {}) => ({
  name,
  description: "t",
  input_schema: { type: "object", properties: {} },
  ...extra,
});

describe("defer_loading tools never carry cache_control (#3567)", () => {
  it("picks the last non-deferred tool as the anchor", () => {
    expect(lastCacheableToolIndex([tool("a"), tool("b"), tool("m", { defer_loading: true })])).toBe(1);
  });

  it("returns -1 when every tool is deferred, so nothing is cached", () => {
    expect(lastCacheableToolIndex([
      tool("m1", { defer_loading: true }),
      tool("m2", { defer_loading: true }),
    ])).toBe(-1);
  });

  it("is unchanged when no tool is deferred", () => {
    expect(lastCacheableToolIndex([tool("a"), tool("b")])).toBe(1);
  });

  it("treats a non-true defer_loading as cacheable", () => {
    // Only an explicit `true` triggers the Anthropic rejection.
    expect(lastCacheableToolIndex([tool("a"), tool("b", { defer_loading: false })])).toBe(1);
  });

  it("handles a missing or non-array tools field", () => {
    expect(lastCacheableToolIndex(undefined)).toBe(-1);
    expect(lastCacheableToolIndex([])).toBe(-1);
  });

  it("prepareClaudeRequest: deferred tail tool does not get the anchor", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "hi" }],
      tools: [tool("a"), tool("mcp__x__y", { defer_loading: true })],
    }, "claude");

    expect(out.tools).toHaveLength(2);
    expect(out.tools[1].cache_control).toBeUndefined();
    expect(out.tools[1].defer_loading).toBe(true);
    expect(out.tools[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("prepareClaudeRequest: strips a cache_control the client put on a deferred tool", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "hi" }],
      tools: [tool("mcp__a", { defer_loading: true, cache_control: { type: "ephemeral" } })],
    }, "claude");

    expect(out.tools[0].cache_control).toBeUndefined();
  });

  it("prepareClaudeRequest: unchanged when no tool is deferred", () => {
    const out = prepareClaudeRequest({
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "hi" }],
      tools: [tool("a"), tool("b")],
    }, "claude");

    expect(out.tools[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(out.tools[0].cache_control).toBeUndefined();
  });
});
