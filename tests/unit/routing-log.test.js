import { describe, it, expect, beforeEach } from "vitest";
import {
  logRoutingDecision,
  readRoutingLog,
  clearRoutingLog,
} from "../../open-sse/services/routingLog.js";

describe("routingLog ring buffer", () => {
  beforeEach(() => clearRoutingLog());

  it("noop on missing connectionId", () => {
    logRoutingDecision({ success: true });
    expect(readRoutingLog()).toEqual([]);
  });

  it("records in newest-first order", () => {
    logRoutingDecision({ connectionId: "a", success: true, latencyMs: 100 });
    logRoutingDecision({ connectionId: "b", success: false });
    const out = readRoutingLog();
    expect(out[0].connectionId).toBe("b");
    expect(out[1].connectionId).toBe("a");
  });

  it("respects limit", () => {
    for (let i = 0; i < 10; i++) logRoutingDecision({ connectionId: `c${i}`, success: true });
    expect(readRoutingLog(3).length).toBe(3);
  });

  it("preserves last 200 when overflowing (ring behavior)", () => {
    for (let i = 0; i < 350; i++) logRoutingDecision({ connectionId: `c${i}`, success: true });
    const out = readRoutingLog();
    expect(out.length).toBe(200);
    // Newest is the last inserted
    expect(out[0].connectionId).toBe("c349");
    // Oldest kept is c150 (350 - 200)
    expect(out[out.length - 1].connectionId).toBe("c150");
  });

  it("stamps at + copies meta fields", () => {
    logRoutingDecision({
      connectionId: "x",
      success: true,
      latencyMs: 42,
      provider: "siliconflow",
      model: "gpt-4o",
      score: 923,
      strategy: "zenith",
    });
    const e = readRoutingLog(1)[0];
    expect(e.provider).toBe("siliconflow");
    expect(e.model).toBe("gpt-4o");
    expect(e.score).toBe(923);
    expect(e.strategy).toBe("zenith");
    expect(typeof e.at).toBe("number");
    expect(e.at).toBeLessThanOrEqual(Date.now());
  });
});
