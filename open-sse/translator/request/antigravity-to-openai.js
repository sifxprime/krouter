import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../helpers/maxTokensHelper.js";

// Convert Antigravity request to OpenAI format
// Antigravity body: { project, model, userAgent, requestType, requestId, request: { contents, systemInstruction, tools, toolConfig, generationConfig, sessionId } }
export function antigravityToOpenAIRequest(model, body, stream) {
  const req = body.request || body;
  const result = {
    model: model,
    messages: [],
    stream: stream
  };

  // Generation config
  if (req.generationConfig) {
    const config = req.generationConfig;
    if (config.maxOutputTokens) {
      const tempBody = { max_tokens: config.maxOutputTokens, tools: req.tools };
      result.max_tokens = adjustMaxTokens(tempBody);
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      result.top_p = config.topP;
    }
    if (config.topK !== undefined) {
      result.top_k = config.topK;
    }

    // Thinking config → reasoning_effort
    if (config.thinkingConfig) {
      const budget = config.thinkingConfig.thinkingBudget || 0;
      if (budget > 0) {
        if (budget <= 2048) {
          result.reasoning_effort = "low";
        } else if (budget <= 16384) {
          result.reasoning_effort = "medium";
        } else {
          result.reasoning_effort = "high";
        }
      }
    }
  }

  // System instruction
  if (req.systemInstruction) {
    const systemText = extractText(req.systemInstruction);
    if (systemText) {
      result.messages.push({ role: "system", content: systemText });
    }
  }

  // Convert contents to messages
  if (req.contents && Array.isArray(req.contents)) {
    for (const content of req.contents) {
      const converted = convertContent(content);
      if (converted) {
        if (Array.isArray(converted)) {
          result.messages.push(...converted);
        } else {
          result.messages.push(converted);
        }
      }
    }
  }

  // Tools
  if (req.tools && Array.isArray(req.tools)) {
    result.tools = [];
    for (const tool of req.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          result.tools.push({
            type: "function",
            function: {
              name: func.name,
              description: func.description || "",
              parameters: normalizeSchemaTypes(func.parameters) || { type: "object", properties: {} }
            }
          });
        }
      }
    }
  }

  return result;
}

// JSON Schema keywords whose value must be a NUMBER. Gemini's Schema comes off the
// wire from protobuf, where these are int64 — and protobuf JSON encodes int64 as a
// STRING. So a real Antigravity turn sends `"minLength": "1"`, which Anthropic
// rejects outright:
//   tools.4.custom.input_schema: JSON schema is invalid. It must match JSON Schema
//   draft 2020-12
// The whole chat fails on one malformed tool out of eighteen.
const NUMERIC_SCHEMA_KEYWORDS = [
  "minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minContains", "maxContains",
];

// Subschemas live under more than properties/items. Missing one leaves an uppercase
// type or a string-encoded bound buried where it is hard to see and fails the same way.
const SCHEMA_VALUE_KEYS = ["items", "not", "propertyNames", "contains", "if", "then", "else"];
const SCHEMA_LIST_KEYS = ["anyOf", "oneOf", "allOf", "prefixItems"];
const SCHEMA_MAP_KEYS = ["properties", "$defs", "definitions", "patternProperties"];

