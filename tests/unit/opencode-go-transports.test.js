/**
 * OpenCode Go serves some models on /zen/go/v1/messages (Claude wire format,
 * x-api-key auth) and the rest on /chat/completions (OpenAI format, bearer auth).
 *
 * That choice lives in two places which must agree:
 *   - config/providerModels.js  targetFormat:"claude"  -> how the BODY is translated
 *   - executors/opencode-go.js  CLAUDE_FORMAT_MODELS   -> WHICH endpoint + auth header
 *
 * A model listed in one but not the other sends a Claude body to /chat/completions
 * with a bearer token, or an OpenAI body to /messages with x-api-key. Both fail, and
 * neither fails in a way that names the real cause.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";

const executorClaudeModels = () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "open-sse/executors/opencode-go.js"), "utf-8");
  const m = src.match(/const CLAUDE_FORMAT_MODELS = new Set\(\[([^\]]*)\]\)/);
  if (!m) return null;
  return new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
};

const catalogClaudeModels = () =>
  new Set((PROVIDER_MODELS["opencode-go"] || [])
    .filter((m) => m.targetFormat === "claude")
    .map((m) => m.id));

describe("OpenCode Go Claude-format routing", () => {
  it("the catalog and the executor list exactly the same models", () => {
    const fromExecutor = executorClaudeModels();
    expect(fromExecutor).toBeTruthy();
    expect([...fromExecutor].sort()).toEqual([...catalogClaudeModels()].sort());
  });

  it("routes minimax-m3 to /messages with x-api-key", () => {
    // Upstream's provider registry lists minimax-m3 as supportedFormats
    // ["openai","claude"], the same as m2.5/m2.7 which this fork already sends to
    // the Claude endpoint.
    const exec = new OpenCodeGoExecutor();
    const url = exec.buildUrl("minimax-m3");
    const headers = exec.buildHeaders({ apiKey: "k", connectionId: "c" }, true);

    expect(url).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(headers["x-api-key"]).toBe("k");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.Authorization).toBeUndefined();
  });

  it("still routes an OpenAI-format model to /chat/completions with a bearer", () => {
    const exec = new OpenCodeGoExecutor();
    const url = exec.buildUrl("glm-5.1");
    const headers = exec.buildHeaders({ apiKey: "k", connectionId: "c" }, true);

    expect(url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(headers.Authorization).toBe("Bearer k");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("carries the session header on the Claude endpoint too", () => {
    const exec = new OpenCodeGoExecutor();
    exec.buildUrl("minimax-m3");
    const headers = exec.buildHeaders({ apiKey: "k", connectionId: "c" }, true);
    expect(headers["x-opencode-session"]).toMatch(/^ses_[0-9a-f]{32}$/);
  });
});
