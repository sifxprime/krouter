// Claude helper functions for translator
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../config/defaultThinkingSignature.js";
import { adjustMaxTokens } from "./maxTokensHelper.js";
import { applyCloaking } from "../../utils/claudeCloaking.js";
import { deriveSessionId } from "../../utils/sessionManager.js";
import { getCapabilitiesForModel } from "../../providers/capabilities.js";

// Block types a message may carry alone. A type outside this set makes the whole
// message count as empty, and prepareClaudeRequest drops it.
// 0.5.121 (upstream a7941dda) — image / document: a vision turn whose only block is
// an image is valid; dropping it left messages[] empty ("at least one message is required").
// 0.5.166 (upstream 4f274c7f) — container_upload: a Files API reference sent alone
// is valid too; dropping it forwarded messages: [].
const CONTENTFUL_BLOCK_TYPES = new Set(["tool_use", "tool_result", "image", "document", "container_upload"]);

function isContentfulBlock(block) {
  if (!block || typeof block !== "object") return false;
  if (block.type === "text") return !!block.text?.trim();
  return CONTENTFUL_BLOCK_TYPES.has(block.type);
}

// Check if message has valid non-empty content
export function hasValidContent(msg) {
  if (typeof msg.content === "string" && msg.content.trim()) return true;
  // 0.5.166 (upstream 8a81085a) — content may be ONE block object instead of an array.
  if (msg.content && typeof msg.content === "object" && !Array.isArray(msg.content)) {
    return isContentfulBlock(msg.content);
  }
  if (Array.isArray(msg.content)) return msg.content.some(isContentfulBlock);
  return false;
}

// 0.5.166 (upstream 8a81085a) — some clients send content as a single block object
// (the spec allows string | array). Every pass below reads arrays, so the turn was
// dropped or zeroed and the history silently lost. Wrap it as a one-block array,
// copy-on-write, without the client's cache_control (a bare-object marker never
// survives normalization).
function normalizeMessageContent(msg) {
  const c = msg?.content;
  if (!c || typeof c !== "object" || Array.isArray(c)) return msg;
  const { cache_control, ...block } = c;
  return { ...msg, content: [block] };
}

// 0.5.166 (upstream c8644368) — Anthropic rejects a thinking block with no visible
// text (400 "each thinking block must contain non-whitespace thinking"), signature
// or not, and clients replay it on every later turn. redacted_thinking carries
// `data`, not text, and is kept.
function isBlankThinkingBlock(block) {
  return block?.type === "thinking" && !String(block.thinking ?? "").trim();
}

function isBlankTextBlock(block) {
  return block?.type === "text" && !String(block.text ?? "").trim();
}

function dropBlankThinking(msg) {
  if (!Array.isArray(msg?.content) || !msg.content.some(isBlankThinkingBlock)) return msg;
  return { ...msg, content: msg.content.filter(block => !isBlankThinkingBlock(block)) };
}

// 0.5.166 (upstream 75834e96 + 5e9bd464) — newer Claude models reject a body that
// ends on an assistant turn ("does not support assistant message prefill"). The
// cleanups drop messages left empty, so an emptied final user turn quietly made the
// previous assistant turn the last one. Restore a user turn, unless the client
// itself ended on assistant: real prefill is its choice.
const TRAILING_USER_PLACEHOLDER = "Continue.";

export function ensureTrailingUserTurn(messages, originalLastRole) {
  if (!Array.isArray(messages) || originalLastRole === "assistant") return messages;
  if (messages[messages.length - 1]?.role !== "assistant") return messages;
  return [...messages, { role: "user", content: [{ type: "text", text: TRAILING_USER_PLACEHOLDER }] }];
}

