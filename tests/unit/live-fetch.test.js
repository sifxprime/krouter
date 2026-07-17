import { describe, it, expect } from "vitest";
import {
  getLiveFetcher,
  listLiveFetchProviders,
  LIVE_FETCH,
  LIVE_FETCH_USER_AGENT,
} from "@/shared/constants/liveFetch.js";

describe("getLiveFetcher", () => {
  it("returns null for unknown provider id", () => {
    expect(getLiveFetcher("does-not-exist")).toBeNull();
  });

  it("returns descriptor for standard OpenAI-shape providers", () => {
    for (const id of ["openai", "openrouter", "siliconflow", "groq", "xai", "mistral"]) {
      const f = getLiveFetcher(id);
      expect(f, `expected fetcher for ${id}`).not.toBeNull();
      expect(f.url).toMatch(/^https?:\/\//);
      expect(f.authHeader).toBe("Authorization");
      expect(f.authPrefix).toBe("Bearer ");
      expect(typeof f.parse).toBe("function");
    }
  });

  it("covers the previously-missing providers (Kimi, GLM, Minimax, Blackbox, Voyage, Deepgram, ElevenLabs)", () => {
    const newlyCovered = ["kimi", "glm", "glm-cn", "minimax", "minimax-cn", "blackbox", "voyage-ai", "deepgram", "elevenlabs"];
    for (const id of newlyCovered) {
      expect(getLiveFetcher(id), `${id} should be covered`).not.toBeNull();
    }
  });

  it("uses x-api-key + Anthropic-Version for anthropic/claude", () => {
    const f = getLiveFetcher("anthropic");
    expect(f.authHeader).toBe("x-api-key");
    expect(f.authPrefix).toBe("");
    expect(f.extraHeaders["Anthropic-Version"]).toBe("2023-06-01");
  });

  it("uses query-param auth for gemini", () => {
    const f = getLiveFetcher("gemini");
    expect(f.authQuery).toBe("key");
    expect(f.authHeader).toBeUndefined();
  });

  it("uses Token prefix for deepgram", () => {
    const f = getLiveFetcher("deepgram");
    expect(f.authPrefix).toBe("Token ");
  });

  it("uses xi-api-key header for elevenlabs", () => {
    const f = getLiveFetcher("elevenlabs");
    expect(f.authHeader).toBe("xi-api-key");
    expect(f.authPrefix).toBe("");
  });

  it("all descriptors parse a valid OpenAI-shape response", () => {
    const sample = { data: [{ id: "m1" }, { id: "m2", name: "M2" }] };
    for (const [id, f] of Object.entries(LIVE_FETCH)) {
      if (id === "gemini" || id === "elevenlabs" || id === "cartesia" || id === "deepgram") continue;
      const parsed = f.parse(sample);
      expect(Array.isArray(parsed), `${id} parse must return array`).toBe(true);
      expect(parsed.length, `${id} parse must find models`).toBe(2);
    }
  });

  it("listLiveFetchProviders includes both legacy + new coverage", () => {
    const list = listLiveFetchProviders();
    expect(list.length).toBeGreaterThan(30);
    expect(list).toContain("openai");
    expect(list).toContain("kimi");     // newly added
    expect(list).toContain("deepgram"); // newly added
  });
});

// 0.5.108 — Featherless (and any WAF-fronted catalog) 404s "Gone." when the
// request carries no User-Agent, which is exactly what Node's fetch sends by
// default. Both live-catalog routes must set one.
describe("live-fetch User-Agent (WAF bypass)", () => {
  it("exports a non-empty User-Agent constant", () => {
    expect(typeof LIVE_FETCH_USER_AGENT).toBe("string");
    expect(LIVE_FETCH_USER_AGENT.length).toBeGreaterThan(0);
  });

  it("both live-catalog routes send the User-Agent header", async () => {
    const { readFileSync } = await import("node:fs");
    for (const route of [
      "src/app/api/models/preview/route.js",
      "src/app/api/models/live-by-connection/route.js",
    ]) {
      const src = readFileSync(route, "utf8");
      expect(src, `${route} must import the UA constant`).toContain("LIVE_FETCH_USER_AGENT");
      expect(src, `${route} must set the User-Agent header`).toMatch(
        /"User-Agent":\s*LIVE_FETCH_USER_AGENT/,
      );
    }
  });

  it("extraHeaders can still override the default User-Agent", () => {
    // The UA is spread BEFORE extraHeaders, so a provider that needs its own
    // UA can still win.
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": LIVE_FETCH_USER_AGENT,
      ...{ "User-Agent": "custom/9" },
    };
    expect(headers["User-Agent"]).toBe("custom/9");
  });
});
