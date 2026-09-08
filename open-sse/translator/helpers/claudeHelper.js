// Claude helper functions for translator
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "../../config/defaultThinkingSignature.js";
import { adjustMaxTokens } from "./maxTokensHelper.js";
import { applyCloaking } from "../../utils/claudeCloaking.js";
import { deriveSessionId } from "../../utils/sessionManager.js";

// Check if message has valid non-empty content
export function hasValidContent(msg) {
  if (typeof msg.content === "string" && msg.content.trim()) return true;
  if (Array.isArray(msg.content)) {
    return msg.content.some(block =>
      (block.type === "text" && block.text?.trim()) ||
      block.type === "tool_use" ||
      block.type === "tool_result" ||
      // 0.5.121 (upstream a7941dda) — a vision turn whose only block is an image
      // (or document) is valid content; dropping it left messages[] empty and
      // Anthropic 400'd with "at least one message is required".
      block.type === "image" ||
      block.type === "document"
    );
  }
  return false;
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

// Models that reject thinking.type "adaptive" (only Sonnet/Opus support it)
const ADAPTIVE_THINKING_UNSUPPORTED = /haiku/i;

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
  if (body.thinking?.type === "adaptive" && ADAPTIVE_THINKING_UNSUPPORTED.test(model)) {
    body.thinking = { type: "enabled", budget_tokens: 10000 };
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
  if (Array.isArray(body.messages)) {
    body.messages = body.messages.filter(msg => {
      if (typeof msg?.content === "string") return msg.content.trim().length > 0;
      if (!Array.isArray(msg?.content)) return true;
      msg.content = msg.content.filter(block =>
        !(block?.type === "text" && !String(block.text ?? "").trim()));
      return msg.content.length > 0;
    });
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
    let filtered = [];

    // Pass 1: remove cache_control (unless preserving) + filter empty messages
    for (let i = 0; i < len; i++) {
      const msg = body.messages[i];

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

  // Apply cloaking for OAuth tokens (billing header + fake user ID)
  // session_id in user_id must match X-Claude-Code-Session-Id for fingerprint consistency
  if ((provider === "claude" || provider?.startsWith("anthropic-compatible")) && apiKey) {
    const sessionId = connectionId ? deriveSessionId(connectionId) : null;
    body = applyCloaking(body, apiKey, sessionId);
  }

  return body;
}

