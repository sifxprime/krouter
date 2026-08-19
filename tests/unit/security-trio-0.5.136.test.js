import { describe, it, expect } from "vitest";
import { resolveBaseUrl } from "@/../open-sse/handlers/search/callers.js";
const cfg = { baseUrl: "https://google.serper.dev" };
const withOverride = (u) => ({ providerOptions: { baseUrl: u } });
describe("SSRF guard on search baseUrl", () => {
  it("blocks cloud metadata", () => {
    expect(() => resolveBaseUrl(cfg, withOverride("http://169.254.169.254/latest/meta-data/"))).toThrow();
  });
  it("blocks loopback + private ranges", () => {
    for (const u of ["http://127.0.0.1:20128/api/settings","http://localhost:8080","http://192.168.1.1/","http://10.0.0.5/","http://[::1]/"]) {
      expect(() => resolveBaseUrl(cfg, withOverride(u)), u).toThrow();
    }
  });
  it("blocks non-http schemes", () => {
    expect(() => resolveBaseUrl(cfg, withOverride("file:///etc/passwd"))).toThrow();
  });
  it("still allows a legitimate public override", () => {
    expect(resolveBaseUrl(cfg, withOverride("https://api.search.brave.com/"))).toBe("https://api.search.brave.com");
  });
  it("default (no override) unchanged", () => {
    expect(resolveBaseUrl(cfg, {})).toBe("https://google.serper.dev");
  });
});
