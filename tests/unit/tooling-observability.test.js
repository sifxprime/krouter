// Tests for toolLimitDetector + circuitBreaker (0.5.30).
import { describe, expect, it, beforeEach } from "vitest";
import {
  isToolLimitError,
  stripNonEssentialTools,
} from "../../open-sse/services/toolLimitDetector.js";
import {
  isCircuitBreakerOpen,
  recordProviderSuccess,
  recordProviderFailure,
  getAllCircuitBreakerStatuses,
  _clearCircuitBreakers,
} from "../../src/shared/utils/circuitBreaker.js";

describe("toolLimitDetector", () => {
  it("recognizes 400 errors with known too-many-tools text", () => {
    expect(isToolLimitError(400, '{"error": "Too many tools provided"}')).toBe(true);
    expect(isToolLimitError(400, "schema too large for model context")).toBe(true);
    expect(isToolLimitError(400, "maximum number of tools is 10")).toBe(true);
    expect(isToolLimitError(400, "function declarations exceed limit")).toBe(true);
  });

  it("ignores non-400 errors", () => {
    expect(isToolLimitError(500, "too many tools")).toBe(false);
  });

  it("ignores unrelated 400 errors", () => {
    expect(isToolLimitError(400, "Bad Request")).toBe(false);
  });

  it("stripNonEssentialTools preserves core tools and drops heavy MCPs", () => {
    const body = {
      tools: [
        { name: "bash" },
        { name: "mcp__github__search_repos" },
        { name: "read_file" },
        { name: "custom_agent_tool" },
      ],
    };
    const stripped = stripNonEssentialTools(body);
    const names = stripped.tools.map(t => t.name);
    expect(names).toContain("bash");
    expect(names).toContain("read_file");
    expect(names).toContain("custom_agent_tool");
    expect(names).not.toContain("mcp__github__search_repos");
    expect(stripped.tools.length).toBe(3);
  });

  it("handles missing/empty tools gracefully", () => {
    expect(stripNonEssentialTools({})).toEqual({});
    expect(stripNonEssentialTools({ tools: [] })).toEqual({ tools: [] });
  });
});

describe("circuitBreaker", () => {
  beforeEach(() => _clearCircuitBreakers());

  it("is closed by default", () => {
    expect(isCircuitBreakerOpen("test")).toBe(false);
  });

  it("trips after 10 consecutive 500s", () => {
    for (let i = 0; i < 9; i++) {
      expect(recordProviderFailure("test", 502)).toBe(false);
      expect(isCircuitBreakerOpen("test")).toBe(false);
    }
    // 10th failure trips it
    expect(recordProviderFailure("test", 503)).toBe(true);
    expect(isCircuitBreakerOpen("test")).toBe(true);
  });

  it("resets consecutive failures on success", () => {
    for (let i = 0; i < 9; i++) recordProviderFailure("test", 500);
    recordProviderSuccess("test");
    recordProviderFailure("test", 500);
    expect(isCircuitBreakerOpen("test")).toBe(false); // Only 1 failure since reset
  });

  it("ignores 4xx and 429s (they don't count as provider failure)", () => {
    for (let i = 0; i < 20; i++) recordProviderFailure("test", 400);
    for (let i = 0; i < 20; i++) recordProviderFailure("test", 429);
    expect(isCircuitBreakerOpen("test")).toBe(false);
  });

  it("getAllCircuitBreakerStatuses returns state snapshot", () => {
    for (let i = 0; i < 5; i++) recordProviderFailure("half", 500);
    for (let i = 0; i < 10; i++) recordProviderFailure("open", 500);
    recordProviderSuccess("closed");

    const st = getAllCircuitBreakerStatuses();
    expect(st.half.status).toBe("half-open");
    expect(st.half.failures).toBe(5);
    expect(st.open.status).toBe("open");
    expect(st.open.resetsInMs).toBeGreaterThan(0);
    expect(st.closed.status).toBe("closed");
  });
});
