// 0.5.109 (upstream 8a664d61 + 7afaecd6) — Kimchi executor.
import { DefaultExecutor } from "./default.js";
import { getCachedKimchiModelMetadata } from "../services/kimchiModels.js";

// Kimchi is a plain OpenAI gateway. A Claude-format client's request arrives
// carrying Anthropic-only fields that the gateway rejects outright, so they are
// dropped rather than translated.
const TOP_LEVEL_OPENAI_GATEWAY_DROPS = [
  "anthropic_version",
  "anthropic_beta",
  "client_metadata",
  "mcp_servers",
  "stop_sequences",
  "thinking",
  "top_k",
];

// Strip `reasoning_content` echoed back by clients on assistant messages — but
// only when it is a real thinking block. DefaultExecutor.transformRequest runs
// injectReasoningContent first and may inject a 1-char placeholder (" ") for
// upstream validation; that placeholder costs nothing and stripping it would
// make upstream complain about missing reasoning on the next turn. Without this
// strip, SDKs that echo the full history balloon multi-turn input to 100k+
// tokens, because Kimchi counts the scratch block as input.
const REASONING_PLACEHOLDER_MAX_LEN = 8;

function systemToText(system) {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// Claude puts the system prompt at the top level; OpenAI expects it as the
// first message. Dropping it instead would silently lose the whole prompt.
function mergeTopLevelSystem(body) {
  if (!body?.system || !Array.isArray(body.messages)) return;
  const text = systemToText(body.system).trim();
  if (!text) return;

  const existing = body.messages.find((msg) => msg?.role === "system");
  if (!existing) {
    body.messages.unshift({ role: "system", content: text });
    return;
  }
  if (typeof existing.content === "string") {
    existing.content = `${text}\n\n${existing.content}`;
  } else if (Array.isArray(existing.content)) {
    existing.content.unshift({ type: "text", text });
  }
}

function stripMessageArtifacts(body) {
  if (!Array.isArray(body?.messages)) return;
  for (const msg of body.messages) {
    if (!msg || typeof msg !== "object") continue;
    delete msg.cache_control;
    if (!Array.isArray(msg.content)) continue;
    msg.content = msg.content.map((part) => {
      if (!part || typeof part !== "object") return part;
      const { cache_control, signature, ...clean } = part;
      return clean;
    });
  }
}

function stripToolArtifacts(body) {
  if (!Array.isArray(body?.tools)) return;
  body.tools = body.tools.map((tool) => {
    if (!tool || typeof tool !== "object") return tool;
    const { cache_control, ...clean } = tool;
    return clean;
  });
}

export function stripReasoningContent(body) {
  if (!Array.isArray(body?.messages)) return;
  for (const msg of body.messages) {
    if (
      msg
      && msg.role === "assistant"
      && typeof msg.reasoning_content === "string"
      && msg.reasoning_content.length > REASONING_PLACEHOLDER_MAX_LEN
    ) {
      delete msg.reasoning_content;
    }
  }
}

// Kimchi fronts several upstreams. Anthropic-backed models reject OpenAI-style
// reasoning params, so they must be dropped for those models only. Prefer the
// live catalog metadata; fall back to the model name when it isn't cached yet.
function isAnthropicBackedKimchiModel(model) {
  const meta = getCachedKimchiModelMetadata(model);
  if (meta?.provider === "anthropic" || meta?.upstreamProvider === "anthropic") return true;
  return /(^|[-_/])(?:claude|anthropic)(?:[-_/]|$)/i.test(String(model || ""));
}

export class KimchiExecutor extends DefaultExecutor {
  constructor() {
    super("kimchi");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (!transformed || typeof transformed !== "object") return transformed;

    mergeTopLevelSystem(transformed);
    for (const key of TOP_LEVEL_OPENAI_GATEWAY_DROPS) {
      if (transformed[key] !== undefined) delete transformed[key];
    }
    delete transformed.system;

    if (isAnthropicBackedKimchiModel(model)) {
      delete transformed.reasoning_effort;
      delete transformed.reasoning;
      delete transformed.thinking;
    }

    stripMessageArtifacts(transformed);
    stripToolArtifacts(transformed);
    stripReasoningContent(transformed);
    return transformed;
  }
}

export default KimchiExecutor;
