// Tier 2.C — integration test for the reactive 400-retry self-heal at
// base.js:284. Verifies the loop ports the d20703c findOffendingField fix
// end-to-end: upstream 400 mentioning a bare-name field → kRouter strips
// that field → sends a second request → returns the recovered response.
//
// Mocks proxyAwareFetch so we don't hit a real provider. Uses the
// DefaultExecutor since it routes through the base.execute() retry path
// without any provider-specific wrapping.

import { describe, expect, it, vi, beforeEach } from "vitest";

const proxyFetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => proxyFetchMock(...args),
}));

const { DefaultExecutor } = await import("../../open-sse/executors/default.js");

function res(status, body, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function makeExecutor(provider = "groq") {
  const executor = new DefaultExecutor(provider);
  // Stub out the URL builder so we don't need a real config entry
  executor.buildUrl = () => "https://fake.local/v1/chat/completions";
  // Stub buildHeaders to return a known shape
  executor.buildHeaders = () => ({ Authorization: "Bearer fake" });
  // Override fallback count to 1 so we don't iterate URLs
  executor.getFallbackCount = () => 1;
  return executor;
}

function baseCall(body) {
  return {
    model: "test-model",
    body,
    stream: false,
    credentials: { connectionId: "c1", apiKey: "fake" },
    signal: undefined,
    log: { debug: () => {}, info: () => {}, warn: () => {} },
  };
}

describe("base.execute reactive 400-retry (Tier 2.C verification)", () => {
  beforeEach(() => {
    proxyFetchMock.mockReset();
  });

  it("strips bare-named field (Groq shape) and retries successfully", async () => {
    // First call: 400 with bare-named field. Second call: 200 OK.
    proxyFetchMock
      .mockResolvedValueOnce(res(400, '{"error":{"message":"Unknown parameter: logprobs"}}'))
      .mockResolvedValueOnce(res(200, { choices: [{ message: { content: "ok" } }] }));

    const executor = makeExecutor("groq");
    const result = await executor.execute(baseCall({
      messages: [{ role: "user", content: "hi" }],
      logprobs: true,
      temperature: 0.5,
    }));

    expect(proxyFetchMock.mock.calls.length).toBe(2);
    expect(result.response.status).toBe(200);

    // The second call must NOT contain the offending field
    const secondCallBody = JSON.parse(proxyFetchMock.mock.calls[1][1].body);
    expect("logprobs" in secondCallBody).toBe(false);
    // Other fields preserved
    expect(secondCallBody.temperature).toBe(0.5);
    expect(secondCallBody.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("strips OpenRouter-shape bare field (no quotes around name)", async () => {
    proxyFetchMock
      .mockResolvedValueOnce(res(400, '{"error":"unrecognized field reasoning_content"}'))
      .mockResolvedValueOnce(res(200, { ok: true }));

    const executor = makeExecutor("openrouter");
    const result = await executor.execute(baseCall({
      messages: [{ role: "user", content: "hi" }],
      reasoning_content: "extra",
      max_tokens: 100,
    }));

    expect(proxyFetchMock.mock.calls.length).toBe(2);
    expect(result.response.status).toBe(200);
    const secondCallBody = JSON.parse(proxyFetchMock.mock.calls[1][1].body);
    expect("reasoning_content" in secondCallBody).toBe(false);
    expect(secondCallBody.max_tokens).toBe(100);
  });

  it("strips escaped-double-quote shape ({\"detail\":\"Field \\\"presence_penalty\\\"...\"})", async () => {
    proxyFetchMock
      .mockResolvedValueOnce(res(400, '{"detail":"Field \\"presence_penalty\\" invalid"}'))
      .mockResolvedValueOnce(res(200, { ok: true }));

    const executor = makeExecutor("groq");
    const result = await executor.execute(baseCall({
      messages: [{ role: "user", content: "hi" }],
      presence_penalty: 0.5,
    }));

    expect(proxyFetchMock.mock.calls.length).toBe(2);
    const secondCallBody = JSON.parse(proxyFetchMock.mock.calls[1][1].body);
    expect("presence_penalty" in secondCallBody).toBe(false);
  });

  it("does NOT retry when 400 mentions an unknown field name (not in KNOWN_OFFENDING_FIELDS)", async () => {
    proxyFetchMock
      .mockResolvedValueOnce(res(400, '{"error":"Unknown parameter: my_custom_field"}'));

    const executor = makeExecutor("groq");
    const result = await executor.execute(baseCall({
      messages: [{ role: "user", content: "hi" }],
      my_custom_field: "value",
    }));

    // Only ONE call — the retry doesn't fire because my_custom_field
    // isn't in the offending-fields allowlist
    expect(proxyFetchMock.mock.calls.length).toBe(1);
    expect(result.response.status).toBe(400);
  });

  it("does NOT retry on a plain 400 with no field name in the body", async () => {
    proxyFetchMock
      .mockResolvedValueOnce(res(400, '{"error":"Bad request"}'));

    const executor = makeExecutor("groq");
    const result = await executor.execute(baseCall({
      messages: [{ role: "user", content: "hi" }],
    }));

    expect(proxyFetchMock.mock.calls.length).toBe(1);
    expect(result.response.status).toBe(400);
  });

  it("retry returns its response status even if it's also a 400 (no infinite loop)", async () => {
    // 1st: 400 mentions logprobs. 2nd retry: ALSO 400 (model bad-shape).
    // Critical: retry fires ONCE, doesn't loop forever.
    proxyFetchMock
      .mockResolvedValueOnce(res(400, '{"error":"Unknown parameter: logprobs"}'))
      .mockResolvedValueOnce(res(400, '{"error":"Another problem"}'));

    const executor = makeExecutor("groq");
    const result = await executor.execute(baseCall({
      messages: [{ role: "user", content: "hi" }],
      logprobs: true,
    }));

    // Exactly 2 calls — the original + 1 retry — then bail
    expect(proxyFetchMock.mock.calls.length).toBe(2);
    expect(result.response.status).toBe(400);
  });
});
