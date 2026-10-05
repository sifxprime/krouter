import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { deriveSessionId } from "../utils/sessionManager.js";
import { MODEL_TRANSPORTS, getDefaultTransport } from "../config/providerModels.js";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses.js";
import { responsesToChatResponse } from "../utils/responsesToChatStream.js";

const BASE = "https://opencode.ai/zen/go/v1";
const PROVIDER_ID = "opencode-go";

// OpenCode Go serves three wire protocols, and each model accepts only some of them:
//   chat      -> /chat/completions  OpenAI body, bearer auth (most models)
//   messages  -> /messages          Claude body, x-api-key   (MiniMax)
//   responses -> /responses         Responses body, bearer   (grok, gpt-luna, Muse
//                                   Spark -- the others answer 400
//                                   ModelProtocolUnsupported, #23)
// URL, auth header and body shape must all follow the same choice, so every one of
// them asks openCodeGoTransport(). The built-in choice comes from the model table
// in config/providerModels.js. The dashboard can override it per model
// (settings.providerModelTransports["opencode-go"]) when OpenCode moves a model
// before kRouter's table catches up; src/sse/handlers/chat.js attaches that map to
// each request's credentials as `modelTransports` -- never stored on a connection,
// since a protocol belongs to the model, not to an account.
export const OPENCODE_GO_TRANSPORTS = MODEL_TRANSPORTS;
const ENDPOINTS = Object.freeze({ chat: "/chat/completions", messages: "/messages", responses: "/responses" });

// Muse Spark rejects a Responses request asking for fewer output tokens (#23).
const MIN_OUTPUT_TOKENS = 16;

export function defaultOpenCodeGoTransport(model) {
  return getDefaultTransport(PROVIDER_ID, model);
}

export function openCodeGoTransport(model, credentials) {
  const overrides = credentials?.modelTransports;
  const override = overrides && Object.hasOwn(overrides, model) ? overrides[model] : null;
  return OPENCODE_GO_TRANSPORTS.includes(override) ? override : defaultOpenCodeGoTransport(model);
}

// The executor converts chat <-> Responses itself (see execute), so a Responses
// model still gets an OpenAI body from chatCore; only /messages needs Claude.
export function openCodeGoTargetFormat(model, credentials) {
  return openCodeGoTransport(model, credentials) === "messages" ? "claude" : "openai";
}

function responsesToolChoice(choice, tools) {
  if (choice === undefined || choice === null) return undefined;
  if (typeof choice === "string") return choice;
  const name = choice?.function?.name || (choice?.type === "function" ? choice.name : undefined);
  if (!name) return undefined;
  // A choice naming a tool that is not sent is a hard 400; drop it instead.
  return tools.some((t) => t.name === name) ? { type: "function", name } : undefined;
}

function withoutKeys(obj, keys) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

/**
 * OpenAI chat body -> the Responses body OpenCode Go accepts.
 *
 * The shared translator handles messages, system -> instructions and tools, but
 * drops tool_choice, parallel_tool_calls and reasoning_effort, and sends max_tokens
 * where Responses wants max_output_tokens. Prior-turn reasoning items and their
 * encrypted_content are removed: Muse Spark cannot validate encrypted reasoning
 * from another account or session and rejects the whole request.
 */
// chat response_format -> Responses text.format (JSON mode, json_schema).
function responsesTextFormat(body) {
  if (body.text && typeof body.text === "object") return body.text;
  const rf = body.response_format;
  if (rf?.type === "json_object") return { format: { type: "json_object" } };
  if (rf?.type === "json_schema" && rf.json_schema?.schema) {
    const { name, schema, strict, description } = rf.json_schema;
    return { format: { type: "json_schema", name: name || "response", schema,
      ...(strict !== undefined ? { strict } : {}), ...(description ? { description } : {}) } };
  }
  return undefined;
}