// 0.5.166 (upstream 49ba54b2 + a07ed95b) — Claude models that think on every turn
// (caps thinkingCanDisable:false: Opus 5.5, Sonnet 5.5, Fable) answer 400 to thinking
// "disabled" and to a forced tool_choice (any / tool). The model id must be a Claude
// one: Gemini 3 and the CodeBuddy models carry the same flag and keep their shape.
export function isAlwaysThinkingClaude(model) {
  if (typeof model !== "string" || !/claude/i.test(model)) return false;
  return getCapabilitiesForModel(null, model).thinkingCanDisable === false;
}

const FORCED_TOOL_CHOICE_TYPES = new Set(["any", "tool"]);
// between_tools accepts effort up to high.
const EFFORT_ABOVE_HIGH = new Set(["xhigh", "max"]);

/**
 * Rewrite the two shapes always-thinking Claude models reject, copy-on-write:
 *   thinking "disabled" -> "between_tools" on Sonnet (effort clamped to high),
 *                          dropped on Opus 5.5 and Fable;
 *   tool_choice any/tool -> auto, keeping disable_parallel_tool_use.
 * Runs in prepareClaudeRequest (translated and same-format bodies) and in the
 * executor (passthrough bodies, the provider-level "off" override), so it is
 * idempotent and returns the same body when nothing applies.
 * @param {object} body - Claude Messages request body
 * @param {string} [model] - upstream model id (defaults to body.model)
 * @returns {object}
 */
export function applyClaudeModelRules(body, model = body?.model) {
  if (!body || typeof body !== "object" || !isAlwaysThinkingClaude(model)) return body;
  let next = body;

  if (body.thinking?.type === "disabled") {
    next = { ...next };
    if (/sonnet/i.test(model)) {
      next.thinking = { type: "between_tools" };
      if (EFFORT_ABOVE_HIGH.has(body.output_config?.effort)) {
        next.output_config = { ...body.output_config, effort: "high" };
      }
    } else {
      delete next.thinking;
    }
  }

  if (FORCED_TOOL_CHOICE_TYPES.has(body.tool_choice?.type)) {
    const { disable_parallel_tool_use } = body.tool_choice;
    next = {
      ...next,
      tool_choice: { type: "auto", ...(disable_parallel_tool_use !== undefined ? { disable_parallel_tool_use } : {}) },
    };
  }

  return next;
}

// 0.5.166 (upstream c8644368) — context_management (Claude Code's context-editing
// block) is defined only by Anthropic's Messages API. Gateways fronting other engines
// answer 400 "context_management: Extra inputs are not permitted".
function isAnthropicServing(provider) {
  return provider === "claude" || provider === "anthropic"
    || (typeof provider === "string" && provider.startsWith("anthropic-compatible-"));
}

// 0.5.166 (upstream 8a81085a) — Anthropic allows at most 4 cache_control markers per
// request. preserveCacheControl keeps the client's markers but the tool step still
// re-anchors the last tool, so a client already at 4 reached 5: a non-retryable 400
// that walked the whole account pool. Trim past the budget, holding the head anchors
// (last system block, last cacheable tool) and giving the other slots to the
// tail-most markers. Copy-on-write; the same body comes back when within budget.
const MAX_CACHE_CONTROL_MARKERS = 4;

function collectCacheMarkedBlocks(body) {
  const marked = [];
  for (const b of Array.isArray(body.system) ? body.system : []) if (b?.cache_control) marked.push(b);
  for (const t of Array.isArray(body.tools) ? body.tools : []) if (t?.cache_control) marked.push(t);
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    if (Array.isArray(m?.content)) for (const b of m.content) if (b?.cache_control) marked.push(b);
  }
  return marked;
}

