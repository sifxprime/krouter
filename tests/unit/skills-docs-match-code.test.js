import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { SKILLS_RAW_BASE } from "@/shared/constants/skills.js";
import { AI_PROVIDERS, resolveProviderId, getProviderAlias } from "@/shared/constants/providers.js";

/**
 * The skills/ files are pasted into other people's AI agents, which then act on them
 * literally. Every claim below was wrong in 0.5.163 and sent an agent (or a person)
 * somewhere that does not exist:
 *  - the dashboard "View on GitHub" link pointed at tree/master; origin has only main
 *  - "Dashboard -> Keys": there is no Keys page, keys live on the Endpoint page
 *  - "only if requireApiKey=true": remote callers need a key regardless (dashboardGuard)
 *  - /v1/models/web lists `tavily/search`, but /v1/search rejects that id as a provider
 *  - it lists Jina Reader as `jina/fetch`, and `jina` resolves to the embeddings provider
 *  - the web-fetch JS example read `.data` off a response that has no `data` field
 *  - the STT skill listed NVIDIA, which has no sttConfig, so the handler returns 400
 */

const SKILLS_DIR = "skills";
const PAGE = "src/app/(dashboard)/dashboard/skills/page.js";
// krouter-tts is maintained by a separate change; its copy of the auth line is
// reported there rather than edited here.
const NOT_SCANNED = new Set(["krouter-tts"]);

const skillDocs = () => [
  `${SKILLS_DIR}/README.md`,
  ...readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !NOT_SCANNED.has(d.name))
    .map((d) => `${SKILLS_DIR}/${d.name}/SKILL.md`)
    .filter((f) => existsSync(f)),
];
const read = (f) => readFileSync(f, "utf8");

