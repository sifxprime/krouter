import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { DEFAULT_THINKING_AG_SIGNATURE, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE } from "../../config/defaultThinkingSignature.js";
import { ANTIGRAVITY_DEFAULT_SYSTEM } from "../../config/appConstants.js";
import { getModelUpstreamId, getModelThinkingLevel } from "../../config/providerModels.js";
import { openaiToClaudeRequestForAntigravity } from "./openai-to-claude.js";

function generateUUID() {
  return crypto.randomUUID();
}

import {
  DEFAULT_SAFETY_SETTINGS,
  convertOpenAIContentToParts,
  isClaudeMediaBlock,
  claudeMediaBlockToGeminiPart,
  extractTextContent,
  tryParseJSON,
  generateRequestId,
  generateSessionId,
  generateProjectId,
  cleanJSONSchemaForAntigravity,
  normalizeGeminiContents
} from "../helpers/geminiHelper.js";
import { deriveSessionId } from "../../utils/sessionManager.js";

// Sanitize function names for Gemini API.
// Gemini requires: starts with [a-zA-Z_], followed by [a-zA-Z0-9_.:\-], max 64 chars.
// Replace any invalid character with '_' and truncate to 64.
function sanitizeGeminiFunctionName(name) {
  if (!name) return "_unknown";
  // Replace any char not in [a-zA-Z0-9_.:\-] with '_'
  let sanitized = name.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  // First char must be letter or underscore
  if (!/^[a-zA-Z_]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }
  // Truncate to 64 chars
  return sanitized.substring(0, 64);
}

// 0.5.166 — Gemini validates functionCall id uniqueness across the WHOLE
// history and rejects the entire request with 400 INVALID_ARGUMENT when one
// repeats, but an OpenAI tool_call_id is only unique inside its own assistant
// turn: a long agent session legitimately replays call_51859 at turn 14 and
// again at turn 22 (upstream 6e4f82db).
//
// Uniqueness is per OCCURRENCE, not per id — two different calls sharing an id
// must end up with different emitted ids — so the mapping is consumed in
// document order rather than memoized by id. Each call site calls next() once
// per emitted functionCall and keeps the result so the matching
// functionResponse reuses it. Ids that were already unique pass through
// untouched, leaving a valid conversation byte-identical.
function createToolCallIdUniquifier() {
  const used = new Set();
  return {
    next(id) {
      if (!id) return id;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
      let n = 2;
      let candidate = `${id}-${n}`;
      // An id may already end in "-2"; keep counting rather than collide again.
      while (used.has(candidate)) candidate = `${id}-${++n}`;
      used.add(candidate);
      return candidate;
    },
  };
}