export function capCacheControlMarkers(body) {
  if (!body || typeof body !== "object") return body;
  const marked = collectCacheMarkedBlocks(body);
  if (marked.length <= MAX_CACHE_CONTROL_MARKERS) return body;

  const system = Array.isArray(body.system) ? body.system : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const heads = new Set([system[system.length - 1], tools[lastCacheableToolIndex(tools)]].filter(Boolean));
  const headCount = marked.filter(b => heads.has(b)).length;
  const rest = marked.filter(b => !heads.has(b));
  const keep = Math.max(0, MAX_CACHE_CONTROL_MARKERS - headCount);
  const drop = new Set(rest.slice(0, Math.max(0, rest.length - keep)));
  if (drop.size === 0) return body;

  const strip = (b) => {
    if (!drop.has(b)) return b;
    const { cache_control, ...unmarked } = b;
    return unmarked;
  };
  const next = { ...body };
  if (Array.isArray(body.system)) next.system = body.system.map(strip);
  if (Array.isArray(body.tools)) next.tools = body.tools.map(strip);
  if (Array.isArray(body.messages)) {
    next.messages = body.messages.map(m => (Array.isArray(m?.content) && m.content.some(b => drop.has(b))
      ? { ...m, content: m.content.map(strip) }
      : m));
  }
  return next;
}

// Fix tool_use/tool_result ordering for Claude API
// 1. Assistant message with tool_use: remove text AFTER tool_use (Claude doesn't allow)
// 2. Merge consecutive same-role messages
export function fixToolUseOrdering(messages) {
  if (messages.length <= 1) return messages;

  // Pass 1: Fix assistant messages with tool_use - remove text after tool_use
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const hasToolUse = msg.content.some(b => b.type === "tool_use");
      if (hasToolUse) {
        // Keep only: thinking blocks + tool_use blocks (remove text blocks after tool_use)
        const newContent = [];
        let foundToolUse = false;

        for (const block of msg.content) {
          if (block.type === "tool_use") {
            foundToolUse = true;
            newContent.push(block);
          } else if (block.type === "thinking" || block.type === "redacted_thinking") {
            newContent.push(block);
          } else if (!foundToolUse) {
            // Keep text blocks BEFORE tool_use
            newContent.push(block);
          }
          // Skip text blocks AFTER tool_use
        }

        msg.content = newContent;
      }
    }
  }

  // Pass 2: Merge consecutive same-role messages
  const merged = [];

  for (const msg of messages) {
    const last = merged[merged.length - 1];

    if (last && last.role === msg.role) {
      // Merge content arrays
      const lastContent = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
      const msgContent = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content }];

      // Put tool_result first, then other content
      const toolResults = [...lastContent.filter(b => b.type === "tool_result"), ...msgContent.filter(b => b.type === "tool_result")];
      const otherContent = [...lastContent.filter(b => b.type !== "tool_result"), ...msgContent.filter(b => b.type !== "tool_result")];

      last.content = [...toolResults, ...otherContent];
    } else {
      // Ensure content is array
      const content = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: msg.content }];
      merged.push({ role: msg.role, content: [...content] });
    }
  }

  return merged;
}

// Haiku 3.x/4.x reject thinking.type "adaptive"; Haiku 5+ accepts ONLY adaptive, and a
// downgrade to enabled/budget_tokens is answered 400 "thinking.type.enabled is not
// supported for this model" (upstream 0ad0a722, #5183). The catalog carries
// claude-haiku-5-5, so a bare /haiku/ test breaks it.
//
// The version may follow "haiku" (haiku-5-5, haiku-4.5) or precede it (claude-4.5-haiku,
// claude-3-5-haiku-20241022), with or without a provider prefix or date suffix. The
// leading lookbehind keeps a date suffix from being read as the version. An unversioned
// "haiku" keeps the old, safe downgrade, and a future haiku-6 is left alone.
function isAdaptiveThinkingUnsupported(model = "") {
  if (!/haiku/i.test(model)) return false;
  const m = String(model).match(/haiku[-._]?(\d+)|(?<![\d.])(\d+)(?:[-._]\d+)?[-._]?haiku/i);
  return m ? Number(m[1] || m[2]) < 5 : true;
}

