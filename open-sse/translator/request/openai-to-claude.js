import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { CLAUDE_SYSTEM_PROMPT } from "../../config/appConstants.js";
import { adjustMaxTokens } from "../helpers/maxTokensHelper.js";
import { ensureTrailingUserTurn, isAlwaysThinkingClaude } from "../helpers/claudeHelper.js";

// Empty prefix matches real Claude Code behavior (no tool name prefix).
// Previously "proxy_" was used but this is a detectable fingerprint difference.
const CLAUDE_OAUTH_TOOL_PREFIX = "";

// Convert OpenAI request to Claude format
export function openaiToClaudeRequest(model, body, stream) {
  // Tool name mapping for Claude OAuth (capitalizedName → originalName)
  const toolNameMap = new Map();
  const result = {
    model: model,
    max_tokens: adjustMaxTokens(body),
    stream: stream
  };

  // Temperature
  if (body.temperature !== undefined) {
    result.temperature = body.temperature;
  }

  // Messages
  result.messages = [];
  const systemParts = [];

  if (body.messages && Array.isArray(body.messages)) {
    // Extract system messages
    for (const msg of body.messages) {
      if (msg.role === "system") {
        systemParts.push(typeof msg.content === "string" ? msg.content : extractTextContent(msg.content));
      }
    }

    // Filter out system messages for separate processing
    const nonSystemMessages = body.messages.filter(m => m.role !== "system");

    // Process messages with merging logic
    // CRITICAL: tool_result must be in separate message immediately after tool_use
    let currentRole = undefined;
    let currentParts = [];

    const flushCurrentMessage = () => {
      if (currentRole && currentParts.length > 0) {
        result.messages.push({ role: currentRole, content: currentParts });
        currentParts = [];
      }
    };

    for (const msg of nonSystemMessages) {
      const newRole = (msg.role === "user" || msg.role === "tool") ? "user" : "assistant";
      const blocks = getContentBlocksFromMessage(msg, toolNameMap);
      const hasToolUse = blocks.some(b => b.type === "tool_use");
      const hasToolResult = blocks.some(b => b.type === "tool_result");

      // Separate tool_result from other content
      if (hasToolResult) {
        const toolResultBlocks = blocks.filter(b => b.type === "tool_result");
        const otherBlocks = blocks.filter(b => b.type !== "tool_result");

        flushCurrentMessage();

        if (toolResultBlocks.length > 0) {
          result.messages.push({ role: "user", content: toolResultBlocks });
        }

        if (otherBlocks.length > 0) {
          currentRole = newRole;
          currentParts.push(...otherBlocks);
        }
        continue;
      }

      if (currentRole !== newRole) {
        flushCurrentMessage();
        currentRole = newRole;
      }

      currentParts.push(...blocks);

      if (hasToolUse) {
        flushCurrentMessage();
      }
    }

    flushCurrentMessage();

    // 0.5.166 (upstream 75834e96 + 5e9bd464) — a final user message with nothing
    // Claude accepts (empty string, unsupported parts) is not flushed, so the body
    // ends on assistant: prefill, which newer models reject. Judge by the role the
    // client really ended on, so its own assistant prefill is kept.
    const clientLastRole = nonSystemMessages[nonSystemMessages.length - 1]?.role;
    result.messages = ensureTrailingUserTurn(result.messages, clientLastRole === "assistant" ? "assistant" : undefined);

    // Add cache_control to last assistant message
    for (let i = result.messages.length - 1; i >= 0; i--) {
      const message = result.messages[i];
      if (message.role === "assistant" && Array.isArray(message.content) && message.content.length > 0) {
        // Find the last block that can have cache_control (not thinking blocks)
        const validBlockTypes = ["text", "tool_use", "tool_result", "image"];
        for (let j = message.content.length - 1; j >= 0; j--) {
          const block = message.content[j];
          if (validBlockTypes.includes(block.type)) {
            block.cache_control = { type: "ephemeral" };
            break;
          }
        }
        break;
      }
    }
  }

  // Handle response_format for JSON mode
  if (body.response_format) {
    const responseFormat = body.response_format;
    if (responseFormat.type === "json_schema" && responseFormat.json_schema?.schema) {
      const schemaJson = JSON.stringify(responseFormat.json_schema.schema, null, 2);
      systemParts.push(`You must respond with valid JSON that strictly follows this JSON schema:
\`\`\`json
${schemaJson}
\`\`\`
Respond ONLY with the JSON object, no other text.`);
    } else if (responseFormat.type === "json_object") {
      systemParts.push("You must respond with valid JSON. Respond ONLY with a JSON object, no other text.");
    }
  }

  // System with Claude Code prompt and cache_control
  const claudeCodePrompt = { type: "text", text: CLAUDE_SYSTEM_PROMPT };

  if (systemParts.length > 0) {
    const systemText = systemParts.join("\n");
    result.system = [
      claudeCodePrompt,
      { type: "text", text: systemText, cache_control: { type: "ephemeral", ttl: "1h" } }
    ];
  } else {
    result.system = [claudeCodePrompt];
  }

  // Tools - convert from OpenAI format to Claude format with prefix for OAuth
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [];
    for (const tool of body.tools) {
      // Pass-through built-in tools (e.g. web_search_20250305) without prefix or conversion
      const toolType = tool.type;
      if (toolType && toolType !== "function") {
        result.tools.push(tool);
        continue;
      }

      const toolData = toolType === "function" && tool.function ? tool.function : tool;
      const originalName = toolData.name;

      // Claude OAuth requires prefixed tool names to avoid conflicts
      const toolName = CLAUDE_OAUTH_TOOL_PREFIX + originalName;

      // Store mapping for response translation (prefixed → original)
      toolNameMap.set(toolName, originalName);

      result.tools.push({
        name: toolName,
        description: toolData.description || "",
        input_schema: toolData.parameters || toolData.input_schema || { type: "object", properties: {}, required: [] }
      });
    }

    if (result.tools.length > 0) {
      result.tools[result.tools.length - 1].cache_control = { type: "ephemeral", ttl: "1h" };
    }
  }

  // Tool choice
  if (body.tool_choice) {
    result.tool_choice = convertOpenAIToolChoice(body.tool_choice);
  }

  // Thinking configuration
  if (body.thinking) {
    result.thinking = {
      type: body.thinking.type || "enabled",
      ...(body.thinking.budget_tokens && { budget_tokens: body.thinking.budget_tokens }),
      ...(body.thinking.max_tokens && { max_tokens: body.thinking.max_tokens }),
      // 0.5.166 — keep a display the client chose (upstream 90b06934)
      ...(typeof body.thinking.display === "string" && { display: body.thinking.display })
    };
  }

  // Map OpenAI reasoning_effort → Claude thinking.budget_tokens
  // When client sends reasoning_effort (OpenAI format) but no explicit thinking block,
  // translate to Claude's native format.
  if (body.reasoning_effort && !result.thinking) {
    const effortToBudget = {
      none:   0,
      low:    4096,
      medium: 8192,
      high:   16384,
      xhigh:  32768,
    };
    const budget = effortToBudget[body.reasoning_effort.toLowerCase()];
    if (budget === 0) {
      // none → no thinking
    } else if (budget) {
      result.thinking = { type: "enabled", budget_tokens: budget };
    }
  }

  applyClaudeThinkingShape(model, body, result);

  // Attach toolNameMap to result for response translation
  if (toolNameMap.size > 0) {
    result._toolNameMap = toolNameMap;
  }

  return result;
}