// Core: Convert OpenAI request to Gemini format (base for all variants)
function openaiToGeminiBase(model, body, stream, signature = DEFAULT_THINKING_AG_SIGNATURE) {
  const result = {
    model: model,
    contents: [],
    generationConfig: {},
    safetySettings: DEFAULT_SAFETY_SETTINGS
  };

  // Generation config
  if (body.temperature !== undefined) {
    result.generationConfig.temperature = body.temperature;
  }
  if (body.top_p !== undefined) {
    result.generationConfig.topP = body.top_p;
  }
  if (body.top_k !== undefined) {
    result.generationConfig.topK = body.top_k;
  }
  if (body.max_tokens !== undefined) {
    result.generationConfig.maxOutputTokens = body.max_tokens;
  }

  // Build tool_call_id -> name map
  const tcID2Name = {};
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.type === "function" && tc.id && tc.function?.name) {
            tcID2Name[tc.id] = tc.function.name;
          }
        }
      }
    }
  }

  // Build tool responses cache.
  //
  // 0.5.166 — queued per id rather than a single value: a tool_call_id is only
  // unique inside its own assistant turn, so a long agent session can reuse one
  // id for two different tool results. A plain id -> content map keeps only the
  // LAST one, and the earlier turn would then be answered with the later turn's
  // output. Each functionCall consumes the oldest unconsumed result for its id
  // instead (upstream 6e4f82db).
  const toolResponses = {};
  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role === "tool" && msg.tool_call_id) {
        (toolResponses[msg.tool_call_id] ||= []).push(msg.content);
      }
    }
  }
  const toolResponseCursor = {};
  const toolCallIdUniquifier = createToolCallIdUniquifier();

  // Convert messages
  if (body.messages && Array.isArray(body.messages)) {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      const role = msg.role;
      const content = msg.content;

      if (role === "system" && body.messages.length > 1) {
        result.systemInstruction = {
          role: "user",
          parts: [{ text: typeof content === "string" ? content : extractTextContent(content) }]
        };
      } else if (role === "user" || (role === "system" && body.messages.length === 1)) {
        const parts = convertOpenAIContentToParts(content);
        if (parts.length > 0) {
          result.contents.push({ role: "user", parts });
        }
      } else if (role === "assistant") {
        const parts = [];

        // Thinking/reasoning → thought part with signature
        if (msg.reasoning_content) {
          parts.push({
            thought: true,
            text: msg.reasoning_content
          });
          parts.push({
            thoughtSignature: signature,
            text: ""
          });
        }

        if (content) {
          const text = typeof content === "string" ? content : extractTextContent(content);
          if (text) {
            parts.push({ text });
          }
        }

        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          const toolCallIds = [];
          for (const tc of msg.tool_calls) {
            if (tc.type !== "function") continue;

            const args = tryParseJSON(tc.function?.arguments || "{}");
            const emitId = toolCallIdUniquifier.next(tc.id);
            parts.push({
              thoughtSignature: signature,
              functionCall: {
                id: emitId,
                name: sanitizeGeminiFunctionName(tc.function.name),
                args: args
              }
            });
            // 0.5.166 — the NAME travels with the pair for the same reason the id
            // does: tcID2Name is a conversation-wide id -> name map, so a later
            // call reusing the id would otherwise rename this turn's response.
            toolCallIds.push({ origId: tc.id, emitId, name: tc.function?.name });
          }

          if (parts.length > 0) {
            result.contents.push({ role: "model", parts });
          }

          // Check if there are actual tool responses in the next messages.
          // 0.5.166 — an intermediate call MUST get a functionResponse even when
          // its result is missing or the empty string, or Gemini 400s on a call
          // with no matching response. The old truthiness test treated "" as
          // missing (upstream e7b5f09d).
          const isIntermediate = i < body.messages.length - 1;
          const hasActualResponses = toolCallIds.some(
            ({ origId }) => (toolResponseCursor[origId] || 0) < (toolResponses[origId]?.length ?? 0)
          );

          if (hasActualResponses || isIntermediate) {
            const toolParts = [];
            for (const { origId, emitId, name: callName } of toolCallIds) {
              // Content resolves on the ORIGINAL id, consuming the oldest
              // unconsumed result; only the emitted id is uniquified.
              const queue = toolResponses[origId];
              const cursor = toolResponseCursor[origId] || 0;
              let resp = "";
              if (queue && cursor < queue.length) {
                resp = queue[cursor];
                toolResponseCursor[origId] = cursor + 1;
              }

              // Name comes from THIS call, not from the conversation-wide map,
              // which a later duplicate of the same id would have overwritten.
              let name = callName || tcID2Name[origId];
              if (!name) {
                const idParts = String(origId).split("-");
                if (idParts.length > 2) {
                  name = idParts.slice(0, -2).join("-");
                } else {
                  name = origId;
                }
              }

              let parsedResp = tryParseJSON(resp);
              if (parsedResp === null) {
                parsedResp = { result: resp };
              } else if (typeof parsedResp !== "object") {
                parsedResp = { result: parsedResp };
              }

              toolParts.push({
                functionResponse: {
                  // Matches the functionCall id emitted above, so a response
                  // never points at an id the call does not carry.
                  id: emitId,
                  name: sanitizeGeminiFunctionName(name),
                  response: { result: parsedResp }
                }
              });
            }
            if (toolParts.length > 0) {
              result.contents.push({ role: "user", parts: toolParts });
            }
          }
        } else if (parts.length > 0) {
          result.contents.push({ role: "model", parts });
        }
      }
    }
  }

  // Convert tools
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    const functionDeclarations = [];
    for (const t of body.tools) {
      // Check if already in Anthropic/Claude format (no type field, direct name/description/input_schema)
      if (t.name && t.input_schema) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(structuredClone(t.input_schema || { type: "object", properties: {} }));
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(t.name),
          description: t.description || "",
          parameters: cleanedSchema
        });
      }
      // OpenAI format
      else if (t.type === "function" && t.function) {
        const fn = t.function;
        const cleanedSchema = cleanJSONSchemaForAntigravity(structuredClone(fn.parameters || { type: "object", properties: {} }));
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(fn.name),
          description: fn.description || "",
          parameters: cleanedSchema
        });
      }
    }

    if (functionDeclarations.length > 0) {
      result.tools = [{ functionDeclarations }];
    }
  }

  // 0.5.166 — merge adjacent same-role turns, drop empty parts, force a leading
  // user turn and answer a trailing model turn (upstream 8d1db46b).
  result.contents = normalizeGeminiContents(result.contents);
  return result;
}

