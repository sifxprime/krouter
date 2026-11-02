// 0.5.166 — OpenCode Free (oc) answered every request with 403 FreeTierError.
// kRouter still posted the v1 shape: https://opencode.ai/zen/v1/chat/completions with
// `Bearer public` and `x-opencode-client: desktop` and nothing else. Live probes on
// 2026-10-18 (the tier needs no account, so this is reproducible):
//   /zen/v1/chat/completions, desktop client         -> 403 FreeTierError
//   /inference/v1/..., UA opencode/1.18.31           -> 403 FreeTierError
//   /inference/v1/..., v2 UA, no tools               -> 403 FreeTierError
//   /inference/v1/..., v2 UA, tools renamed          -> 403 FreeTierError
//   /inference/v1/..., v2 UA, stream:false           -> 403 FreeTierError
//   /inference/v1/..., v2 UA, session ses_<32hex>    -> 403 FreeTierError
//   /inference/v1/..., v2 UA, read+shell, stream     -> 200
// So four things are load-bearing: the path, the v2 user-agent, a CLI-shaped
// `ses_` id, and tools literally named read and shell. Upstream 5bdcd5e7 + e964e482.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  OpenCodeExecutor,
  OPENCODE_SESSION_RE,
  translateSessionId,
  decodeSessionCounter,
  decodeSessionTime,
} from "../../open-sse/executors/opencode.js";
import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";

const executor = new OpenCodeExecutor();
const chatBody = () => ({ model: "mimo-v2.6-flash-free", messages: [{ role: "user", content: "hi" }], stream: false });

describe("OpenCode Free posts to /inference/v1, never /zen/v1", () => {
  it("sends a chat model to /inference/v1/chat/completions", () => {
    expect(executor.buildUrl("mimo-v2.6-flash-free")).toBe("https://opencode.ai/inference/v1/chat/completions");
  });

  it("sends Muse Spark to /inference/v1/responses", () => {
    // The live roster publishes muse-spark-1.2 / muse-spark-1.3, not the
    // "-contributor-free" ids upstream hardcodes, so detection is by prefix.
    expect(executor.buildUrl("muse-spark-1.3")).toBe("https://opencode.ai/inference/v1/responses");
    expect(executor.buildUrl("muse-spark-1.2-contributor-free")).toBe("https://opencode.ai/inference/v1/responses");
  });

  it("sends a Claude-protocol model to /inference/v1/messages", () => {
    expect(executor.buildUrl("union-alpha")).toBe("https://opencode.ai/inference/v1/messages");
  });

  it("ignores a thinking suffix when choosing the endpoint", () => {
    expect(executor.buildUrl("muse-spark-1.3(high)")).toBe("https://opencode.ai/inference/v1/responses");
  });
});

describe("OpenCode Free request headers mirror the v2 CLI", () => {
  const headers = (credentials = {}, stream = true, url = "https://opencode.ai/inference/v1/chat/completions") =>
    executor.buildHeaders(executor.prepareRequestCredentials({ credentials, body: chatBody() }), stream, url);

  it("declares the v2 user-agent and the cli client", () => {
    const h = headers();
    expect(h["User-Agent"]).toBe("opencode/latest/2.0.26/cli");
    expect(h["x-opencode-client"]).toBe("cli");
    expect(h.Authorization).toBe("Bearer public");
  });

  it("repeats one session id across every session header and sends no x-opencode-request", () => {
    const h = headers();
    expect(h["x-opencode-session"]).toMatch(OPENCODE_SESSION_RE);
    expect(h["x-opencode-session-id"]).toBe(h["x-opencode-session"]);
    expect(h["x-session-affinity"]).toBe(h["x-opencode-session"]);
    expect(h["x-session-id"]).toBe(h["x-opencode-session"]);
    expect(h["x-opencode-request"]).toBeUndefined();
  });

  it("passes a real OpenCode v2 client's own user-agent and session through", () => {
    const native = "ses_eb131e77effezUCWegZqQNDqzN";
    const h = headers({ rawHeaders: { "user-agent": "opencode/latest/2.0.26/cli", "x-opencode-session": native } });
    expect(h["User-Agent"]).toBe("opencode/latest/2.0.26/cli");
    expect(h["x-opencode-session"]).toBe(native);
  });

  it("replaces a v1 downstream user-agent, which the gate rejects", () => {
    const h = headers({ rawHeaders: { "user-agent": "opencode/1.18.31" } });
    expect(h["User-Agent"]).toBe("opencode/latest/2.0.26/cli");
  });

  it("adds anthropic-version only on the /messages endpoint", () => {
    expect(headers({}, true, "https://opencode.ai/inference/v1/messages")["anthropic-version"]).toBe("2023-06-01");
    expect(headers()["anthropic-version"]).toBeUndefined();
  });
});