// 0.5.166 — OpenAI reasoning_effort as Claude's effort level. Claude has no
// "none" for a model that always thinks, and no "minimal": both become "low".
const CLAUDE_EFFORT_FROM_OPENAI = {
  none: "low", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max",
};

function budgetToClaudeEffort(budget) {
  if (!(budget > 0)) return null;
  if (budget <= 4096) return "low";
  if (budget <= 8192) return "medium";
  if (budget <= 16384) return "high";
  return "xhigh";
}

function claudeEffortFromRequest(body, thinking) {
  if (typeof body.reasoning_effort === "string") {
    return CLAUDE_EFFORT_FROM_OPENAI[body.reasoning_effort.toLowerCase()] || null;
  }
  if (thinking?.type === "enabled") return budgetToClaudeEffort(Number(thinking.budget_tokens));
  return null;
}

// Chat Completions has no summary knob: a client that sets reasoning_effort is
// asking for reasoning, and reasoning_content is how it would receive it.
function wantsReasoningText(body) {
  if (typeof body.reasoning_effort !== "string") return false;
  const effort = body.reasoning_effort.toLowerCase();
  return effort !== "none" && effort !== "off";
}

// Shape the thinking fields for the Claude model being called.
// 0.5.166 (upstream ac9120fd) — models that think on every turn (Opus 5.5, Sonnet
// 5.5, Fable) take output_config.effort; the budget switch is the old shape (Fable
// answers it with 400). "disabled" is left for prepareClaudeRequest, which rewrites
// it per model.
// 0.5.166 (upstream 90b06934) — elsewhere, Claude returns thinking text only with
// thinking.display "summarized", which OpenAI has no field for. Ask for it when the
// client asked for reasoning; selectAnthropicBeta then drops redact-thinking.
function applyClaudeThinkingShape(model, body, result) {
  if (isAlwaysThinkingClaude(model)) {
    const effort = claudeEffortFromRequest(body, result.thinking);
    if (result.thinking?.type !== "disabled") delete result.thinking;
    if (effort) result.output_config = { effort };
    return;
  }
  const thinking = result.thinking;
  if (!/claude/i.test(model) || !wantsReasoningText(body)) return;
  if (!thinking || thinking.type === "disabled" || thinking.display) return;
  result.thinking = { ...thinking, display: "summarized" };
}