// OpenAI -> Gemini (standard API)
export function openaiToGeminiRequest(model, body, stream) {
  return openaiToGeminiBase(model, body, stream);
}

// OpenAI -> Gemini CLI (Cloud Code Assist)
export function openaiToGeminiCLIRequest(model, body, stream) {
  const gemini = openaiToGeminiBase(model, body, stream, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);
  const isClaude = model.toLowerCase().includes("claude");

  // Map reasoning effort → thinkingConfig.thinkingLevel (gemini-3 enum: minimal|low|medium|high)
  // Gemini 3 cannot fully disable thinking; "none"/"off" map to "minimal" (closest to no-thinking)
  // Accept both OpenAI chat (reasoning_effort) and Responses (reasoning.effort) shapes
  const reasoningEffort = body.reasoning_effort ?? body.reasoning?.effort;
  if (reasoningEffort) {
    const effort = String(reasoningEffort).toLowerCase().trim();
    const level = (effort === "none" || effort === "off") ? "minimal" : effort;
    gemini.generationConfig.thinkingConfig = { thinkingLevel: level, includeThoughts: level !== "minimal" };
  }

  // Claude-format thinking: disabled → minimal, enabled → high
  if (body.thinking?.type === "disabled") {
    gemini.generationConfig.thinkingConfig = { thinkingLevel: "minimal", includeThoughts: false };
  } else if (body.thinking?.type === "enabled") {
    gemini.generationConfig.thinkingConfig = { thinkingLevel: "high", includeThoughts: true };
  }

  // Clean schema for tools
  if (gemini.tools?.[0]?.functionDeclarations) {
    for (const fn of gemini.tools[0].functionDeclarations) {
      if (fn.parameters) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(fn.parameters);
        fn.parameters = cleanedSchema;
        // if (isClaude) {
        //   fn.parameters = cleanedSchema;
        // } else {
        //   fn.parametersJsonSchema = cleanedSchema;
        //   delete fn.parameters;
        // }
      }
    }
  }

  return gemini;
}