describe("skills page", () => {
  it("links GitHub at the same branch the raw skill links use", () => {
    const branch = SKILLS_RAW_BASE.match(/refs\/heads\/([^/]+)\//)[1];
    const literalBranches = [...read(PAGE).matchAll(/\/(?:tree|blob)\/([A-Za-z0-9._-]+)\//g)].map((m) => m[1]);
    expect(literalBranches.filter((b) => b !== branch)).toEqual([]);
  });
});

describe("skills docs", () => {
  it("send readers to the Endpoint page for API keys, which exists, not a Keys page", () => {
    expect(existsSync("src/app/(dashboard)/dashboard/endpoint")).toBe(true);
    expect(existsSync("src/app/(dashboard)/dashboard/keys")).toBe(false);
    const wrong = skillDocs().filter((f) => /Dashboard\s*(→|->)\s*Keys/.test(read(f)));
    expect(wrong).toEqual([]);
  });

  it("do not say a key is needed only when requireApiKey is on", () => {
    // Remote callers always need one: dashboardGuard canAccessPublicLlmApi.
    expect(read("src/dashboardGuard.js")).toMatch(/API key required for remote API access/);
    const wrong = skillDocs().filter((f) => /only if requireApiKey|if auth enabled|omit if auth disabled/.test(read(f)));
    expect(wrong).toEqual([]);
    expect(read(`${SKILLS_DIR}/krouter/SKILL.md`)).toMatch(/key is required whenever `KROUTER_URL` is remote/);
  });

  it("say Docker callers need a key too (isLoopbackIp only accepts 127/8 and ::1)", () => {
    // Docker's port publishing forwards from the bridge gateway, not loopback (src/lib/auth/trustedPeer.js).
    expect(read("src/lib/auth/trustedPeer.js")).toMatch(/isLoopbackIp/);
    for (const f of [`${SKILLS_DIR}/README.md`, `${SKILLS_DIR}/krouter/SKILL.md`]) expect(read(f)).toMatch(/Docker/);
    const wrong = skillDocs().filter((f) => /KROUTER_KEY` when the URL is remote or/.test(read(f)));
    expect(wrong).toEqual([]);
  });

  it("do not link the parked krouter.com domain", () => {
    const wrong = skillDocs().filter((f) => /(^|[^.\w])krouter\.com/.test(read(f)));
    expect(wrong).toEqual([]);
  });

  it("show a /v1/models example without the created field the route never emits", () => {
    expect(read("src/app/api/v1/models/route.js")).not.toMatch(/\bcreated\s*:/);
    expect(read(`${SKILLS_DIR}/krouter/SKILL.md`)).not.toMatch(/"created"/);
  });
});

describe("web search / fetch skills", () => {
  it("rejects the listed `<provider>/search` id as a provider, which is why the docs strip it", () => {
    expect(AI_PROVIDERS[resolveProviderId("tavily/search")]).toBeUndefined();
    expect(read(`${SKILLS_DIR}/krouter-web-search/SKILL.md`)).toMatch(/before `\/search`/);
    expect(read(`${SKILLS_DIR}/krouter-web-fetch/SKILL.md`)).toMatch(/before `\/fetch`/);
  });

  it("name jina-reader for Jina Reader, since its listed jina/fetch strips to the embeddings provider", () => {
    // /v1/models/web prints `${getProviderAlias(id)}/fetch`; the fetch handler resolves the
    // stripped alias with resolveProviderId, which finds jina-ai (no fetchConfig) first.
    expect(getProviderAlias("jina-reader")).toBe("jina");
    expect(AI_PROVIDERS[resolveProviderId("jina")]?.fetchConfig).toBeUndefined();
    expect(read(`${SKILLS_DIR}/krouter-web-fetch/SKILL.md`)).toMatch(/`jina\/fetch`[^\n]*send `jina-reader`/);

    const check = (file, configKey) => {
      const values = [...read(file).matchAll(/"?model"?\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
      expect(values.length).toBeGreaterThan(0);
      // `*-combo` names are user-created combos, expanded before provider resolution.
      return values.filter((v) => !v.endsWith("-combo") && !AI_PROVIDERS[resolveProviderId(v)]?.[configKey]);
    };
    expect(check(`${SKILLS_DIR}/krouter-web-search/SKILL.md`, "searchConfig")).toEqual([]);
    expect(check(`${SKILLS_DIR}/krouter-web-fetch/SKILL.md`, "fetchConfig")).toEqual([]);
  });

  it("names the request field google-pse reads cx from", () => {
    // open-sse/handlers/search/index.js passes body.provider_options through.
    expect(read(`${SKILLS_DIR}/krouter-web-search/SKILL.md`)).toMatch(/provider_options\.cx/);
  });

  it("reads the web fetch result from the top level of the response", () => {
    // src/sse/handlers/fetch.js returns result.data itself, so there is no `data` key.
    const doc = read(`${SKILLS_DIR}/krouter-web-fetch/SKILL.md`);
    expect(doc).not.toMatch(/const \{ data \} = await r\.json\(\)/);
    expect(doc).toMatch(/\.content\.length/);
  });
});

describe("stt skill", () => {
  it("lists only providers that have an STT config", () => {
    const doc = read(`${SKILLS_DIR}/krouter-stt/SKILL.md`);
    const quirks = doc.slice(doc.indexOf("## Provider quirks"));
    const providers = [...quirks.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
    expect(providers.length).toBeGreaterThan(0);
    expect(providers.filter((p) => !AI_PROVIDERS[resolveProviderId(p)]?.sttConfig)).toEqual([]);
    expect(doc.split("\n")[2]).not.toMatch(/NVIDIA/);
  });
});

describe("image skill", () => {
  it("says gemini returns b64_json, since its adapter never produces a url", () => {
    expect(read("open-sse/handlers/imageProviders/gemini.js")).not.toMatch(/\burl\s*:/);
    const row = read(`${SKILLS_DIR}/krouter-image/SKILL.md`).split("\n").find((l) => l.startsWith("| `gemini`"));
    expect(row).toMatch(/b64_json/);
  });
});