describe("OpenCode Free session ids decode the way the gate expects", () => {
  it("mints ses_<12 hex><14 base62>", () => {
    expect(translateSessionId("conversation-1")).toMatch(OPENCODE_SESSION_RE);
  });

  it("keeps the encoded counter small — 500 was answered with 403", () => {
    // Upstream decodes the prefix; live probes passed at counter 1 and failed at 500.
    // Upstream mints from a live counter that climbs past the limit under a burst inside
    // one millisecond; kRouter pins the counter to 1 for every minted id and memoizes
    // per conversation instead, so no burst can move it (see translateSessionId).
    expect(decodeSessionCounter(translateSessionId("conversation-1"))).toBe(1);
    for (let i = 0; i < 40; i++) {
      expect(decodeSessionCounter(translateSessionId(`conversation-${i}`))).toBeLessThan(17);
    }
  });

  // Stability is the whole reason this translation exists: the free quota is accounted
  // per session, so a fresh id per request burns it and comes back 429.
  it("returns the same id for one conversation and different ids for two", () => {
    expect(translateSessionId("conversation-1")).toBe(translateSessionId("conversation-1"));
    expect(translateSessionId("conversation-1")).not.toBe(translateSessionId("conversation-2"));
    expect(translateSessionId("conversation-1")).toMatch(OPENCODE_SESSION_RE);
  });

  // The gate decodes this field and refuses a session whose time is in the future or
  // older than the free-tier window. The old digest-derived prefix drew it uniformly
  // over 2^36 ms, so it landed inside the window about 1% of the time (upstream
  // measured 1/10 accepted against 10/10 for Date.now(); ce060c79). Nothing asserted
  // it, so the lane 429'd while every other test here stayed green.
  it("stamps the prefix with the current clock, not a digest", () => {
    const wrappedNow = BigInt(Date.now()) & ((1n << 36n) - 1n);
    const decoded = decodeSessionTime(translateSessionId("conversation-clock"));
    const skewMs = Number(wrappedNow > decoded ? wrappedNow - decoded : decoded - wrappedNow);
    expect(skewMs).toBeLessThan(5000);
  });

  it("namespaces by client tool so two tools reusing one id do not collide", () => {
    expect(translateSessionId("1", "cline")).not.toBe(translateSessionId("1", "claude"));
  });

  it("keeps a session that already has the gate's shape", () => {
    const native = "ses_eb131e77effezUCWegZqQNDqzN";
    expect(translateSessionId(native)).toBe(native);
  });

  it("rewrites an OpenCode Go style ses_<32 hex>, which the free gate rejects", () => {
    const go = `ses_${"a".repeat(32)}`;
    expect(translateSessionId(go)).not.toBe(go);
    expect(translateSessionId(go)).toMatch(OPENCODE_SESSION_RE);
  });

  it("holds the session on the per-request credentials, never on the singleton", () => {
    const before = Object.keys(executor).sort();
    const a = executor.prepareRequestCredentials({ body: { session_id: "a" }, credentials: {} });
    const b = executor.prepareRequestCredentials({ body: { session_id: "b" }, credentials: {} });
    expect(a._opencodeSession).not.toBe(b._opencodeSession);
    expect(Object.keys(executor).sort()).toEqual(before);
  });

  it("never writes the caller's shared credentials object", () => {
    const shared = { connectionId: "conn-1" };
    executor.prepareRequestCredentials({ body: chatBody(), credentials: shared });
    expect(shared).toEqual({ connectionId: "conn-1" });
  });
});