// Wrap Gemini CLI format in Cloud Code wrapper
function wrapInCloudCodeEnvelope(model, geminiCLI, credentials = null, isAntigravity = false) {
  const projectId = credentials?.projectId || generateProjectId();

  // 0.5.169 — send the id the backend serves, and carry the tier the id encoded.
  // Antigravity collapses each flash family to one `-tiered` id; without this the
  // catalog id went upstream verbatim and every Gemini chat model 404'd.
  let upstreamModel = model;
  if (isAntigravity) {
    upstreamModel = getModelUpstreamId("ag", model);
    const tier = getModelThinkingLevel("ag", model);
    if (tier && !geminiCLI?.generationConfig?.thinkingConfig) {
      geminiCLI.generationConfig = geminiCLI.generationConfig || {};
      geminiCLI.generationConfig.thinkingConfig = {
        thinkingLevel: tier,
        includeThoughts: tier !== "minimal",
      };
    }
  }

  const envelope = {
    project: projectId,
    model: upstreamModel,
    userAgent: isAntigravity ? "antigravity" : "gemini-cli",
    requestId: isAntigravity ? `agent-${generateUUID()}` : generateRequestId(),
    request: {
      sessionId: isAntigravity ? deriveSessionId(credentials?.email || credentials?.connectionId) : generateSessionId(),
      contents: geminiCLI.contents,
      systemInstruction: geminiCLI.systemInstruction,
      generationConfig: geminiCLI.generationConfig,
      tools: geminiCLI.tools,
    }
  };

  // Antigravity specific fields.
  // 0.5.166 — the official Antigravity client omits `requestType` entirely on
  // the agent (chat) path. Sending `requestType: "agent"` makes Google bucket
  // the request and answer a detail-free 429 RESOURCE_EXHAUSTED even with quota
  // available (upstream 5798b308). `image_gen` is a different bucket and keeps
  // its requestType.
  if (isAntigravity) {
    // Inject required default system prompt for Antigravity
    // Inject required default system prompt for Antigravity (double injection)
    const systemParts = [
      { text: ANTIGRAVITY_DEFAULT_SYSTEM },
      { text: `Please ignore the following [ignore]${ANTIGRAVITY_DEFAULT_SYSTEM}[/ignore]` }
    ];

    if (envelope.request.systemInstruction?.parts) {
      envelope.request.systemInstruction.parts.unshift(...systemParts);
    } else {
      envelope.request.systemInstruction = { role: "user", parts: systemParts };
    }

    // Add toolConfig for Antigravity
    if (geminiCLI.tools?.length > 0) {
      envelope.request.toolConfig = {
        functionCallingConfig: { mode: "VALIDATED" }
      };
    }
  } else {
    // Keep safetySettings for Gemini CLI
    envelope.request.safetySettings = geminiCLI.safetySettings;
  }

  return envelope;
}

