import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { isChatRequest } = require("../../src/mitm/config.js");
const { __test__ } = require("../../src/mitm/handlers/kiro.js");
const { buildInitialResponseFrame, withInitialFrame, initKiroState, buildEventStreamFrame } = __test__;

/** Decode an AWS EventStream frame the way the Smithy client does. */
function decodeFrame(buf) {
  const totalLen = buf.readUInt32BE(0);
  const headersLen = buf.readUInt32BE(4);
  const headers = {};
  let off = 12;
  const end = 12 + headersLen;
  while (off < end) {
    const nameLen = buf[off]; off += 1;
    const name = buf.slice(off, off + nameLen).toString("utf8"); off += nameLen;
    const type = buf[off]; off += 1;
    if (type !== 7) break; // string
    const valLen = buf.readUInt16BE(off); off += 2;
    headers[name] = buf.slice(off, off + valLen).toString("utf8"); off += valLen;
  }
  const payload = buf.slice(12 + headersLen, totalLen - 4).toString("utf8");
  return { totalLen, headers, payload, declaredLenMatches: totalLen === buf.length };
}

describe("0.5.137 — Kiro IDE 1.0.228+ chat interception (5b417f9b)", () => {
  const req = (url, headers = {}) => ({ url, headers });

  it("intercepts the NEW header form (POST / + x-amz-target) — this was bypassing MITM", () => {
    expect(isChatRequest("kiro", req("/", { "x-amz-target": "KiroRuntimeService.GenerateAssistantResponse" }))).toBe(true);
  });

  it("still intercepts the legacy path form", () => {
    expect(isChatRequest("kiro", req("/generateAssistantResponse"))).toBe(true);
  });

  it("passes through non-chat calls on the same host", () => {
    expect(isChatRequest("kiro", req("/", { "x-amz-target": "KiroRuntimeService.ListAvailableModels" }))).toBe(false);
    expect(isChatRequest("kiro", req("/"))).toBe(false);
  });

  it("does not leak the kiro header rule to other tools", () => {
    expect(isChatRequest("copilot", req("/", { "x-amz-target": "GenerateAssistantResponse" }))).toBe(false);
    expect(isChatRequest("copilot", req("/chat/completions"))).toBe(true);
  });
});

describe("0.5.137 — mandatory initial-response frame", () => {
  it("decodes with the Smithy system headers the client requires", () => {
    const d = decodeFrame(buildInitialResponseFrame("conv-1"));
    expect(d.declaredLenMatches).toBe(true);
    expect(d.headers[":message-type"]).toBe("event");
    expect(d.headers[":event-type"]).toBe("initial-response");
    expect(d.headers[":content-type"]).toBe("application/x-amz-json-1.0");
    expect(JSON.parse(d.payload)).toEqual({ conversationId: "conv-1" });
  });

  it("is emitted exactly once per stream, before the first real event", () => {
    const state = initKiroState("claude-sonnet-4.5");
    const first = withInitialFrame(state, buildEventStreamFrame("assistantResponseEvent", { content: "hi" }));
    expect(Array.isArray(first)).toBe(true);
    expect(decodeFrame(first[0]).headers[":event-type"]).toBe("initial-response");
    expect(decodeFrame(first[1]).headers[":event-type"]).toBe("assistantResponseEvent");

    // second call must NOT repeat it, and must preserve the single-frame shape
    const second = withInitialFrame(state, buildEventStreamFrame("messageStopEvent", {}));
    expect(Array.isArray(second)).toBe(false);
    expect(decodeFrame(second).headers[":event-type"]).toBe("messageStopEvent");
  });

  it("emits the initial frame even when the first chunk carries no events", () => {
    const state = initKiroState("auto");
    const out = withInitialFrame(state, null);
    expect(decodeFrame(out).headers[":event-type"]).toBe("initial-response");
    expect(withInitialFrame(state, null)).toBeNull(); // nothing further
  });

  it("regular frames keep application/json", () => {
    expect(decodeFrame(buildEventStreamFrame("assistantResponseEvent", { content: "x" })).headers[":content-type"])
      .toBe("application/json");
  });
});