// Normalize a native Claude passthrough body to match Anthropic Messages API spec.
// Newer Cowork/Claude Code clients emit beta-only shapes that OAuth endpoints reject:
// 1. thinking.type "adaptive" → unsupported on Haiku
// 2. role "system" messages (mid-conversation-system beta) → only top-level system is allowed
// Anthropic validates server_tool_use ids against this pattern and rejects the
// whole request with a 400 when one does not match. A combo that falls back to a
// provider with its own built-in tools (z.ai/glm emits OpenAI-style `call_` ids for
// its analyze_image tool) leaves such blocks in the history, so every later Claude
// turn carries a poisoned id and keeps failing.
const CLAUDE_SERVER_TOOL_USE_ID = /^srvtoolu_[a-zA-Z0-9_]+$/;

function hasForeignServerToolUseId(block) {
  return block?.type === "server_tool_use"
    && !CLAUDE_SERVER_TOOL_USE_ID.test(String(block.id ?? ""));
}

export function normalizeClaudePassthrough(body, model = "") {
  if (!body || typeof body !== "object") return body;

  // 1. Downgrade adaptive thinking for models that don't support it
  if (body.thinking?.type === "adaptive" && isAdaptiveThinkingUnsupported(model)) {
    body.thinking = { type: "enabled", budget_tokens: 10000 };
  }

  const originalLastRole = Array.isArray(body.messages) ? body.messages[body.messages.length - 1]?.role : undefined;

  // 0.5.166 (upstream 8a81085a) — wrap bare-object content first: the hoist below
  // reads arrays and would zero a bare-object system turn.
  if (Array.isArray(body.messages)) {
    body.messages = body.messages.map(normalizeMessageContent);
  }

  // 2. Hoist mid-conversation system messages into the top-level system field
  if (Array.isArray(body.messages)) {
    const systemBlocks = [];
    const messages = [];
    for (const msg of body.messages) {
      if (msg.role === "system") {
        const text = typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map(b => (typeof b === "string" ? b : b?.text || "")).join("\n")
            : "";
        if (text.trim()) systemBlocks.push({ type: "text", text });
        continue;
      }
      messages.push(msg);
    }

    if (systemBlocks.length > 0) {
      const existing = Array.isArray(body.system)
        ? body.system
        : typeof body.system === "string" && body.system.trim()
          ? [{ type: "text", text: body.system }]
          : [];
      body.system = [...existing, ...systemBlocks];
      body.messages = messages;
    }
  }

  // 3. Drop server_tool_use blocks carrying a foreign id, and remember those ids.
  const droppedServerToolUseIds = new Set();
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
      const kept = [];
      for (const block of msg.content) {
        if (hasForeignServerToolUseId(block)) {
          if (block.id != null) droppedServerToolUseIds.add(String(block.id));
          continue;
        }
        kept.push(block);
      }
      if (kept.length !== msg.content.length) msg.content = kept;
    }
  }

  // 4. A result block pointing at an id we just removed is now an orphan, and
  // Anthropic rejects a tool_result with no matching tool_use just as firmly.
  if (droppedServerToolUseIds.size > 0 && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!Array.isArray(msg?.content)) continue;
      const kept = msg.content.filter(block => !(
        (block?.type === "tool_result" || block?.type === "web_search_tool_result")
        && droppedServerToolUseIds.has(String(block.tool_use_id ?? ""))
      ));
      if (kept.length !== msg.content.length) msg.content = kept;
    }
  }

  // 5. Drop empty text blocks and any message left with no content at all.
  // Anthropic rejects a block with empty text (400 "text content blocks must be
  // non-empty"); a message whose blocks were all stripped above has to be dropped,
  // not padded with an empty placeholder.
  // 0.5.166 (upstream c8644368) — blank thinking blocks go too, and copy-on-write.
  // (upstream 75834e96) — then restore a trailing user turn the drop removed.
  if (Array.isArray(body.messages)) {
    const kept = [];
    for (const msg of body.messages) {
      if (typeof msg?.content === "string") {
        if (msg.content.trim()) kept.push(msg);
        continue;
      }
      if (!Array.isArray(msg?.content)) {
        kept.push(msg);
        continue;
      }
      const content = msg.content.filter(block => !isBlankTextBlock(block) && !isBlankThinkingBlock(block));
      if (content.length === 0) continue;
      kept.push(content.length === msg.content.length ? msg : { ...msg, content });
    }
    body.messages = ensureTrailingUserTurn(kept, originalLastRole);
  }

  return body;
}