export function toOpenCodeGoResponsesBody(model, body, stream, credentials) {
  const translated = openaiToOpenAIResponsesRequest(model, body, stream, credentials);
  const tools = (translated.tools || []).filter((t) => t?.type === "function" && t.name);

  // 0 or a negative value means "unset" to some clients; never turn it into a cap.
  const cap = [body.max_output_tokens, body.max_completion_tokens, body.max_tokens]
    .find((v) => Number.isFinite(v) && v > 0);
  const clientReasoning = credentials?.[CLIENT_REASONING_FIELD] || {};
  const effort = body.reasoning_effort ?? body.reasoning?.effort ?? clientReasoning.effort;
  const summary = body.reasoning?.summary || clientReasoning.summary || "auto";
  const text = responsesTextFormat(body);
  const toolChoice = responsesToolChoice(body.tool_choice, tools);
  const input = Array.isArray(translated.input)
    ? translated.input
      .filter((item) => item?.type !== "reasoning")
      .map((item) => (item && typeof item === "object"
        ? withoutKeys(item, ["encrypted_content", "reasoning_encrypted_content"])
        : item))
    : translated.input;

  const base = withoutKeys(translated, ["max_tokens", "max_completion_tokens", "reasoning_effort", "reasoning", "response_format", "text", "tools", "tool_choice", "instructions", "input"]);
  return {
    ...base,
    input,
    ...(translated.instructions ? { instructions: translated.instructions } : {}),
    ...(tools.length ? { tools } : {}),
    ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
    ...(body.parallel_tool_calls !== undefined ? { parallel_tool_calls: body.parallel_tool_calls } : {}),
    ...(cap !== undefined ? { max_output_tokens: Math.max(MIN_OUTPUT_TOKENS, Math.floor(cap)) } : {}),
    // Only Responses fields: other "reasoning" shapes (e.g. OpenRouter's
    // {exclude, max_tokens}) would be rejected by a strict upstream.
    ...(effort ? { reasoning: { effort, summary } } : {}),
    ...(text ? { text } : {}),
    store: false,
    stream: true,
  };
}

// OpenCode Go rejects a request that arrives without this header:
//   400 MissingSessionID -- "Request is missing x-opencode-session and cannot be
//   routed efficiently."
// It only has to be stable for the life of a conversation; the value is opaque to
// us and is what they route and cache on.
const SESSION_HEADER = "x-opencode-session";
// Carried on the per-request credentials object rather than on the executor, which
// is a singleton -- a field on `this` would leak between concurrent requests.
const SESSION_FIELD = "_opencodeGoSession";
// A Responses client's `reasoning` is lost when chatCore translates its body to
// chat (Responses -> chat deletes it, and must: OpenAI rejects reasoning_effort on
// non-reasoning models). The executor gets the client body separately and keeps
// the setting here, per request, for the Responses body it builds.
const CLIENT_REASONING_FIELD = "_opencodeGoClientReasoning";
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

// OpenCode answers a model it cannot serve on an endpoint (or an unknown model)
// with HTTP 401 + {type:"ModelError"}, before it even checks the key. kRouter
// treats 401 as a bad account and cools the WHOLE account down -- every model on
// it -- for a mistake about one model. Report it as the request error it is.
async function modelErrorAsBadRequest(result) {
  let parsed = null;
  try { parsed = await result.response.clone().json(); } catch { return result; }
  if (parsed?.error?.type !== "ModelError") return result;
  return {
    ...result,
    response: new Response(JSON.stringify(parsed), {
      status: 400,
      statusText: "Bad Request",
      headers: { "Content-Type": "application/json" },
    }),
  };
}

export class OpenCodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
  }

  // BaseExecutor.execute passes the model to buildHeaders too; _lastModel only
  // serves callers that use buildHeaders(credentials, stream) on their own. The
  // executor is a singleton, so per-request state must not live on `this`.
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    this._lastModel = model;
    return `${BASE}${ENDPOINTS[openCodeGoTransport(model, credentials)]}`;
  }

  // chatCore asks this before translating, so the body matches the endpoint.
  resolveTargetFormat(model, credentials) {
    return openCodeGoTargetFormat(model, credentials);
  }

  // Returns a copy; the caller's credentials object is never mutated, so a retry
  // with refreshed credentials recomputes rather than inheriting a stale session.
  prepareRequestCredentials({ body, credentials, clientTool, clientBody } = {}) {
    const source = credentials || {};
    const reasoning = clientBody?.reasoning;
    return {
      ...source,
      [SESSION_FIELD]: openCodeGoSessionId({ credentials: source, body, clientTool }),
      ...(reasoning && typeof reasoning === "object" && !Array.isArray(reasoning)
        ? { [CLIENT_REASONING_FIELD]: { effort: reasoning.effort, summary: reasoning.summary } }
        : {}),
    };
  }

  async execute(args) {
    const credentials = this.prepareRequestCredentials(args);
    const result = await super.execute({ ...args, credentials });
    if (result?.response?.status === 401) return await modelErrorAsBadRequest(result);
    if (openCodeGoTransport(args.model, credentials) !== "responses" || !result?.response?.ok) return result;
    // The upstream answered in Responses SSE; hand chatCore chat-completion SSE.
    return { ...result, response: responsesToChatResponse(result.response, { model: args.model, stream: args.stream }) };
  }

  buildHeaders(credentials, stream = true, url = null, model = this._lastModel) {
    const key = credentials?.apiKey || credentials?.accessToken;
    const headers = { "Content-Type": "application/json" };

    if (openCodeGoTransport(model, credentials) === "messages") {
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

  transformRequest(model, body, stream, credentials) {
    if (openCodeGoTransport(model, credentials) === "responses") {
      return toOpenCodeGoResponsesBody(model, body, stream, credentials);
    }
    return injectReasoningContent({ provider: this.provider, model, body });
  }
}