// Recursively convert Antigravity schema types (OBJECT, STRING, etc.) to lowercase,
// coerce string-encoded numeric keywords, and strip fields upstream APIs reject.
function normalizeSchemaTypes(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(normalizeSchemaTypes);

  const result = { ...schema };

  if (typeof result.type === "string") {
    result.type = result.type.toLowerCase();
  } else if (Array.isArray(result.type)) {
    result.type = result.type.map((t) => (typeof t === "string" ? t.toLowerCase() : t));
  }

  for (const key of NUMERIC_SCHEMA_KEYWORDS) {
    const value = result[key];
    // Only a string that is wholly a finite number — never coerce "" (→0) or junk,
    // which would invent a constraint the tool never declared.
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      result[key] = Number(value);
    }
  }

  // Strip enumDescriptions — not supported by upstream APIs
  delete result.enumDescriptions;

  for (const key of SCHEMA_MAP_KEYS) {
    if (result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      const normalized = {};
      for (const [k, v] of Object.entries(result[key])) normalized[k] = normalizeSchemaTypes(v);
      result[key] = normalized;
    }
  }

  for (const key of SCHEMA_LIST_KEYS) {
    if (Array.isArray(result[key])) result[key] = result[key].map(normalizeSchemaTypes);
  }

  for (const key of SCHEMA_VALUE_KEYS) {
    if (result[key] && typeof result[key] === "object") result[key] = normalizeSchemaTypes(result[key]);
  }

  // additionalProperties is a schema OR a boolean; only recurse into the schema form.
  if (result.additionalProperties && typeof result.additionalProperties === "object") {
    result.additionalProperties = normalizeSchemaTypes(result.additionalProperties);
  }

  return result;
}

// Convert Antigravity content to OpenAI message
// Handles: text, thought, thoughtSignature, functionCall, functionResponse, inlineData
function convertContent(content) {
  const role = content.role === "model" ? "assistant" : content.role === "user" ? "user" : content.role;

  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const textParts = [];
  const toolCalls = [];
  const toolResults = [];
  let reasoningContent = "";

  for (const part of content.parts) {
    // Thinking content (thought: true)
    if (part.thought === true && part.text) {
      reasoningContent += part.text;
      continue;
    }

    // Text with thoughtSignature = regular text after thinking
    if (part.thoughtSignature && part.text !== undefined) {
      textParts.push({ type: "text", text: part.text });
      continue;
    }

    // Regular text
    if (part.text !== undefined) {
      textParts.push({ type: "text", text: part.text });
    }

    // Inline data (images)
    if (part.inlineData) {
      textParts.push({
        type: "image_url",
        image_url: {
          url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
        }
      });
    }

    // Function call
    if (part.functionCall) {
      toolCalls.push({
        // Deterministic id from the function name: Antigravity (Gemini) doesn't always
        // emit a call id, but the matching functionResponse in the next turn references
        // the same function name. A random id here would never pair on the way back, so
        // the downstream OpenAI executor rejected the tool result with a 400.
        // (port of upstream aba4c45)
        id: part.functionCall.id || `call_${part.functionCall.name}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });
    }

    // Function response → collect all, each becomes a separate tool message
    if (part.functionResponse) {
      toolResults.push({
        role: "tool",
        // Mirror the same deterministic id shape so functionCall ↔ functionResponse pair.
        tool_call_id: part.functionResponse.id || `call_${part.functionResponse.name}`,
        content: JSON.stringify(part.functionResponse.response?.result || part.functionResponse.response || {})
      });
    }
  }

  // Content with only functionResponses → return array of tool messages
  if (toolResults.length > 0) {
    return toolResults;
  }

  // Assistant with tool calls
  if (toolCalls.length > 0) {
    const msg = { role: "assistant" };
    if (textParts.length > 0) {
      msg.content = textParts.length === 1 && textParts[0].type === "text" ? textParts[0].text : textParts;
    }
    if (reasoningContent) {
      msg.reasoning_content = reasoningContent;
    }
    msg.tool_calls = toolCalls;
    return msg;
  }

  // Regular message
  if (textParts.length > 0 || reasoningContent) {
    const msg = { role };
    if (textParts.length > 0) {
      msg.content = textParts.length === 1 && textParts[0].type === "text" ? textParts[0].text : textParts;
    }
    if (reasoningContent) {
      msg.reasoning_content = reasoningContent;
    }
    return msg;
  }

  return null;
}

// Extract text from systemInstruction
function extractText(instruction) {
  if (typeof instruction === "string") return instruction;
  if (instruction.parts && Array.isArray(instruction.parts)) {
    return instruction.parts.map(p => p.text || "").join("");
  }
  return "";
}

// Register
register(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, antigravityToOpenAIRequest, null);