// A tool message may carry an OpenAI content array (text + image_url parts). Claude
// accepts image blocks inside tool_result, but not OpenAI image_url parts: forwarding
// one verbatim is answered 400 "Input tag 'image_url' ... does not match any of the
// expected tags" (upstream 95009651, #5125). Convert them the way the user branch below
// already does — same regex and same block shapes, so the two paths cannot drift.
// A plain string is passed through untouched.
function convertToolResultContent(content) {
  if (!Array.isArray(content)) return content;

  const parts = [];
  for (const part of content) {
    if (part.type === "text" && part.text) {
      parts.push({ type: "text", text: part.text });
    } else if (part.type === "image_url" && part.image_url?.url) {
      const url = part.image_url.url;
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({
          type: "image",
          source: { type: "base64", media_type: match[1], data: match[2] }
        });
      } else if (url.startsWith("http://") || url.startsWith("https://")) {
        parts.push({ type: "image", source: { type: "url", url } });
      }
    } else if (part.type === "image" && part.source) {
      parts.push({ type: "image", source: part.source });
    }
  }

  // Nothing convertible: keep the original payload rather than sending an empty result.
  return parts.length > 0 ? parts : content;
}

// Get content blocks from single message
function getContentBlocksFromMessage(msg, toolNameMap = new Map()) {
  const blocks = [];

  if (msg.role === "tool") {
    blocks.push({
      type: "tool_result",
      tool_use_id: msg.tool_call_id,
      content: convertToolResultContent(msg.content)
    });
  } else if (msg.role === "user") {
    if (typeof msg.content === "string") {
      if (msg.content) {
        blocks.push({ type: "text", text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          blocks.push({ type: "text", text: part.text });
        } else if (part.type === "tool_result") {
          blocks.push({
            type: "tool_result",
            tool_use_id: part.tool_use_id,
            content: part.content,
            ...(part.is_error && { is_error: part.is_error })
          });
        } else if (part.type === "image_url") {
          const url = part.image_url.url;
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            blocks.push({
              type: "image",
              source: { type: "base64", media_type: match[1], data: match[2] }
            });
          } else if (url.startsWith("http://") || url.startsWith("https://")) {
            blocks.push({
              type: "image",
              source: { type: "url", url }
            });
          }
        } else if (part.type === "image" && part.source) {
          blocks.push({ type: "image", source: part.source });
        }
      }
    }
  } else if (msg.role === "assistant") {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          blocks.push({ type: "text", text: part.text });
        } else if (part.type === "tool_use") {
          // Tool name already has prefix from tool declarations, keep as-is
          blocks.push({ type: "tool_use", id: part.id, name: part.name, input: part.input });
        } else if (part.type === "thinking") {
          // Include thinking block but strip cache_control (not allowed on thinking blocks)
          const { cache_control, ...thinkingBlock } = part;
          blocks.push(thinkingBlock);
        }
      }
    } else if (msg.content) {
      const text = typeof msg.content === "string" ? msg.content : extractTextContent(msg.content);
      if (text) {
        blocks.push({ type: "text", text });
      }
    }

    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.type === "function") {
          // Apply prefix to tool name
          const toolName = CLAUDE_OAUTH_TOOL_PREFIX + tc.function.name;
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: toolName,
            input: tryParseJSON(tc.function.arguments)
          });
        }
      }
    }
  }

  return blocks;
}

