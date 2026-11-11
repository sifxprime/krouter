// Strict Proxy did not hold (upstream #4333, 24664f2c). With a strict pool
// assigned but unusable (inactive, saved without a url, or a pool lookup that
// throws), requests still went out over the direct IP, the leak the setting
// exists to prevent.
//
// Layers, one describe each:
//
// 1. resolveConnectionProxyConfig dropped strictProxy whenever the pool was not
//    usable: isValidPool gated the only two returns that carried it, so an
//    unusable strict pool fell through to the legacy/none returns. Its catch
//    block also reported strictProxy:false when the pool lookup threw.
// 2. proxyAwareFetch only honoured strictProxy inside the catch of a proxy
//    attempt. With no proxy url resolved there was nothing to try, so it
//    connected directly, and for MITM-bypass hosts (api.anthropic.com,
//    cloudcode-pa, api2.cursor.sh, ...) it dialed the real IP by hand.
// 3. The Cursor executor opened a direct HTTP/2 socket whenever no proxy url
//    was enabled, strict or not (the case upstream cfd8c618 guards).
// 4. Relay pools and the MITM-bypass request spread options.headers, which
//    turns a Headers instance into {} (upstream 6af26a9e).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

const net = vi.hoisted(() => ({ dnsIp: null, dnsQueries: [], httpsRequests: [] }));

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(),
}));

// proxyFetch resolves MITM-bypass hosts through Google DNS and dials them with
// https.request. Stub both so no test reaches the network.
vi.mock("dns", () => {
  class Resolver {
    setServers() {}
    resolve4(hostname, cb) {
      net.dnsQueries.push(hostname);
      if (net.dnsIp) cb(null, [net.dnsIp]);
      else cb(new Error("dns disabled in test"));
    }
  }
  return { Resolver, default: { Resolver } };
});

vi.mock("https", () => {
  class Agent {}
  function request(options, onResponse) {
    net.httpsRequests.push(options);
    return {
      on() {},
      write() {},
      end() {
        const res = Object.assign(Readable.from([]), { statusCode: 200, statusMessage: "OK", headers: {} });
        onResponse(res);
      },
    };
  }
  return { Agent, request, default: { Agent, request } };
});

// proxyFetch captures globalThis.fetch at import time as its "direct" fetch.
// Stub it first so a direct connection is observable instead of real. The other
// half of that boundary is the environment: HTTP_PROXY / HTTPS_PROXY / ALL_PROXY
// resolve a proxy for any request that carries none, which satisfies strict and
// skips every refusal below. tests/setup/no-ambient-proxy.js scrubs them.
const realFetch = globalThis.fetch;
const directFetch = vi.fn(async () => new Response("{}", { status: 200 }));
globalThis.fetch = directFetch;

const { getProxyPoolById } = await import("@/models");
const { resolveConnectionProxyConfig } = await import("../../src/lib/network/connectionProxy.js");
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
const { CursorExecutor } = await import("../../open-sse/executors/cursor.js");

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  directFetch.mockClear();
  getProxyPoolById.mockReset();
  net.dnsIp = null;
  net.dnsQueries.length = 0;
  net.httpsRequests.length = 0;
});

const STRICT_REFUSAL = /Proxy required but none resolved \(strictProxy=true\)/;

describe("an unusable strict pool keeps strictProxy", () => {
  it("keeps strictProxy for an inactive strict pool", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p1", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p1" });
    expect(cfg).toMatchObject({ source: "none", proxyPoolId: "p1", strictProxy: true, connectionProxyEnabled: false });
  });

  it("keeps strictProxy for a strict pool saved without a proxy url", async () => {
    getProxyPoolById.mockResolvedValue({ id: "p2", isActive: true, proxyUrl: "", strictProxy: true });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p2" });
    expect(cfg.strictProxy).toBe(true);
  });

  it("keeps strictProxy when an inactive strict pool falls back to the legacy proxy", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p1", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({
      proxyPoolId: "p1", connectionProxyEnabled: true, connectionProxyUrl: "http://10.0.0.2:3128",
    });
    expect(cfg).toMatchObject({ source: "legacy", strictProxy: true, connectionProxyUrl: "http://10.0.0.2:3128" });
  });

  it("still reports strictProxy:false for a non-strict pool", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p3", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: false,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p3" });
    expect(cfg.strictProxy).toBe(false);
  });

  it("still reports strictProxy:false when no pool is assigned", async () => {
    const cfg = await resolveConnectionProxyConfig({});
    expect(cfg.strictProxy).toBe(false);
    expect(getProxyPoolById).not.toHaveBeenCalled();
  });

  it("treats __none__ as no pool", async () => {
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "__none__" });
    expect(cfg).toMatchObject({ proxyPoolId: null, strictProxy: false });
    expect(getProxyPoolById).not.toHaveBeenCalled();
  });
});