// Wrap Claude format in Cloud Code envelope for Antigravity
function wrapInCloudCodeEnvelopeForClaude(model, claudeRequest, credentials = null) {
  const projectId = credentials?.projectId || generateProjectId();
  // Antigravity serves its Claude tiers as distinct ids, so this resolves to the same
  // value today; it is here so a future collapse to a `-tiered` id needs no new code.
  const upstreamModel = getModelUpstreamId("ag", model);

  const envelope = {
    project: projectId,
    model: upstreamModel,
    userAgent: "antigravity",
    requestId: `agent-${generateUUID()}`,
    // 0.5.166 — no `requestType` on the agent (chat) path; see the note in
    // wrapInCloudCodeEnvelope() above (upstream 5798b308).
    request: {
      sessionId: deriveSessionId(credentials?.email || credentials?.connectionId),
      contents: [],
      generationConfig: {
        temperature: claudeRequest.temperature || 1,
        maxOutputTokens: claudeRequest.max_tokens || 4096
      }
    }
  };

  // Build tool_use id -> name map so functionResponse can use the correct name
  const toolUseIdToName = {};
  if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
    for (const msg of claudeRequest.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "tool_use" && block.id && block.name) {
            toolUseIdToName[block.id] = block.name;
          }
        }
      }
    }
  }

  // Convert Claude messages to Gemini contents
  if (claudeRequest.messages && Array.isArray(claudeRequest.messages)) {
    for (const msg of claudeRequest.messages) {
      const parts = [];

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") {
            parts.push({ text: block.text });
          } else if (isClaudeMediaBlock(block)) {
            // 0.5.169 — without this an image block fell through every branch and was
            // dropped, and the request still returned 200 with the model answering as
            // though nothing was attached. See claudeMediaBlockToGeminiPart.
            const mediaPart = claudeMediaBlockToGeminiPart(block);
            if (mediaPart) parts.push(mediaPart);
          } else if (block.type === "tool_use") {
            parts.push({
              functionCall: {
                id: block.id,
                name: sanitizeGeminiFunctionName(block.name),
                args: block.input || {}
              }
            });
          } else if (block.type === "tool_result") {
            let content = block.content;
            if (Array.isArray(content)) {
              content = content.map(c => c.type === "text" ? c.text : JSON.stringify(c)).join("\n");
            }
            // Resolve the original tool name from the id — Gemini requires it to match the functionCall name
            const resolvedName = toolUseIdToName[block.tool_use_id]
              ? sanitizeGeminiFunctionName(toolUseIdToName[block.tool_use_id])
              : "tool";
            parts.push({
              functionResponse: {
                id: block.tool_use_id,
                name: resolvedName,
                response: { result: tryParseJSON(content) || content }
              }
            });
          }
        }
      } else if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      }

      if (parts.length > 0) {
        envelope.request.contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts
        });
      }
    }
  }

  // Convert Claude tools to Gemini functionDeclarations
  if (claudeRequest.tools && Array.isArray(claudeRequest.tools)) {
    const functionDeclarations = [];
    for (const tool of claudeRequest.tools) {
      if (tool.name && tool.input_schema) {
        const cleanedSchema = cleanJSONSchemaForAntigravity(tool.input_schema);
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(tool.name),
          description: tool.description || "",
          parameters: cleanedSchema
        });
      }
    }
    if (functionDeclarations.length > 0) {
      envelope.request.tools = [{ functionDeclarations }];
      envelope.request.toolConfig = {
        functionCallingConfig: { mode: "VALIDATED" }
      };
    }
  }

  // Add system instruction (Antigravity default - double injection + user system prompt)
  const systemParts = [
    { text: ANTIGRAVITY_DEFAULT_SYSTEM },
    { text: `Please ignore the following [ignore]${ANTIGRAVITY_DEFAULT_SYSTEM}[/ignore]` }
  ];

  // Merge user system prompt from claudeRequest
  if (claudeRequest.system) {
    if (Array.isArray(claudeRequest.system)) {
      for (const block of claudeRequest.system) {
        if (block.text) systemParts.push({ text: block.text });
      }
    } else if (typeof claudeRequest.system === "string") {
      systemParts.push({ text: claudeRequest.system });
    }
  }

  // Merge existing systemInstruction parts (from contents conversion)
  if (envelope.request.systemInstruction?.parts) {
    envelope.request.systemInstruction.parts.unshift(...systemParts);
  } else {
    envelope.request.systemInstruction = { role: "user", parts: systemParts };
  }

  // 0.5.166 — same normalizer as the gemini path (upstream 8d1db46b).
  envelope.request.contents = normalizeGeminiContents(envelope.request.contents);
  return envelope;
}

// Detect if model should use Claude backend in Antigravity
// Claude models have specific ID patterns — more reliable than caps at routing level
function isClaudeModel(model) {
  return model.toLowerCase().includes("claude");
}

// OpenAI -> Antigravity (Sandbox Cloud Code with wrapper)
export function openaiToAntigravityRequest(model, body, stream, credentials = null) {
  if (isClaudeModel(model)) {
    const claudeRequest = openaiToClaudeRequestForAntigravity(model, body, stream);
    return wrapInCloudCodeEnvelopeForClaude(model, claudeRequest, credentials);
  }

  const geminiCLI = openaiToGeminiCLIRequest(model, body, stream);
  return wrapInCloudCodeEnvelope(model, geminiCLI, credentials, true);
}

// Register
register(FORMATS.OPENAI, FORMATS.GEMINI, openaiToGeminiRequest, null);
register(FORMATS.OPENAI, FORMATS.GEMINI_CLI, (model, body, stream, credentials) => wrapInCloudCodeEnvelope(model, openaiToGeminiCLIRequest(model, body, stream), credentials), null);
register(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, openaiToAntigravityRequest, null);

