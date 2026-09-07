import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// refreshCline goes through proxyAwareFetch, not global fetch.
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, proxyAwareFetch: vi.fn() };
});

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const SRC = path.join(process.cwd(), "open-sse/executors/default.js");

const ACCESS = "eyJhbGciOiJIUzI1NiJ9.PAYLOAD.SECRET_SIGNATURE";
const REFRESH_NEW = "rt_new_9f8e7d6c";

const okResponse = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const makeExecutor = () => new DefaultExecutor("cline", {});

afterEach(() => { vi.restoreAllMocks(); proxyAwareFetch.mockReset(); });

describe("Cline token refresh", () => {
  it("never writes the refresh payload to the console", async () => {
    // The response carries both live tokens; logging even a truncated prefix of it
    // puts working credentials in stdout.
    const logs = [];
    vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => logs.push(a.join(" ")));

    const body = { data: { accessToken: ACCESS, refreshToken: REFRESH_NEW, expiresAt: "2099-01-01T00:00:00Z" } };
    proxyAwareFetch.mockResolvedValue(okResponse(body));

    const out = await makeExecutor().refreshCline("rt_old");
    expect(out.accessToken).toBe(ACCESS);

    const all = logs.join("\n");
    expect(all).not.toContain(ACCESS);
    expect(all).not.toContain("SECRET_SIGNATURE");
    expect(all).not.toContain(REFRESH_NEW);
    expect(all).not.toContain("rt_old");
  });

  it("has no [DEBUG] logging left in the executor", () => {
    expect(fs.readFileSync(SRC, "utf-8")).not.toContain("[DEBUG]");
  });

  it("sends the extension JSON contract", async () => {
    let seen = null;
    proxyAwareFetch.mockImplementation((url, init) => {
      seen = { url, body: JSON.parse(init.body) };
      return Promise.resolve(okResponse({ data: { accessToken: ACCESS, expiresAt: "2099-01-01T00:00:00Z" } }));
    });

    await makeExecutor().refreshCline("rt_old");
    expect(seen.url).toBe("https://api.cline.bot/api/v1/auth/refresh");
    expect(seen.body).toEqual({ refreshToken: "rt_old", grantType: "refresh_token", clientType: "extension" });
  });

  it("accepts an unwrapped body as well as a { data } envelope", async () => {
    proxyAwareFetch.mockResolvedValue(
      okResponse({ accessToken: ACCESS, refreshToken: REFRESH_NEW, expiresAt: "2099-01-01T00:00:00Z" })
    );
    const out = await makeExecutor().refreshCline("rt_old");
    expect(out.accessToken).toBe(ACCESS);
    expect(out.refreshToken).toBe(REFRESH_NEW);
  });

  it("keeps the old refresh token when the response omits a new one", async () => {
    proxyAwareFetch.mockResolvedValue(
      okResponse({ data: { accessToken: ACCESS, expiresAt: "2099-01-01T00:00:00Z" } })
    );
    const out = await makeExecutor().refreshCline("rt_old");
    expect(out.refreshToken).toBe("rt_old");
  });

  it("falls back to an hour when no expiry is given", async () => {
    proxyAwareFetch.mockResolvedValue(okResponse({ data: { accessToken: ACCESS } }));
    const out = await makeExecutor().refreshCline("rt_old");
    expect(out.expiresIn).toBe(3600);
  });

  it("returns null instead of throwing when the network fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => { });
    proxyAwareFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    // A throw used to escape the caller and abort the whole request.
    await expect(makeExecutor().refreshCline("rt_old")).resolves.toBeNull();
  });

  it("returns null on a non-ok response and on a missing access token", async () => {
    vi.spyOn(console, "error").mockImplementation(() => { });
    proxyAwareFetch.mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" });
    await expect(makeExecutor().refreshCline("rt_old")).resolves.toBeNull();

    proxyAwareFetch.mockResolvedValue(okResponse({ data: {} }));
    await expect(makeExecutor().refreshCline("rt_old")).resolves.toBeNull();
  });

  it("returns null with no refresh token at all", async () => {
    await expect(makeExecutor().refreshCline(null)).resolves.toBeNull();
  });
});