// Convert OpenAI tool choice to Claude format.
// Claude only accepts tool_choice.type of "auto" | "any" | "tool" | "none";
// anything else (e.g. OpenAI's "function") triggers a 400, so we never pass an
// unrecognized type through.
const CLAUDE_TOOL_CHOICE_TYPES = new Set(["auto", "any", "tool", "none"]);

function convertOpenAIToolChoice(choice) {
  if (!choice) return { type: "auto" };

  // OpenAI string forms: "auto" | "none" | "required"
  if (typeof choice === "string") {
    if (choice === "required") return { type: "any" };
    return { type: "auto" }; // "auto", "none", or anything unexpected
  }

  if (typeof choice === "object") {
    // OpenAI forced tool: { type: "function", function: { name } }.
    // Checked before the native pass-through below, because the OpenAI shape
    // also carries a `.type` ("function") that Claude rejects.
    if (choice.function?.name) {
      return { type: "tool", name: choice.function.name };
    }
    // Already Claude-native — only pass through types Claude actually accepts,
    // so a malformed or unknown type can never leak into the upstream request.
    if (CLAUDE_TOOL_CHOICE_TYPES.has(choice.type)) {
      return choice;
    }
  }

  return { type: "auto" };
}

// Extract text from content
function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === "text").map(c => c.text).join("\n");
  }
  return "";
}

// Try parse JSON
function tryParseJSON(str) {
  if (typeof str !== "string") return str;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

// OpenAI -> Claude format for Antigravity (without system prompt modifications)
function openaiToClaudeRequestForAntigravity(model, body, stream) {
  const result = openaiToClaudeRequest(model, body, stream);

  // Remove Claude Code system prompt, keep only user's system messages
  if (result.system && Array.isArray(result.system)) {
    result.system = result.system.filter(block =>
      !block.text || !block.text.includes("You are Claude Code")
    );
    if (result.system.length === 0) {
      delete result.system;
    }
  }

  // Strip prefix from tool names for Antigravity (doesn't use Claude OAuth)
  if (result.tools && Array.isArray(result.tools)) {
    result.tools = result.tools.map(tool => {
      if (tool.name && tool.name.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)) {
        return {
          ...tool,
          name: tool.name.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
        };
      }
      return tool;
    });
  }

  // Strip prefix from tool_use in messages
  if (result.messages && Array.isArray(result.messages)) {
    result.messages = result.messages.map(msg => {
      if (!msg.content || !Array.isArray(msg.content)) {
        return msg;
      }

      const updatedContent = msg.content.map(block => {
        if (block.type === "tool_use" && block.name && block.name.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)) {
          return {
            ...block,
            name: block.name.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
          };
        }
        return block;
      });

      return { ...msg, content: updatedContent };
    });
  }

  return result;
}

// Export for use in other translators
export { openaiToClaudeRequestForAntigravity };

// Register
register(FORMATS.OPENAI, FORMATS.CLAUDE, openaiToClaudeRequest, null);

