import { describe, it, expect } from "vitest";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { PROVIDERS as BACKEND_PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { PROVIDERS as OAUTH_PROVIDER_IDS, CLINEPASS_CONFIG, CLINE_CONFIG } from "@/lib/oauth/constants/oauth";
import { resolveClinepassModels } from "../../open-sse/services/clinepassModels.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { readFileSync, existsSync } from "node:fs";

// 0.5.109 — Tier C OAuth providers ported from upstream.
//
// Every provider needs all four wiring points or it half-works in a way that
// only shows up at runtime: UI manifest, backend routing, model catalog, and
// the alias map. Two shipped bugs in this fork came from missing one of them,
// so these are asserted together per provider.
const TIER_C = [
  { id: "clinepass", alias: "clinepass", name: "ClinePass" },
  { id: "codebuddy-cn", alias: "cbcn", name: "CodeBuddy CN" },
  { id: "kimchi", alias: "kimchi", name: "Kimchi" },
  { id: "grok-cli", alias: "gcli", name: "Grok CLI (Grok Build)" },
];

describe.each(TIER_C)("$name ($id) — provider wiring", ({ id, alias }) => {
  it("is in the UI manifest with OAuth declared", () => {
    const p = AI_PROVIDERS[id];
    expect(p, `${id} missing from AI_PROVIDERS`).toBeTruthy();
    expect(p.id).toBe(id);
    expect(p.alias).toBe(alias);
    expect(p.hasOAuth).toBe(true);
    expect(p.authModes).toContain("oauth");
  });

  it("is in the backend routing table", () => {
    const p = BACKEND_PROVIDERS[id];
    expect(p, `${id} missing from backend PROVIDERS`).toBeTruthy();
    expect(typeof p.baseUrl).toBe("string");
    expect(p.baseUrl).toMatch(/^https:\/\//);
    expect(typeof p.format).toBe("string");
  });

  it("maps id -> alias, and the alias owns a non-empty model list", () => {
    expect(PROVIDER_ID_TO_ALIAS[id]).toBe(alias);
    const models = PROVIDER_MODELS[alias];
    expect(Array.isArray(models), `PROVIDER_MODELS["${alias}"] must exist`).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    models.forEach((m) => {
      expect(typeof m.id).toBe("string");
      expect(typeof m.name).toBe("string");
    });
  });

  it("does not collide with an existing alias", () => {
    const owners = Object.entries(PROVIDER_ID_TO_ALIAS).filter(([, a]) => a === alias);
    expect(owners.map(([k]) => k)).toEqual([id]);
  });

  it("is in the request-routing alias map (services/model.js)", async () => {
    // The map that actually routes "<alias>/<model>" -> provider at request
    // time. It is SEPARATE from PROVIDER_ID_TO_ALIAS, so a provider can pass
    // every other check here and still route to the wrong upstream. That is
    // not hypothetical: gcli/* silently reached api.x.ai and 401'd with
    // invalid_issuer until this was added.
    const src = readFileSync("open-sse/services/model.js", "utf8");
    expect(src, `alias "${alias}" missing from ALIAS_TO_PROVIDER_ID`).toMatch(
      new RegExp(`["']?${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?:\\s*["']${id}["']`),
    );
  });

  it("ships a real logo", () => {
    const path = `public/providers/${id}.png`;
    expect(existsSync(path), `${path} missing`).toBe(true);
    // PNG magic number — guards against an empty or truncated extract.
    expect(readFileSync(path).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});

describe("ClinePass — OAuth flow", () => {
  it("is registered in the OAuth provider enum", () => {
    expect(OAUTH_PROVIDER_IDS.CLINEPASS).toBe("clinepass");
  });

  it("derives its endpoints from CLINE_CONFIG rather than hardcoding them", () => {
    // ClinePass authenticates against Cline's own auth host. Deriving means a
    // change to Cline's host cannot leave ClinePass pointing at a stale URL.
    expect(CLINEPASS_CONFIG).toEqual(CLINE_CONFIG);
    expect(CLINEPASS_CONFIG.authorizeUrl).toMatch(/^https:\/\/api\.cline\.bot/);
  });

  it("uses authorization_code without PKCE and builds an extension auth url", async () => {
    const { getProvider } = await import("@/lib/oauth/providers");
    const cp = getProvider("clinepass");
    expect(cp.flowType).toBe("authorization_code");
    const url = cp.buildAuthUrl(CLINEPASS_CONFIG, "http://localhost:9/cb");
    expect(url).toContain("client_type=extension");
    expect(url).toContain("callback_url=");
    expect(url).not.toContain("code_challenge");
  });

  it("decodes Cline's base64-in-code payload locally (no network call)", async () => {
    const { getProvider } = await import("@/lib/oauth/providers");
    const cp = getProvider("clinepass");
    const payload = {
      accessToken: "at-123",
      refreshToken: "rt-456",
      email: "u@example.com",
      firstName: "Ada",
      lastName: "L",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    const code = Buffer.from(JSON.stringify(payload)).toString("base64").replace(/=+$/, "");
    const tokens = await cp.exchangeToken(CLINEPASS_CONFIG, code, "http://localhost:9/cb");
    expect(tokens.access_token).toBe("at-123");
    expect(tokens.refresh_token).toBe("rt-456");
    expect(tokens.email).toBe("u@example.com");

    const mapped = cp.mapTokens(tokens);
    expect(mapped.accessToken).toBe("at-123");
    expect(mapped.expiresIn).toBeGreaterThan(3000);
    expect(mapped.providerSpecificData).toEqual({ firstName: "Ada", lastName: "L" });
  });

  it("shares the cline flow shape (both derive from one factory)", async () => {
    const { getProvider } = await import("@/lib/oauth/providers");
    const cline = getProvider("cline");
    const cp = getProvider("clinepass");
    expect(cp.flowType).toBe(cline.flowType);
    // Same behaviour, different config object.
    expect(cp.config).not.toBe(cline.config);
  });
});

describe("ClinePass — model catalog", () => {
  it("returns null when there is no credential (never throws)", async () => {
    expect(await resolveClinepassModels({})).toBeNull();
    expect(await resolveClinepassModels(null)).toBeNull();
  });

  it("only publishes cline-pass/ namespaced models", () => {
    PROVIDER_MODELS.clinepass.forEach((m) => {
      expect(m.id.startsWith("cline-pass/"), `${m.id} must be namespaced`).toBe(true);
    });
  });
});

describe("ClinePass — Cline header path (regression)", () => {
  // clinepass hits Cline's API, so it MUST take the buildClineHeaders branch.
  // Falling through to the generic Bearer branch sends an unprefixed token
  // (no workos:) and Cline rejects it — a silent 401 with no obvious cause.
  it("the executor routes clinepass through buildClineHeaders", () => {
    const src = readFileSync("open-sse/executors/default.js", "utf8");
    expect(src).toMatch(/this\.provider === "cline" \|\| this\.provider === "clinepass"/);
  });

  it("provider.js routes clinepass through buildClineHeaders", () => {
    const src = readFileSync("open-sse/services/provider.js", "utf8");
    expect(src).toMatch(/case "cline":\s*\n\s*case "clinepass":/);
  });

  it("clinepass refresh reuses the Cline refresh path", () => {
    const src = readFileSync("open-sse/executors/default.js", "utf8");
    expect(src).toMatch(/clinepass: \(\) => this\.refreshCline/);
  });

  it("the oauth route exempts clinepass and kimchi from the PKCE requirement", () => {
    const src = readFileSync("src/app/api/oauth/[provider]/[action]/route.js", "utf8");
    expect(src).toMatch(/noPkceExchangeProviders = \["cline", "clinepass", "kimchi"\]/);
  });
});

describe("CodeBuddy CN — gateway quirks", () => {
  it("uses the v2 endpoint (v1 is dead — live probe returns 404 Route Not Found)", () => {
    const url = BACKEND_PROVIDERS["codebuddy-cn"].baseUrl;
    expect(url).toBe("https://copilot.tencent.com/v2/chat/completions");
    expect(url).not.toContain("/v1/");
  });

  it("sends the CLI fingerprint headers the gateway gates on", () => {
    const h = BACKEND_PROVIDERS["codebuddy-cn"].headers;
    expect(h["User-Agent"]).toMatch(/CodeBuddy/);
    expect(h["X-Product"]).toBe("SaaS");
    expect(h["x-codebuddy-request"]).toBe("1");
  });

  it("forces stream:true — the gateway rejects non-stream with code 11101", async () => {
    const { CodeBuddyExecutor } = await import("../../open-sse/executors/codebuddy-cn.js");
    const ex = new CodeBuddyExecutor();
    const out = ex.transformRequest("glm-5.2", { messages: [{ role: "user", content: "hi" }], stream: false }, false, {});
    expect(out.stream).toBe(true);
  });

  it("defaults reasoning_effort and sets reasoning_summary so reasoning surfaces", async () => {
    const { CodeBuddyExecutor } = await import("../../open-sse/executors/codebuddy-cn.js");
    const ex = new CodeBuddyExecutor();
    const out = ex.transformRequest("glm-5.2", { messages: [] }, true, {});
    expect(out.reasoning_effort).toBe("medium");
    expect(out.reasoning_summary).toBe("auto");
  });

  it("omits reasoning_effort entirely for none/off (gateway has no such tier)", async () => {
    const { CodeBuddyExecutor } = await import("../../open-sse/executors/codebuddy-cn.js");
    const ex = new CodeBuddyExecutor();
    for (const off of ["none", "off"]) {
      const out = ex.transformRequest("glm-5.2", { messages: [], reasoning_effort: off }, true, {});
      expect(out.reasoning_effort, `${off} must be omitted, not forwarded`).toBeUndefined();
      expect(out.reasoning_summary).toBeUndefined();
    }
  });

  it("preserves an explicit reasoning_effort", async () => {
    const { CodeBuddyExecutor } = await import("../../open-sse/executors/codebuddy-cn.js");
    const ex = new CodeBuddyExecutor();
    const out = ex.transformRequest("glm-5.2", { messages: [], reasoning_effort: "high" }, true, {});
    expect(out.reasoning_effort).toBe("high");
    expect(out.reasoning_summary).toBe("auto");
  });

  it("is registered as an executor under its own id", async () => {
    const { getExecutor } = await import("../../open-sse/executors/index.js");
    const ex = getExecutor("codebuddy-cn");
    expect(ex.constructor.name).toBe("CodeBuddyExecutor");
  });

  it("every published model routes through OpenAI-style reasoning, not vendor-native", async () => {
    const { getCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");
    // CodeBuddy is a unified gateway — a Kimi model reached through it takes
    // reasoning_effort, NOT Kimi's native thinking shape. Getting this wrong
    // sends a body the gateway rejects.
    PROVIDER_MODELS.cbcn.forEach((m) => {
      const caps = getCapabilitiesForModel("codebuddy-cn", m.id);
      expect(caps.thinkingFormat, `${m.id} must use openai thinking format`).toBe("openai");
      expect(caps.reasoning).toBe(true);
    });
  });

  it("the old dead `codebuddy` id is fully gone", () => {
    // It was commented out of the UI since our initial release and pointed at
    // the dead v1 endpoint, so no connection can exist with the old id.
    expect(BACKEND_PROVIDERS.codebuddy).toBeUndefined();
    expect(AI_PROVIDERS.codebuddy).toBeUndefined();
    expect(OAUTH_PROVIDER_IDS.CODEBUDDY).toBe("codebuddy-cn");
  });

  it("refresh goes through the header-based Tencent path", () => {
    const src = readFileSync("open-sse/executors/default.js", "utf8");
    expect(src).toMatch(/"codebuddy-cn": \(\) => this\.refreshCodebuddy/);
    expect(src).toMatch(/"X-Refresh-Token": refreshToken/);
  });
});

describe("Kimchi — OpenAI gateway request shaping", () => {
  const mk = async () => {
    const { KimchiExecutor } = await import("../../open-sse/executors/kimchi.js");
    return new KimchiExecutor();
  };

  it("merges a top-level Claude `system` into messages instead of dropping it", async () => {
    const ex = await mk();
    const out = ex.transformRequest("kimi-k2.7", {
      system: "be terse",
      messages: [{ role: "user", content: "hi" }],
    }, true, {});
    expect(out.system).toBeUndefined();
    expect(out.messages[0]).toEqual({ role: "system", content: "be terse" });
    expect(out.messages[1].role).toBe("user");
  });

  it("prepends to an existing system message rather than clobbering it", async () => {
    const ex = await mk();
    const out = ex.transformRequest("kimi-k2.7", {
      system: "outer",
      messages: [{ role: "system", content: "inner" }, { role: "user", content: "hi" }],
    }, true, {});
    expect(out.messages[0].content).toBe("outer\n\ninner");
  });

  it("flattens an array-form system prompt", async () => {
    const ex = await mk();
    const out = ex.transformRequest("kimi-k2.7", {
      system: [{ text: "a" }, { text: "b" }],
      messages: [{ role: "user", content: "hi" }],
    }, true, {});
    expect(out.messages[0].content).toBe("a\nb");
  });

  it("drops Anthropic-only top-level fields the gateway rejects", async () => {
    const ex = await mk();
    const out = ex.transformRequest("kimi-k2.7", {
      messages: [{ role: "user", content: "hi" }],
      anthropic_version: "2023-06-01",
      anthropic_beta: "x",
      mcp_servers: [],
      stop_sequences: ["\n"],
      thinking: { type: "enabled" },
      top_k: 5,
      client_metadata: { a: 1 },
    }, true, {});
    for (const k of ["anthropic_version", "anthropic_beta", "mcp_servers", "stop_sequences", "thinking", "top_k", "client_metadata"]) {
      expect(out[k], `${k} must be dropped`).toBeUndefined();
    }
  });

  it("strips cache_control and signature artifacts from messages and tools", async () => {
    const ex = await mk();
    const out = ex.transformRequest("kimi-k2.7", {
      messages: [{
        role: "user",
        cache_control: { type: "ephemeral" },
        content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" }, signature: "sig" }],
      }],
      tools: [{ name: "t", cache_control: { type: "ephemeral" } }],
    }, true, {});
    expect(out.messages[0].cache_control).toBeUndefined();
    expect(out.messages[0].content[0].cache_control).toBeUndefined();
    expect(out.messages[0].content[0].signature).toBeUndefined();
    expect(out.messages[0].content[0].text).toBe("hi");
    expect(out.tools[0].cache_control).toBeUndefined();
    expect(out.tools[0].name).toBe("t");
  });

  it("drops reasoning params for Anthropic-backed models (they reject them)", async () => {
    const ex = await mk();
    const out = ex.transformRequest("claude-sonnet-4-6", {
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    }, true, {});
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("keeps reasoning params for non-Anthropic models", async () => {
    const ex = await mk();
    const out = ex.transformRequest("minimax-m3", {
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    }, true, {});
    expect(out.reasoning_effort).toBe("high");
  });

  it("strips echoed reasoning_content to bound multi-turn input tokens", async () => {
    // SDKs echo the full history; Kimchi bills the scratch block as input, so
    // multi-turn conversations balloon past 100k tokens without this.
    const { stripReasoningContent } = await import("../../open-sse/executors/kimchi.js");
    const body = { messages: [{ role: "assistant", reasoning_content: "a".repeat(500), content: "hi" }] };
    stripReasoningContent(body);
    expect(body.messages[0].reasoning_content).toBeUndefined();
    expect(body.messages[0].content).toBe("hi");
  });

  it("keeps the short placeholder reasoning_content", async () => {
    // injectReasoningContent may add a 1-char placeholder for upstream
    // validation; stripping it makes upstream complain on the next turn.
    const { stripReasoningContent } = await import("../../open-sse/executors/kimchi.js");
    const body = { messages: [{ role: "assistant", reasoning_content: " ", content: "hi" }] };
    stripReasoningContent(body);
    expect(body.messages[0].reasoning_content).toBe(" ");
  });

  it("only strips reasoning_content from assistant turns", async () => {
    const { stripReasoningContent } = await import("../../open-sse/executors/kimchi.js");
    const body = { messages: [{ role: "user", reasoning_content: "b".repeat(50) }] };
    stripReasoningContent(body);
    expect(body.messages[0].reasoning_content).toBeDefined();
  });
});

describe("Kimchi — OAuth browser_token flow", () => {
  it("is registered in the OAuth enum", () => {
    expect(OAUTH_PROVIDER_IDS.KIMCHI).toBe("kimchi");
  });

  it("builds a cli-auth url carrying the callback and state", async () => {
    const { getProvider } = await import("@/lib/oauth/providers");
    const { KIMCHI_CONFIG } = await import("@/lib/oauth/constants/oauth");
    const k = getProvider("kimchi");
    expect(k.flowType).toBe("browser_token");
    const url = k.buildAuthUrl(KIMCHI_CONFIG, "http://localhost:8080/callback", "st-1");
    expect(url).toContain("https://app.kimchi.dev/cli-auth?");
    expect(url).toContain("callback=");
    expect(url).toContain("state=st-1");
  });

  it("rejects an empty token before any network call", async () => {
    const { getProvider } = await import("@/lib/oauth/providers");
    const { KIMCHI_CONFIG } = await import("@/lib/oauth/constants/oauth");
    const k = getProvider("kimchi");
    await expect(k.exchangeToken(KIMCHI_CONFIG, "  ")).rejects.toThrow(/Missing Kimchi token/);
  });

  it("maps a profile into email/displayName, with no refresh token", async () => {
    const { getProvider } = await import("@/lib/oauth/providers");
    const k = getProvider("kimchi");
    const mapped = k.mapTokens({
      access_token: "tok-1",
      _kimchiUser: { id: 7, username: "ada", email: "a@b.co", name: "Ada" },
    });
    expect(mapped.accessToken).toBe("tok-1");
    // Browser tokens have nothing to refresh with — the user re-auths.
    expect(mapped.refreshToken).toBeNull();
    expect(mapped.email).toBe("a@b.co");
    expect(mapped.displayName).toBe("Ada");
    expect(mapped.providerSpecificData.authMethod).toBe("browser_token");
  });

  it("falls back to a synthetic email when the profile has none", async () => {
    const { getProvider } = await import("@/lib/oauth/providers");
    const k = getProvider("kimchi");
    const mapped = k.mapTokens({ access_token: "t", _kimchiUser: { id: 42 } });
    expect(mapped.email).toBe("kimchi-user-42");
  });

  it("the callback page and modal both accept ?token=", () => {
    const cb = readFileSync("src/app/callback/page.js", "utf8");
    expect(cb).toMatch(/searchParams\.get\("token"\)/);
    expect(cb).toMatch(/!\(code \|\| token \|\| error\)/);
    const modal = readFileSync("src/shared/components/OAuthModal.js", "utf8");
    expect(modal).toMatch(/exchangeTokens\(token \|\| code, state\)/);
  });
});

describe("openai→claude non-streaming translation (0.5.109 bug fix)", () => {
  // Verified live before the fix: /v1/messages against an openai-format
  // provider returned {id,object,created,model,choices,...} to a Claude client.
  const completion = (over = {}) => ({
    id: "chatcmpl-9",
    object: "chat.completion",
    model: "grok-4",
    choices: [{ index: 0, message: { role: "assistant", content: "Mango" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 2 },
    ...over,
  });

  it("converts an OpenAI completion into a Claude message", () => {
    const out = translateNonStreamingResponse(completion(), FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.content).toEqual([{ type: "text", text: "Mango" }]);
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 2 });
    // Must not leak OpenAI envelope fields.
    expect(out.choices).toBeUndefined();
    expect(out.object).toBeUndefined();
  });

  it("strips the chatcmpl- prefix from the id", () => {
    const out = translateNonStreamingResponse(completion(), FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.id).toBe("9");
  });

  it("emits thinking before text", () => {
    const out = translateNonStreamingResponse(completion({
      choices: [{ message: { content: "answer", reasoning_content: "hmm" }, finish_reason: "stop" }],
    }), FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.content[0]).toEqual({ type: "thinking", thinking: "hmm" });
    expect(out.content[1]).toEqual({ type: "text", text: "answer" });
  });

  it("converts tool_calls into tool_use with parsed input", () => {
    const out = translateNonStreamingResponse(completion({
      choices: [{
        message: { content: null, tool_calls: [{ id: "call_1", function: { name: "get", arguments: '{"q":1}' } }] },
        finish_reason: "tool_calls",
      }],
    }), FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.stop_reason).toBe("tool_use");
    expect(out.content[0]).toEqual({ type: "tool_use", id: "call_1", name: "get", input: { q: 1 } });
  });

  it("survives malformed tool arguments rather than throwing", () => {
    const out = translateNonStreamingResponse(completion({
      choices: [{ message: { tool_calls: [{ id: "c", function: { name: "n", arguments: "{not json" } }] }, finish_reason: "tool_calls" }],
    }), FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.content[0].input).toEqual({});
  });

  it("always produces a non-empty content array", () => {
    const out = translateNonStreamingResponse(completion({
      choices: [{ message: { content: "" }, finish_reason: "stop" }],
    }), FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.content).toEqual([{ type: "text", text: "" }]);
  });

  it("maps length → max_tokens", () => {
    const out = translateNonStreamingResponse(completion({
      choices: [{ message: { content: "x" }, finish_reason: "length" }],
    }), FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.stop_reason).toBe("max_tokens");
  });

  it("leaves an OpenAI client's response untouched (no regression)", () => {
    const body = completion();
    expect(translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.OPENAI)).toBe(body);
  });

  it("passes through when the provider is not OpenAI-format", () => {
    const body = { anything: 1 };
    expect(translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.GEMINI)).toBe(body);
  });
});

describe("published aliases must actually route (0.5.110 regression guard)", () => {
  // Two independent alias tables exist:
  //   PROVIDER_ID_TO_ALIAS (providerModels.js) — drives the published catalog
  //   ALIAS_TO_PROVIDER_ID (services/model.js) — drives request routing
  //
  // resolveProviderAlias falls back to `ALIAS_TO_PROVIDER_ID[a] || a`, so an
  // alias that happens to equal its provider id routes correctly even when it
  // is absent from the map. An alias that does NOT equal its id silently
  // resolves to a provider that doesn't exist — which is exactly what happened
  // to `gcli` (routed to a nonexistent "gcli", surfacing as a confusing 401
  // invalid_issuer) and would have happened to `cbcn`.
  //
  // The real invariant is behavioural, so assert on the resolver itself rather
  // than on the table's text: every alias we publish models under must resolve
  // to a provider the backend actually knows.
  it("every published alias resolves to a real backend provider", async () => {
    const { resolveProviderAlias } = await import("../../open-sse/services/model.js");

    const broken = [];
    for (const [id, alias] of Object.entries(PROVIDER_ID_TO_ALIAS)) {
      if (!PROVIDER_MODELS[alias]?.length) continue; // publishes nothing → nothing to route
      const resolved = resolveProviderAlias(alias);
      if (!BACKEND_PROVIDERS[resolved]) {
        broken.push(`${id}: "${alias}" → "${resolved}" (no such backend provider)`);
      }
    }
    expect(broken, `aliases that cannot route:\n  ${broken.join("\n  ")}`).toEqual([]);
  });

  it("each Tier C alias resolves to its own provider id", async () => {
    const { resolveProviderAlias } = await import("../../open-sse/services/model.js");
    for (const { id, alias } of TIER_C) {
      expect(resolveProviderAlias(alias), `${alias} must route to ${id}`).toBe(id);
    }
  });
});

describe("Grok CLI — request shaping", () => {
  const mk = async () => (await import("../../open-sse/executors/index.js")).getExecutor("grok-cli");
  const creds = { connectionId: "c-1", accessToken: "t", email: "u@x.co" };
  const req = (model, over = {}) => ({
    model, input: [{ type: "message", role: "user", content: "hi" }], ...over,
  });

  it("targets cli-chat-proxy, not api.x.ai (that is the `xai` provider)", async () => {
    const ex = await mk();
    expect(ex.buildUrl()).toBe("https://cli-chat-proxy.grok.com/v1/responses");
    expect(ex.buildUrl()).not.toContain("api.x.ai");
  });

  it("strips the virtual effort suffix and maps it to reasoning.effort", async () => {
    const ex = await mk();
    for (const [model, effort] of [["grok-4.5-low", "low"], ["grok-4.5-medium", "medium"], ["grok-4.5-high", "high"]]) {
      const out = ex.transformRequest(model, req(model), true, creds);
      expect(out.model, `${model} must resolve to the real upstream id`).toBe("grok-4.5");
      expect(out.reasoning.effort).toBe(effort);
    }
  });

  it("defaults to high effort when none is given (matches the live catalog default)", async () => {
    const ex = await mk();
    const out = ex.transformRequest("grok-4.5", req("grok-4.5"), true, creds);
    expect(out.reasoning.effort).toBe("high");
  });

  it("always forces stream + store:false and asks for encrypted reasoning", async () => {
    const ex = await mk();
    const out = ex.transformRequest("grok-4.5", req("grok-4.5", { stream: false }), false, creds);
    // The gateway only speaks SSE; store=false means multi-turn continuity has
    // to ride on encrypted reasoning instead of previous_response_id.
    expect(out.stream).toBe(true);
    expect(out.store).toBe(false);
    expect(out.include).toContain("reasoning.encrypted_content");
    expect(out.previous_response_id).toBeUndefined();
  });

  it("drops Chat-Completions leftovers the Responses API rejects", async () => {
    const ex = await mk();
    const out = ex.transformRequest("grok-4.5", req("grok-4.5", {
      max_tokens: 10, n: 2, seed: 1, frequency_penalty: 1, logit_bias: {}, user: "u", stream_options: {},
    }), true, creds);
    for (const k of ["max_tokens", "n", "seed", "frequency_penalty", "logit_bias", "user", "stream_options"]) {
      expect(out[k], `${k} must be dropped`).toBeUndefined();
    }
  });

  it("emits a well-formed UUID session id, stable per connection", async () => {
    const ex = await mk();
    const h1 = (ex.transformRequest("grok-4.5", req("grok-4.5"), true, creds), ex.buildHeaders(creds, true));
    const h2 = (ex.transformRequest("grok-4.5", req("grok-4.5"), true, creds), ex.buildHeaders(creds, true));
    // The real CLI sends plain UUIDs; this fork's deriveSessionId appends a
    // timestamp, which would not look like the client we claim to be.
    expect(h1["x-grok-session-id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Stable across requests, or multi-turn continuity breaks.
    expect(h2["x-grok-session-id"]).toBe(h1["x-grok-session-id"]);
    expect(h1["x-grok-conv-id"]).toBe(h1["x-grok-session-id"]);
    // But the request id must be fresh each time.
    expect(h2["x-grok-req-id"]).not.toBe(h1["x-grok-req-id"]);
  });

  it("sends the CLI fingerprint headers the gateway gates on", async () => {
    const ex = await mk();
    ex.transformRequest("grok-4.5", req("grok-4.5"), true, creds);
    const h = ex.buildHeaders(creds, true);
    expect(h["x-xai-token-auth"]).toBe("xai-grok-cli");
    expect(h["x-grok-client-identifier"]).toBe("grok-shell");
    expect(h["User-Agent"]).toMatch(/^grok-shell\//);
    expect(h["x-grok-turn-idx"]).toBeDefined();
  });

  it("only grok-4.5 accepts reasoning.effort", async () => {
    const { supportsGrokCliReasoningEffort } = await import("../../open-sse/config/grokCli.js");
    expect(supportsGrokCliReasoningEffort("grok-4.5")).toBe(true);
    expect(supportsGrokCliReasoningEffort("grok-4.5-low")).toBe(true);
    expect(supportsGrokCliReasoningEffort("grok-build")).toBe(false);
    expect(supportsGrokCliReasoningEffort("")).toBe(false);
  });
});

describe("forced-SSE aggregation for Responses-API providers (0.5.110 bug fix)", () => {
  // Two independent gates had to be right for a non-streaming client to get a
  // reply from a Responses-API provider. Both were wrong for grok-cli, and the
  // failure was silent: HTTP 200, real tokens billed, empty message.
  it("chatCore knows grok-cli and codebuddy-cn force streaming", () => {
    const src = readFileSync("open-sse/handlers/chatCore.js", "utf8");
    expect(src).toMatch(/provider === "grok-cli"/);
    expect(src).toMatch(/provider === "codebuddy-cn"/);
  });

  it("the SSE→JSON gate keys off the PROVIDER's format, not the client's", () => {
    // sourceFormat is the client's format. Keying on it meant any
    // Responses-API provider other than codex fell through to the
    // chat.completions aggregator, which found no choices[].delta.content.
    const src = readFileSync("open-sse/handlers/chatCore/sseToJsonHandler.js", "utf8");
    expect(src).toMatch(/providerFormat === FORMATS\.OPENAI_RESPONSES/);
  });

  it("every provider that forces stream in its executor is declared in chatCore", async () => {
    const { readdirSync } = await import("node:fs");
    const core = readFileSync("open-sse/handlers/chatCore.js", "utf8");
    const gate = core.slice(core.indexOf("const providerRequiresStreaming"), core.indexOf(";", core.indexOf("const providerRequiresStreaming")));
    const undeclared = [];
    for (const f of readdirSync("open-sse/executors")) {
      if (!f.endsWith(".js") || f === "index.js" || f === "base.js" || f === "default.js") continue;
      const src = readFileSync(`open-sse/executors/${f}`, "utf8");
      if (!/\.stream = true/.test(src)) continue;
      const id = f.replace(/\.js$/, "");
      if (!gate.includes(`"${id}"`)) undeclared.push(id);
    }
    expect(undeclared, `executors force stream but chatCore does not know:\n  ${undeclared.join("\n  ")}`).toEqual([]);
  });
});

describe("grok-cli token refresh (0.5.111 fix)", () => {
  // Shipped in 0.5.110 with no refresh case, so it fell to refreshAccessToken,
  // which needs a clientId grok-cli's backend config lacks → refresh always
  // failed → OAuth connections died after ~8h. grok-cli tokens are xai tokens.
  it("routes grok-cli refresh through the xai path", () => {
    const src = readFileSync("open-sse/services/tokenRefresh.js", "utf8");
    // The two cases must share the refreshXaiToken return.
    expect(src).toMatch(/case "xai":\s*\n(?:.*\n)*?\s*case "grok-cli":\s*\n\s*return refreshXaiToken/);
  });

  it("formats grok-cli credentials like xai (bearer access token)", () => {
    const src = readFileSync("open-sse/services/tokenRefresh.js", "utf8");
    expect(src).toMatch(/case "xai":\s*\n\s*case "grok-cli":/);
  });
});
