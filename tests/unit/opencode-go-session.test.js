/**
 * OpenCode Go rejects any request without x-opencode-session:
 *   400 MissingSessionID -- "Request is missing x-opencode-session and cannot be
 *   routed efficiently."
 * Reported by a user on ocg/glm-5.2 (2026-09-08). This fork never had the header;
 * upstream added it in 81f4f930 via a resolveSessionId() helper we do not have, so
 * the precedence is walked by hand the way resolveGrokCliSessionId already does.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, proxyAwareFetch: vi.fn() };
});

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { OpenCodeGoExecutor, resolveOpenCodeGoSeed } from "../../open-sse/executors/opencode-go.js";

const SESSION_HEADER = "x-opencode-session";

const sseBody = () => new ReadableStream({
  start(c) { c.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); c.close(); },
});

const okStream = () => new Response(sseBody(), {
  status: 200, headers: { "Content-Type": "text/event-stream" },
});

let exec;
beforeEach(() => {
  exec = new OpenCodeGoExecutor();
  proxyAwareFetch.mockReset();
  proxyAwareFetch.mockImplementation(() => Promise.resolve(okStream()));
});
afterEach(() => { vi.restoreAllMocks(); });

const sentHeaders = () => proxyAwareFetch.mock.calls[0]?.[1]?.headers || {};

const run = async (over = {}) => {
  await exec.execute({
    model: "glm-5.2",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: true,
    credentials: { apiKey: "k", connectionId: "conn-a" },
    clientTool: "claude",
    ...over,
  });
  return sentHeaders();
};

describe("OpenCode Go sends x-opencode-session", () => {
  it("puts the header on a chat/completions request", async () => {
    const h = await run();
    expect(h[SESSION_HEADER]).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  it("puts the header on the Claude-format /messages transport too", async () => {
    // minimax-m2.5 routes to /messages with x-api-key, a separate branch of buildHeaders.
    const h = await run({ model: "minimax-m2.5" });
    expect(proxyAwareFetch.mock.calls[0][0]).toContain("/messages");
    expect(h["x-api-key"]).toBe("k");
    expect(h[SESSION_HEADER]).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  it("is stable across turns of the same conversation", async () => {
    const a = await run();
    proxyAwareFetch.mockClear();
    const b = await run();
    // A new id per request would make every turn a new upstream session.
    expect(b[SESSION_HEADER]).toBe(a[SESSION_HEADER]);
  });

  it("differs between two different conversations", async () => {
    const a = await run({ body: { conversation_id: "conv-1", messages: [] } });
    proxyAwareFetch.mockClear();
    const b = await run({ body: { conversation_id: "conv-2", messages: [] } });
    expect(a[SESSION_HEADER]).not.toBe(b[SESSION_HEADER]);
  });

  it("namespaces the same conversation id per client tool", async () => {
    const a = await run({ body: { conversation_id: "1", messages: [] }, clientTool: "claude" });
    proxyAwareFetch.mockClear();
    const b = await run({ body: { conversation_id: "1", messages: [] }, clientTool: "codex" });
    // Two tools both calling their thread "1" must not share one upstream session.
    expect(a[SESSION_HEADER]).not.toBe(b[SESSION_HEADER]);
  });

  it("preserves a caller's own native session header verbatim", async () => {
    const h = await run({
      credentials: { apiKey: "k", connectionId: "c", rawHeaders: { "X-OpenCode-Session": "ses_caller_supplied" } },
    });
    // Rewriting it would split one conversation across two sessions upstream.
    expect(h[SESSION_HEADER]).toBe("ses_caller_supplied");
  });

  it("ignores a native header that is blank or absurdly long", async () => {
    const h1 = await run({ credentials: { apiKey: "k", connectionId: "c", rawHeaders: { [SESSION_HEADER]: "   " } } });
    expect(h1[SESSION_HEADER]).toMatch(/^ses_[0-9a-f]{32}$/);
    proxyAwareFetch.mockClear();
    const h2 = await run({ credentials: { apiKey: "k", connectionId: "c", rawHeaders: { [SESSION_HEADER]: "x".repeat(300) } } });
    expect(h2[SESSION_HEADER]).toMatch(/^ses_[0-9a-f]{32}$/);
  });

  it("does not mutate the caller's credentials or hold state on the singleton", async () => {
    const creds = { apiKey: "k", connectionId: "conn-a" };
    await exec.execute({
      model: "glm-5.2", body: { messages: [] }, stream: true, credentials: creds, clientTool: "claude",
    });
    expect(creds).not.toHaveProperty("_opencodeGoSession");
    expect(exec).not.toHaveProperty("_opencodeGoSession");
  });

  it("still emits a header when buildHeaders is reached directly", async () => {
    const h = exec.buildHeaders({ apiKey: "k", connectionId: "conn-a" }, true);
    expect(h[SESSION_HEADER]).toMatch(/^ses_[0-9a-f]{32}$/);
  });
});

describe("seed precedence", () => {
  it("prefers an explicit conversation id over the workspace and connection", () => {
    const seed = resolveOpenCodeGoSeed(
      { connectionId: "conn", providerSpecificData: { workspaceId: "ws" } },
      { conversation_id: "conv-x" },
    );
    expect(seed).toBe("conv-x");
  });

  it("falls back to the workspace, then the connection", () => {
    expect(resolveOpenCodeGoSeed({ connectionId: "conn", providerSpecificData: { workspaceId: "ws" } }, {})).toBe("ws");
    const a = resolveOpenCodeGoSeed({ connectionId: "conn" }, {});
    const b = resolveOpenCodeGoSeed({ connectionId: "conn" }, {});
    expect(a).toBe(b);
  });
});

// The request path is not the only caller. Connection validation and the dashboard's
// "test connection" ping OpenCode Go with their own fetch, and both grade anything that
// is not 401/403 as a healthy key -- so a header-less 400 reported success.
describe("validation paths carry the header too", () => {
  const read = (p) => {
    const fs = require("node:fs");
    return fs.readFileSync(require("node:path").join(process.cwd(), p), "utf-8")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  };

  it("connection validation sends x-opencode-session", () => {
    const src = read("src/app/api/providers/validate/route.js");
    expect(src).toContain("OPENCODE_GO_SESSION_HEADER");
    expect(src).toContain("openCodeGoSessionId");
  });

  it("the dashboard test-connection ping sends it as well", () => {
    const src = read("src/app/api/providers/[id]/test/testUtils.js");
    expect(src).toContain("OPENCODE_GO_SESSION_HEADER");
    expect(src).toContain("openCodeGoSessionId");
  });

  it("both derive it from the one exported helper rather than rehashing", () => {
    for (const p of ["src/app/api/providers/validate/route.js",
                     "src/app/api/providers/[id]/test/testUtils.js"]) {
      const src = read(p);
      expect(src).toContain('from "open-sse/executors/opencode-go.js"');
      // A second copy of the hashing would drift from the executor's.
      expect(src).not.toContain("createHash");
    }
  });
});
