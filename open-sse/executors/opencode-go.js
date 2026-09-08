import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { deriveSessionId } from "../utils/sessionManager.js";

// Models that use /zen/go/v1/messages (Anthropic/Claude format + x-api-key auth)
const CLAUDE_FORMAT_MODELS = new Set(["minimax-m2.5", "minimax-m2.7"]);

const BASE = "https://opencode.ai/zen/go/v1";

// OpenCode Go rejects a request that arrives without this header:
//   400 MissingSessionID -- "Request is missing x-opencode-session and cannot be
//   routed efficiently."
// It only has to be stable for the life of a conversation; the value is opaque to
// us and is what they route and cache on.
const SESSION_HEADER = "x-opencode-session";
// Carried on the per-request credentials object rather than on the executor, which
// is a singleton -- a field on `this` would leak between concurrent requests.
const SESSION_FIELD = "_opencodeGoSession";
const MAX_SESSION_LENGTH = 256;

function normalizeSession(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_SESSION_LENGTH) return null;
  return normalized;
}

// A client already speaking OpenCode's own protocol sends a real session id. Pass
// it through untouched: replacing it would split one conversation across two
// sessions upstream.
function nativeSession(headers) {
  if (!headers || typeof headers !== "object") return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === SESSION_HEADER) return normalizeSession(value);
  }
  return null;
}

// Namespaced by client tool so two tools reusing the same conversation id (both
// like to call it "1") do not collide into one upstream session.
function translatedSession(seed, clientTool) {
  const digest = crypto
    .createHash("sha256")
    .update(`opencode-go\0${clientTool || "generic"}\0${seed}`)
    .digest("hex")
    .slice(0, 32);
  return `ses_${digest}`;
}

/**
 * Pick the most conversation-specific identifier available.
 *
 * Upstream calls its own resolveSessionId(), which this fork does not have, so we
 * walk the same precedence by hand -- the shape resolveGrokCliSessionId() already
 * uses for the same reason: an explicit conversation id from the client wins (it
 * is the only thing that actually tracks a thread), then the workspace, then a
 * stable id derived from the connection. Clients that send no thread metadata
 * share one session per connection, which is stable, just coarser.
 */
export function resolveOpenCodeGoSeed(credentials, body) {
  const explicit =
    body?.prompt_cache_key
    || body?.session_id
    || body?.conversation_id
    || body?.metadata?.session_id
    || body?.metadata?.conversation_id;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();

  const workspaceId = credentials?.providerSpecificData?.workspaceId;
  if (typeof workspaceId === "string" && workspaceId.trim()) return workspaceId.trim();

  // deriveSessionId memoises per connection and mints a fresh id only when there is
  // no connection at all -- never a new id per request, which would break multi-turn.
  return deriveSessionId(credentials?.connectionId || credentials?.id);
}

/**
 * The value for the x-opencode-session header.
 *
 * Exported because the request path is not the only caller: connection validation
 * and the dashboard's "test connection" ping OpenCode Go with their own fetch, and a
 * header-less ping is exactly what the provider now rejects.
 */
export function openCodeGoSessionId({ credentials, body, clientTool } = {}) {
  const native = nativeSession(credentials?.rawHeaders);
  return native || translatedSession(resolveOpenCodeGoSeed(credentials || {}, body), clientTool);
}

export const OPENCODE_GO_SESSION_HEADER = SESSION_HEADER;

export class OpenCodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
  }

  // buildUrl runs before buildHeaders in BaseExecutor.execute, cache model here
  buildUrl(model) {
    this._lastModel = model;
    return CLAUDE_FORMAT_MODELS.has(model)
      ? `${BASE}/messages`
      : `${BASE}/chat/completions`;
  }

  // Returns a copy; the caller's credentials object is never mutated, so a retry
  // with refreshed credentials recomputes rather than inheriting a stale session.
  prepareRequestCredentials({ body, credentials, clientTool } = {}) {
    const source = credentials || {};
    return {
      ...source,
      [SESSION_FIELD]: openCodeGoSessionId({ credentials: source, body, clientTool }),
    };
  }

  async execute(args) {
    return super.execute({ ...args, credentials: this.prepareRequestCredentials(args) });
  }

  buildHeaders(credentials, stream = true) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = { "Content-Type": "application/json" };

    if (CLAUDE_FORMAT_MODELS.has(this._lastModel)) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${key}`;
    }

    if (stream) headers["Accept"] = "text/event-stream";

    // Both transports need it. Falling back here as well as in execute() keeps any
    // caller that reaches buildHeaders directly from emitting a header-less request.
    headers[SESSION_HEADER] = credentials?.[SESSION_FIELD]
      || this.prepareRequestCredentials({ credentials })[SESSION_FIELD];

    return headers;
  }

  transformRequest(model, body) {
    return injectReasoningContent({ provider: this.provider, model, body });
  }
}