const CLAUDE_FORMAT_PROVIDERS_WITHOUT_OUTPUT_CONFIG = new Set(["minimax", "minimax-cn"]);

// Prepare request for Claude format endpoints
// - Cleanup cache_control (unless preserveCacheControl=true for cache-sensitive passthrough)
// - Filter empty messages
// - Add thinking block for Anthropic endpoint (provider === "claude")
// - Fix tool_use/tool_result ordering
// - Apply cloaking (billing header + fake user ID) for OAuth tokens
//
// 0.5.32 — preserveCacheControl: skip ALL cache_control mutations when the
// caller is in passthrough mode. Anthropic's prompt cache is keyed on the
// exact byte sequence of the request body — any rewrite here busts the cache
// and the user pays full tokens on the cached prefix every turn. Port of
// OmniRoute's same-named flag (open-sse/translator/helpers/claudeHelper.ts).
// Default false preserves existing behaviour for non-passthrough callers.
// Anthropic rejects a tool carrying BOTH defer_loading:true and cache_control
// ("Tools defer_loading cannot use prompt caching"). MCP clients put deferred tools
// at the tail, which is exactly where the cache anchor lands -- so the whole request
// 400s. Anchor on the last tool that CAN be cached instead of dropping caching.
export function lastCacheableToolIndex(tools) {
  if (!Array.isArray(tools)) return -1;
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i]?.defer_loading !== true) return i;
  }
  return -1;
}