describe("a pool lookup that throws fails closed", () => {
  it("returns strictProxy:true with the pool id when a pool was assigned", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getProxyPoolById.mockRejectedValue(new Error("SQLITE_BUSY"));
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p9" });
    expect(cfg).toMatchObject({
      source: "error", proxyPoolId: "p9", strictProxy: true, connectionProxyEnabled: false, connectionProxyUrl: "",
    });
    errSpy.mockRestore();
  });

  it("the fail-closed config refuses to connect directly", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getProxyPoolById.mockRejectedValue(new Error("SQLITE_BUSY"));
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p9" });
    await expect(proxyAwareFetch("https://api.example.com/v1/chat", {}, cfg)).rejects.toThrow(STRICT_REFUSAL);
    expect(directFetch).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("strictProxy refuses a direct connection when no proxy resolves", () => {
  it("throws when a pool is assigned but no proxy url resolved", async () => {
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", {}, { proxyPoolId: "p1", strictProxy: true }),
    ).rejects.toThrow(STRICT_REFUSAL);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("throws when the proxy is enabled but carries an empty url", async () => {
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", {}, { enabled: true, url: "", strictProxy: true }),
    ).rejects.toThrow(STRICT_REFUSAL);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("an inactive strict pool's resolved config refuses to connect directly", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p1", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({ proxyPoolId: "p1" });
    await expect(proxyAwareFetch("https://api.example.com/v1/chat", {}, cfg)).rejects.toThrow(STRICT_REFUSAL);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("does not dial the real IP of a MITM-bypass host by hand", async () => {
    net.dnsIp = "203.0.113.7";
    await expect(
      proxyAwareFetch("https://api.anthropic.com/v1/messages", { method: "POST" }, { proxyPoolId: "p1", strictProxy: true }),
    ).rejects.toThrow(STRICT_REFUSAL);
    expect(net.dnsQueries).toEqual([]);
    expect(net.httpsRequests).toEqual([]);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("still goes through a strict proxy that resolves", async () => {
    await proxyAwareFetch("https://api.example.com/v1/chat", {}, {
      proxyPoolId: "p1", strictProxy: true, connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:7890",
    });
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(directFetch.mock.calls[0][1].dispatcher?.constructor?.name).toBe("ProxyAgent");
  });

  it("lets a host the strict pool lists in noProxy go direct", async () => {
    await proxyAwareFetch("https://api.example.com/v1/chat", {}, {
      proxyPoolId: "p1", strictProxy: true, connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:7890", connectionNoProxy: "example.com",
    });
    expect(directFetch).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale legacy noProxy exempt an inactive strict pool", async () => {
    // Switching a connection to a pool leaves its legacy proxy fields saved, so
    // a disabled legacy proxy can still carry a noProxy of "*".
    getProxyPoolById.mockResolvedValue({
      id: "p1", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({
      proxyPoolId: "p1", connectionProxyEnabled: false, connectionNoProxy: "*",
    });
    await expect(proxyAwareFetch("https://api.example.com/v1/chat", {}, cfg)).rejects.toThrow(STRICT_REFUSAL);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("only the noProxy of a configured proxy exempts a strict request", async () => {
    await expect(
      proxyAwareFetch("https://api.example.com/v1/chat", {}, {
        proxyPoolId: "p1", strictProxy: true, connectionProxyEnabled: false, connectionNoProxy: "example.com",
      }),
    ).rejects.toThrow(STRICT_REFUSAL);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("sends a legacy noProxy host through the legacy proxy while a strict pool is down", async () => {
    // The legacy noProxy is ignored while the pool works; honouring it only when
    // the pool is down would be exactly a fall back to direct.
    getProxyPoolById.mockResolvedValue({
      id: "p1", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: true,
    });
    const cfg = await resolveConnectionProxyConfig({
      proxyPoolId: "p1", connectionProxyEnabled: true,
      connectionProxyUrl: "http://10.0.0.2:3128", connectionNoProxy: "example.com",
    });
    expect(cfg).toMatchObject({ source: "legacy", strictProxy: true, connectionNoProxy: "" });
    await proxyAwareFetch("https://api.example.com/v1/chat", {}, cfg);
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(directFetch.mock.calls[0][1].dispatcher?.constructor?.name).toBe("ProxyAgent");
  });

  it("keeps the legacy noProxy when the unusable pool is not strict", async () => {
    getProxyPoolById.mockResolvedValue({
      id: "p3", isActive: false, proxyUrl: "http://127.0.0.1:7890", strictProxy: false,
    });
    const cfg = await resolveConnectionProxyConfig({
      proxyPoolId: "p3", connectionProxyEnabled: true,
      connectionProxyUrl: "http://10.0.0.2:3128", connectionNoProxy: "example.com",
    });
    expect(cfg.connectionNoProxy).toBe("example.com");
  });

  it("does not block a caller that sets strictProxy with no proxy configured", async () => {
    // Upstream's Qoder executor passes strictProxy:true to mean "do not replay
    // this request directly if the proxy fails"; with nothing configured it
    // must still reach the network. kRouter keeps the same gate.
    await proxyAwareFetch("https://api.example.com/v1/chat", {}, { strictProxy: true });
    expect(directFetch).toHaveBeenCalledTimes(1);
  });

  it("does not block an unusable pool that is not strict", async () => {
    await proxyAwareFetch("https://api.example.com/v1/chat", {}, { proxyPoolId: "p3", strictProxy: false });
    expect(directFetch).toHaveBeenCalledTimes(1);
  });
});

describe("Cursor does not open a direct HTTP/2 socket under a strict pool", () => {
  const credentials = { accessToken: "tok", providerSpecificData: { machineId: "machine-1" } };
  const body = { messages: [{ role: "user", content: "hi" }] };
  const h2Reply = { status: 418, headers: {}, body: Buffer.from("teapot") };

  it("refuses when a strict pool resolved no proxy", async () => {
    const exec = new CursorExecutor();
    const h2 = vi.spyOn(exec, "makeHttp2Request").mockResolvedValue(h2Reply);
    const { response } = await exec.execute({
      model: "claude-4.5-sonnet", body, stream: true, credentials,
      proxyOptions: { proxyPoolId: "p1", strictProxy: true, connectionProxyEnabled: false, connectionProxyUrl: "" },
    });
    expect(h2).not.toHaveBeenCalled();
    expect(directFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    expect((await response.json()).error.message).toMatch(STRICT_REFUSAL);
  });

  it("keeps HTTP/2 when no proxy is configured", async () => {
    const exec = new CursorExecutor();
    const h2 = vi.spyOn(exec, "makeHttp2Request").mockResolvedValue(h2Reply);
    await exec.execute({ model: "claude-4.5-sonnet", body, stream: true, credentials, proxyOptions: { strictProxy: false } });
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("keeps HTTP/2 when strictProxy is set but no proxy is intended", async () => {
    const exec = new CursorExecutor();
    const h2 = vi.spyOn(exec, "makeHttp2Request").mockResolvedValue(h2Reply);
    await exec.execute({ model: "claude-4.5-sonnet", body, stream: true, credentials, proxyOptions: { strictProxy: true } });
    expect(h2).toHaveBeenCalledTimes(1);
  });
});

describe("Headers-instance request headers survive the relay and the MITM bypass", () => {
  it("a relay pool forwards Authorization and Content-Type from a Headers instance", async () => {
    const headers = new Headers({ Authorization: "Bearer sk-test", "Content-Type": "application/json" });
    await proxyAwareFetch(
      "https://api.openai.com/v1/chat/completions?x=1",
      { method: "POST", headers, body: "{}" },
      { vercelRelayUrl: "https://relay.example.vercel.app" },
    );
    expect(directFetch).toHaveBeenCalledTimes(1);
    const [relayUrl, init] = directFetch.mock.calls[0];
    expect(relayUrl).toBe("https://relay.example.vercel.app");
    expect(init.headers).toMatchObject({
      authorization: "Bearer sk-test",
      "content-type": "application/json",
      "x-relay-target": "https://api.openai.com",
      "x-relay-path": "/v1/chat/completions?x=1",
    });
  });

  it("a relay pool does not write relay headers into the caller's header object", async () => {
    const headers = { Authorization: "Bearer sk-test" };
    await proxyAwareFetch("https://api.openai.com/v1/chat/completions", { headers }, { vercelRelayUrl: "https://relay.example" });
    expect(headers).toEqual({ Authorization: "Bearer sk-test" });
    expect(directFetch.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer sk-test", "x-relay-target": "https://api.openai.com" });
  });

  it("the MITM-bypass request keeps headers from a Headers instance", async () => {
    net.dnsIp = "203.0.113.7";
    const headers = new Headers({ Authorization: "Bearer cursor-token", "Content-Type": "application/connect+proto" });
    const res = await proxyAwareFetch("https://api2.cursor.sh/aiserver.v1.ChatService/Run", { method: "POST", headers, body: "x" }, null);
    expect(res.status).toBe(200);
    expect(net.httpsRequests).toHaveLength(1);
    expect(net.httpsRequests[0].host).toBe("203.0.113.7");
    expect(net.httpsRequests[0].headers).toMatchObject({
      authorization: "Bearer cursor-token",
      "content-type": "application/connect+proto",
      Host: "api2.cursor.sh",
    });
  });
});