describe("OpenCode Free request body", () => {
  it("forces stream upstream — the gate answered stream:false with 403", () => {
    const body = chatBody();
    expect(executor.transformRequest("mimo-v2.6-flash-free", body, false, {}).stream).toBe(true);
  });

  it("appends read and shell with OpenCode's own definitions", () => {
    const out = executor.transformRequest("mimo-v2.6-flash-free", chatBody(), true, {});
    const names = out.tools.map((t) => t.function?.name || t.name);
    expect(names).toEqual(["read", "shell"]);
    const read = out.tools.find((t) => (t.function?.name || t.name) === "read");
    expect(read.function.description).toContain("Each text line is prefixed by its 1-based line number");
    expect(read.function.parameters.required).toEqual(["path"]);
  });

  it("never sends tool_choice none", () => {
    const out = executor.transformRequest("mimo-v2.6-flash-free", { ...chatBody(), tool_choice: "none" }, true, {});
    expect(out.tool_choice).not.toBe("none");
  });

  it("keeps the caller's own tools next to the fingerprint ones", () => {
    const tools = [{ type: "function", function: { name: "Read", description: "read a file", parameters: { type: "object", properties: {} } } }];
    const out = executor.transformRequest("mimo-v2.6-flash-free", { ...chatBody(), tools }, true, {});
    const names = out.tools.map((t) => t.function?.name || t.name);
    expect(names).toEqual(["Read", "read", "shell"]);
  });

  it("tells the model the appended tools are placeholders", () => {
    const out = executor.transformRequest("mimo-v2.6-flash-free", chatBody(), true, {});
    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content).toContain("placeholders that do nothing");
  });

  it("builds a Responses body for Muse Spark and keeps the flat tool shape", () => {
    const out = executor.transformRequest("muse-spark-1.3", chatBody(), true, {});
    expect(out.input).toBeInstanceOf(Array);
    expect(out.messages).toBeUndefined();
    expect(out.store).toBe(false);
    expect(out.stream).toBe(true);
    expect(out.tools.map((t) => t.name)).toEqual(["read", "shell"]);
    expect(out.tool_choice).toBe("auto");
    expect(out.instructions).toContain("placeholders that do nothing");
  });

  it("is idempotent, so a base.js strip retry cannot double the fingerprint", () => {
    const body = chatBody();
    executor.transformRequest("mimo-v2.6-flash-free", body, true, {});
    const out = executor.transformRequest("mimo-v2.6-flash-free", body, true, {});
    expect(out.tools.map((t) => t.function?.name || t.name)).toEqual(["read", "shell"]);
  });
});

describe("the rest of the pipeline knows OpenCode Free forces streaming", () => {
  it("chatCore declares opencode in providerRequiresStreaming", () => {
    const core = readFileSync("open-sse/handlers/chatCore.js", "utf8");
    const start = core.indexOf("const providerRequiresStreaming");
    const gate = core.slice(start, core.indexOf(";", start));
    expect(gate).toContain('"opencode"');
  });

  it("echoes a reasoning_content placeholder, which Zen models demand on history", () => {
    const body = { messages: [{ role: "assistant", content: "earlier" }, { role: "user", content: "hi" }] };
    const out = injectReasoningContent({ provider: "opencode", model: "mimo-v2.6-flash-free", body });
    expect(out.messages[0].reasoning_content).toBe(" ");
  });
});