export function prepareClaudeRequest(body, provider = null, apiKey = null, connectionId = null, preserveCacheControl = false) {
  // MiniMax exposes a Claude-compatible endpoint but rejects Anthropic's extended
  // structured output parameter with a generic 400 "invalid params" response.
  if (CLAUDE_FORMAT_PROVIDERS_WITHOUT_OUTPUT_CONFIG.has(provider)) {
    delete body.output_config;
  }

  // 0.5.166 (upstream c8644368) — same-format claude->claude bodies skip the
  // translator, so Claude Code's context_management rode through to every engine.
  if (!isAnthropicServing(provider) && body.context_management !== undefined) {
    const { context_management, ...rest } = body;
    body = rest;
  }

  // 0.5.166 (upstream 49ba54b2 + a07ed95b) — thinking "disabled" / forced tool_choice
  // on always-thinking Claude models (the executor repeats this for passthrough).
  body = applyClaudeModelRules(body, body.model);

  // 1. System: remove all cache_control, add only to last block with ttl 1h.
  //    Skipped when preserveCacheControl=true so the client's existing markers
  //    survive byte-for-byte and Anthropic's prompt cache stays valid.
  if (!preserveCacheControl && body.system && Array.isArray(body.system)) {
    body.system = body.system.map((block, i) => {
      const { cache_control, ...rest } = block;
      if (i === body.system.length - 1) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });
  }

  // 2. Messages: process in optimized passes
  if (body.messages && Array.isArray(body.messages)) {
    const len = body.messages.length;
    const originalLastRole = body.messages[len - 1]?.role;
    let filtered = [];

    // Pass 1: remove cache_control (unless preserving) + filter empty messages
    for (let i = 0; i < len; i++) {
      // 0.5.166 — wrap a bare-object content (8a81085a), drop blank thinking (c8644368)
      const msg = dropBlankThinking(normalizeMessageContent(body.messages[i]));

      // Remove cache_control from content blocks (skip when preserving)
      if (!preserveCacheControl && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          delete block.cache_control;
        }
      }

      // Keep final assistant even if empty, otherwise check valid content
      const isFinalAssistant = i === len - 1 && msg.role === "assistant";
      if (isFinalAssistant || hasValidContent(msg)) {
        filtered.push(msg);
      }
    }

    // Pass 1.5: Fix tool_use/tool_result ordering
    // Each tool_use must have tool_result in the NEXT message (not same message with other content)
    filtered = fixToolUseOrdering(filtered);
    // 0.5.166 (upstream 75834e96) — never let the empty-turn filter create prefill.
    filtered = ensureTrailingUserTurn(filtered, originalLastRole);

    body.messages = filtered;

    // Check if thinking is enabled AND last message is from user
    const lastMessage = filtered[filtered.length - 1];
    const lastMessageIsUser = lastMessage?.role === "user";
    const thinkingEnabled = body.thinking?.type === "enabled" && lastMessageIsUser;

    // Pass 2 (reverse): add cache_control to last assistant + handle thinking for Anthropic.
    //    The cache_control mutation here is also gated by preserveCacheControl.
    let lastAssistantProcessed = false;
    for (let i = filtered.length - 1; i >= 0; i--) {
      const msg = filtered[i];

      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        // Add cache_control to last non-thinking block of first (from end) assistant with content
        // thinking/redacted_thinking blocks do not support cache_control
        if (!preserveCacheControl && !lastAssistantProcessed && msg.content.length > 0) {
          for (let j = msg.content.length - 1; j >= 0; j--) {
            const block = msg.content[j];
            if (block.type !== "thinking" && block.type !== "redacted_thinking") {
              block.cache_control = { type: "ephemeral" };
              break;
            }
          }
          lastAssistantProcessed = true;
        }

        // Handle thinking blocks for Anthropic endpoint only
        if (provider === "claude" || provider?.startsWith("anthropic-compatible")) {
          let hasToolUse = false;
          let hasThinking = false;

          // Always replace signature for all thinking blocks
          for (const block of msg.content) {
            if (block.type === "thinking" || block.type === "redacted_thinking") {
              block.signature = DEFAULT_THINKING_CLAUDE_SIGNATURE;
              hasThinking = true;
            }
            if (block.type === "tool_use") hasToolUse = true;
          }

          // Add thinking block if thinking enabled + has tool_use but no thinking
          if (thinkingEnabled && !hasThinking && hasToolUse) {
            msg.content.unshift({
              type: "thinking",
              thinking: ".",
              signature: DEFAULT_THINKING_CLAUDE_SIGNATURE
            });
          }
        }
      }
    }
  }

  // 3. Tools: filter built-in tools for non-Anthropic providers, then handle cache_control
  if (body.tools && Array.isArray(body.tools)) {
    // Strip built-in tools (e.g. web_search_20250305) for providers that don't support them
    if (provider !== "claude") {
      body.tools = body.tools.filter(tool => !tool.type || tool.type === "function");
    }

    const lastCacheable = lastCacheableToolIndex(body.tools);
    body.tools = body.tools.map((tool, i) => {
      const { cache_control, ...rest } = tool;
      if (i === lastCacheable) {
        return { ...rest, cache_control: { type: "ephemeral", ttl: "1h" } };
      }
      return rest;
    });

    // Remove tools array and tool_choice if empty after filtering
    if (body.tools.length === 0) {
      delete body.tools;
      delete body.tool_choice;
    }
  }

  // 0.5.166 (upstream 8a81085a) — the tool re-anchor above runs even with
  // preserveCacheControl, so hold the request to Anthropic's 4-marker budget.
  body = capCacheControlMarkers(body);

  // Apply cloaking for OAuth tokens (billing header + fake user ID)
  // session_id in user_id must match X-Claude-Code-Session-Id for fingerprint consistency
  if ((provider === "claude" || provider?.startsWith("anthropic-compatible")) && apiKey) {
    const sessionId = connectionId ? deriveSessionId(connectionId) : null;
    body = applyCloaking(body, apiKey, sessionId);
  }

  return body;
}

