// Gemini helper functions for translator

// Unsupported JSON Schema constraints that should be removed for Antigravity
export const UNSUPPORTED_SCHEMA_CONSTRAINTS = [
  // Basic constraints (not supported by Gemini API)
  "minLength", "maxLength", "exclusiveMinimum", "exclusiveMaximum",
  "pattern", "minItems", "maxItems", "format",
  // Claude rejects these in VALIDATED mode
  "default", "examples",
  // JSON Schema meta keywords
  "$schema", "$defs", "definitions", "const", "$ref", "$comment",
  // Object validation keywords (not supported)
  "additionalProperties", "propertyNames", "patternProperties", "enumDescriptions",
  // Complex schema keywords (handled by flattenAnyOfOneOf/mergeAllOf)
  "anyOf", "oneOf", "allOf", "not",
  // Dependency keywords (not supported)
  "dependencies", "dependentSchemas", "dependentRequired",
  // 0.5.121 (upstream 2abe8b85) — Gemini's proto schema has no field for these;
  // a single occurrence 400s the whole request ("Unknown name … Cannot find field").
  "multipleOf", "uniqueItems", "contains", "unevaluatedProperties", "unevaluatedItems", "contentSchema",
  // Tuple-array keywords; converted to items first, leftovers stripped
  "prefixItems", "additionalItems",
  // Other unsupported keywords
  "title", "optional", "if", "then", "else", "contentMediaType", "contentEncoding",
  // UI/Styling properties (from Cursor tools - NOT JSON Schema standard)
  "cornerRadius", "fillColor", "fontFamily", "fontSize", "fontWeight",
  "gap", "padding", "strokeColor", "strokeThickness", "textColor",
  // 0.5.166 — non-standard annotation keywords some MCP tool schemas carry
  // (JSON-Schema editor/IDE extensions). Gemini's schema proto has no field for
  // them, so one occurrence anywhere rejects the whole request with
  // "Unknown name X: Cannot find field" (upstream aafe3002). The x-* spellings
  // are already covered by the `x-` prefix rule in removeUnsupportedKeywords;
  // they are listed for the record only.
  "errorMessage", "errorMessages", "markdownDescription",
  "doNotSuggest", "suggestSortText", "deprecated",
  "minProperties", "maxProperties"
];

// Default safety settings
export const DEFAULT_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "OFF" }
];

// Convert OpenAI content to Gemini parts
export function convertOpenAIContentToParts(content) {
  const parts = [];

  if (typeof content === "string") {
    parts.push({ text: content });
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === "text") {
        parts.push({ text: item.text });
      } else if (item.type === "image_url" && item.image_url?.url?.startsWith("data:")) {
        const url = item.image_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex); // skip "data:"
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0];

          parts.push({
            inlineData: { mime_type: mimeType, data: data }
          });
        }
      } else if (item.type === "image_url" && item.image_url?.url && (item.image_url.url.startsWith("http://") || item.image_url.url.startsWith("https://"))) {
        parts.push({
          fileData: { fileUri: item.image_url.url, mimeType: "image/*" }
        });
      } else if (item.type === "input_audio" && item.input_audio?.data) {
        const format = item.input_audio.format || "wav";
        const mimeType = format === "mp3" ? "audio/mpeg" : `audio/${format}`;
        parts.push({
          inlineData: { mime_type: mimeType, data: item.input_audio.data }
        });
      } else if (item.type === "audio_url" && item.audio_url?.url?.startsWith("data:")) {
        const url = item.audio_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex);
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0];
          parts.push({
            inlineData: { mime_type: mimeType, data: data }
          });
        }
      }
    }
  }

  return parts;
}

// Extract text content from OpenAI content
// 0.5.169 — convert a Claude media block to a Gemini part.
//
// The Antigravity Claude path (wrapInCloudCodeEnvelopeForClaude) converted Claude blocks
// to Gemini parts with an explicit branch list — text, tool_use, tool_result — and no
// image branch, so an image block was dropped on the floor. The request then succeeded
// with HTTP 200 and the model answered as if no image had been sent, which is billed and
// looks like a normal reply. Reproduced on a live install with a 96x96 solid-red PNG and
// the prompt "What colour is this image?":
//   cc/claude-opus-5           -> "Red"
//   kr/claude-sonnet-4.5       -> "Red"
//   ag/claude-sonnet-5-5-high  -> "I can't answer that because no image came through."
//
// Claude's block carries the payload under `source`; Gemini wants inlineData for bytes
// and fileData for a URL. Kept here rather than inline so the Gemini-family translators
// share one definition.
const CLAUDE_MEDIA_BLOCK_TYPES = new Set(["image", "document", "audio", "video"]);

export function isClaudeMediaBlock(block) {
  return !!block && CLAUDE_MEDIA_BLOCK_TYPES.has(block.type) && !!block.source;
}

export function claudeMediaBlockToGeminiPart(block) {
  if (!isClaudeMediaBlock(block)) return null;
  const src = block.source;
  // Anthropic calls it media_type; accept mimeType too, which some clients send.
  const mimeType = src.media_type || src.mimeType || (block.type === "image" ? "image/png" : undefined);
  if (src.type === "base64" && src.data) {
    return { inlineData: { mime_type: mimeType || "application/octet-stream", data: src.data } };
  }
  if ((src.type === "url" || src.url) && src.url) {
    return { fileData: { fileUri: src.url, mimeType: mimeType || `${block.type}/*` } };
  }
  // A shape we do not recognise is better dropped than sent as junk, but the caller
  // logs nothing today, so returning null keeps the previous behaviour for those.
  return null;
}

export function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === "text").map(c => c.text).join("");
  }
  return "";
}

// Try parse JSON safely
export function tryParseJSON(str) {
  if (typeof str !== "string") return str;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// Generate request ID
export function generateRequestId() {
  return `agent-${crypto.randomUUID()}`;
}

// Generate session ID (binary-compatible format: UUID + timestamp)
export function generateSessionId() {
  return crypto.randomUUID() + Date.now().toString();
}

// Generate project ID
export function generateProjectId() {
  const adjectives = ["useful", "bright", "swift", "calm", "bold"];
  const nouns = ["fuze", "wave", "spark", "flow", "core"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
}

// Helper: Remove unsupported keywords recursively from object/array
// Also strips all vendor extension fields (x- prefixed) not supported by Gemini
function removeUnsupportedKeywords(obj, keywords) {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      removeUnsupportedKeywords(item, keywords);
    }
    return;
  }

  for (const key of Object.keys(obj)) {
    if (keywords.includes(key) || key.startsWith("x-")) {
      delete obj[key];
      continue;
    }

    const value = obj[key];
    if (value && typeof value === "object") {
      removeUnsupportedKeywords(value, keywords);
    }
  }
}

// Convert const to enum
function convertConstToEnum(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.const !== undefined && !obj.enum) {
    obj.enum = [obj.const];
    delete obj.const;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      convertConstToEnum(value);
    }
  }
}

// Convert enum values to strings (Gemini requires string enum values + explicit type:"string")
function convertEnumValuesToStrings(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.enum && Array.isArray(obj.enum)) {
    obj.enum = obj.enum.map(v => String(v));
    // Gemini API requires type:"string" when enum is present — without it returns 400
    if (!obj.type) {
      obj.type = "string";
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      convertEnumValuesToStrings(value);
    }
  }
}

// Merge allOf schemas
function mergeAllOf(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.allOf && Array.isArray(obj.allOf)) {
    const merged = {};

    for (const item of obj.allOf) {
      if (item.properties) {
        if (!merged.properties) merged.properties = {};
        Object.assign(merged.properties, item.properties);
      }
      if (item.required && Array.isArray(item.required)) {
        if (!merged.required) merged.required = [];
        for (const req of item.required) {
          if (!merged.required.includes(req)) {
            merged.required.push(req);
          }
        }
      }
    }

    delete obj.allOf;
    if (merged.properties) obj.properties = { ...obj.properties, ...merged.properties };
    if (merged.required) obj.required = [...(obj.required || []), ...merged.required];
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      mergeAllOf(value);
    }
  }
}

// Select best schema from anyOf/oneOf
function selectBest(items) {
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let score = 0;
    const type = item.type;

    if (type === "object" || item.properties) {
      score = 3;
    } else if (type === "array" || item.items) {
      score = 2;
    } else if (type && type !== "null") {
      score = 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

// Flatten anyOf/oneOf
function flattenAnyOfOneOf(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.anyOf && Array.isArray(obj.anyOf) && obj.anyOf.length > 0) {
    const nonNullSchemas = obj.anyOf.filter(s => s && s.type !== "null");
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx];
      delete obj.anyOf;
      Object.assign(obj, selected);
    }
  }

  if (obj.oneOf && Array.isArray(obj.oneOf) && obj.oneOf.length > 0) {
    const nonNullSchemas = obj.oneOf.filter(s => s && s.type !== "null");
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx];
      delete obj.oneOf;
      Object.assign(obj, selected);
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      flattenAnyOfOneOf(value);
    }
  }
}

// Flatten type arrays
function flattenTypeArrays(obj) {
  if (!obj || typeof obj !== "object") return;

  if (obj.type && Array.isArray(obj.type)) {
    const nonNullTypes = obj.type.filter(t => t !== "null");
    obj.type = nonNullTypes.length > 0 ? nonNullTypes[0] : "string";
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      flattenTypeArrays(value);
    }
  }
}

// Infer missing type=object when properties exist (Gemini requires explicit type)
function ensureObjectType(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.properties && !obj.type) obj.type = "object";
  // 0.5.166 — a `properties` map is a map of schemas, not a schema node. An MCP
  // tool with a parameter literally named `properties` made the old blanket
  // recursion stamp `type: "object"` onto the map itself, which Gemini then read
  // as a second parameter named "type" and rejected with 400 (upstream 09f6d395).
  for (const [key, v] of Object.entries(obj)) {
    if (!v || typeof v !== "object") continue;
    if (key === "properties" && !Array.isArray(v)) {
      for (const sub of Object.values(v)) ensureObjectType(sub);
    } else {
      ensureObjectType(v);
    }
  }
}

// Convert prefixItems (tuple validation) to items -- Gemini cannot express tuples,
// and a type:"array" schema without items is rejected with "missing field"
function convertPrefixItems(obj) {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj.prefixItems) && obj.prefixItems.length > 0) {
    const variants = obj.prefixItems.filter(sub => sub && sub.type !== "null");
    if (!obj.items && variants.length === 1) {
      obj.items = variants[0];
    } else if (!obj.items && variants.length > 1) {
      obj.items = { anyOf: variants };
    }
    delete obj.prefixItems;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      convertPrefixItems(value);
    }
  }
}

// Gemini requires items on every type:"array" schema -- fill a permissive placeholder
function ensureArrayItems(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.type === "array" && !obj.items) {
    obj.items = { type: "string" };
  }
  for (const v of Object.values(obj)) if (v && typeof v === "object") ensureArrayItems(v);
}

// Clean JSON Schema for Antigravity API compatibility - removes unsupported keywords recursively
export function cleanJSONSchemaForAntigravity(schema) {
  if (!schema || typeof schema !== "object") return schema;

  // Mutate directly (schema is only used once per request)
  let cleaned = schema;

  // Phase 1: Convert and prepare
  convertConstToEnum(cleaned);
  convertEnumValuesToStrings(cleaned);

  // Phase 2: Flatten complex structures
  mergeAllOf(cleaned);
  convertPrefixItems(cleaned);
  flattenAnyOfOneOf(cleaned);
  flattenTypeArrays(cleaned);

  // Phase 2.5: Infer missing type=object when properties exist (Gemini requirement)
  ensureObjectType(cleaned);
  ensureArrayItems(cleaned);

  // Phase 3: Remove all unsupported keywords at ALL levels (including inside arrays)
  removeUnsupportedKeywords(cleaned, UNSUPPORTED_SCHEMA_CONSTRAINTS);

  // Phase 4: Cleanup required fields recursively
  function cleanupRequired(obj) {
    if (!obj || typeof obj !== "object") return;

    if (obj.required && Array.isArray(obj.required) && obj.properties) {
      const validRequired = obj.required.filter(field =>
        Object.prototype.hasOwnProperty.call(obj.properties, field)
      );
      if (validRequired.length === 0) {
        delete obj.required;
      } else {
        obj.required = validRequired;
      }
    }

    // Recurse into nested objects
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        cleanupRequired(value);
      }
    }
  }

  cleanupRequired(cleaned);

  // Phase 5: Add placeholder for empty object schemas (Antigravity requirement)
  function addPlaceholders(obj) {
    if (!obj || typeof obj !== "object") return;

    // 0.5.121 (upstream e3e3e235) — an empty schema {} (no type, no properties)
    // is what's left after $ref/$defs are stripped from a function declaration;
    // Vertex/Antigravity reject the orphan node. Promote it to object+placeholder.
    if (Object.keys(obj).length === 0) {
      obj.type = "object";
      obj.properties = {
        reason: {
          type: "string",
          description: "Brief explanation of why you are calling this tool"
        }
      };
      obj.required = ["reason"];
      return;
    }

    if (obj.type === "object") {
      if (!obj.properties || Object.keys(obj.properties).length === 0) {
        obj.properties = {
          reason: {
            type: "string",
            description: "Brief explanation of why you are calling this tool"
          }
        };
        obj.required = ["reason"];
      }
    }

    // Recurse into nested objects
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        addPlaceholders(value);
      }
    }
  }

  addPlaceholders(cleaned);

  return cleaned;
}

// 0.5.166 — Gemini / Cloud Code read a `$ref` key inside functionResponse.response
// as a pointer into functionResponse.parts and answer 400 INVALID_ARGUMENT
// ("The referenced name `#/$defs/...` ... does not match to a display_name in the
// function_response.parts"). Tool results that carry a JSON Schema or OpenAPI
// document (webfetch, read, MCP) hit this, so the key is renamed in place
// (upstream 625df74d).
export const GEMINI_RESERVED_RESPONSE_KEYS = { "$ref": "_ref" };

// Recursively rename reserved keys in a tool-result payload. Returns a new value;
// the caller's payload is never mutated.
export function sanitizeFunctionResponsePayload(value) {
  if (Array.isArray(value)) return value.map(sanitizeFunctionResponsePayload);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    // 0.5.166 — Object.hasOwn, not `MAP[key] ?? key`: a plain-object lookup reaches
    // Object.prototype, so tool output with a key named "constructor", "toString" or
    // "__proto__" had that key replaced by the stringified prototype member.
    // defineProperty, not assignment: a literal "__proto__" key would otherwise hit
    // the inherited setter and be dropped rather than passed through.
    const name = Object.hasOwn(GEMINI_RESERVED_RESPONSE_KEYS, key) ? GEMINI_RESERVED_RESPONSE_KEYS[key] : key;
    Object.defineProperty(out, name, {
      value: sanitizeFunctionResponsePayload(val),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

// Return the part with a sanitized functionResponse.response (same reference when untouched)
function sanitizeFunctionResponsePart(part) {
  const response = part?.functionResponse?.response;
  if (!response || typeof response !== "object") return part;
  return { ...part, functionResponse: { ...part.functionResponse, response: sanitizeFunctionResponsePayload(response) } };
}

// 0.5.166 — one normalizer for every Gemini-shaped `contents` array: the
// openai -> gemini translator, the Claude -> Antigravity envelope and the
// Antigravity executor (which creates adjacent same-role turns and empty parts
// when it strips thought blocks). Google answers 400 INVALID_ARGUMENT for
// adjacent same-role turns, an empty parts array, a history that does not open
// on a user turn, and a history that ends on a model turn or an unanswered
// functionCall (upstream 8d1db46b + e7b5f09d + 30464bc2 + 625df74d).
// Input is never mutated.
export function normalizeGeminiContents(contents) {
  const out = [];
  for (const c of contents || []) {
    if (!c?.role || !Array.isArray(c.parts)) continue;
    const parts = c.parts.filter(p => p && Object.keys(p).length > 0).map(sanitizeFunctionResponsePart);
    if (parts.length === 0) continue;
    const last = out.at(-1);
    if (last?.role === c.role) last.parts.push(...parts);
    else out.push({ ...c, parts: [...parts] });
  }
  if (out.length > 0 && out[0].role !== "user") {
    out.unshift({ role: "user", parts: [{ text: "..." }] });
  }
  if (out.length > 0 && out.at(-1).role === "model") {
    // An unanswered functionCall needs a functionResponse, not text — Gemini
    // rejects a call with no matching response.
    const fnCalls = out.at(-1).parts.filter(p => p?.functionCall);
    if (fnCalls.length > 0) {
      out.push({
        role: "user",
        parts: fnCalls.map(p => {
          const call = p.functionCall || {};
          const functionResponse = { name: call.name || "tool", response: { result: "Continue." } };
          if (call.id) functionResponse.id = call.id;
          return { functionResponse };
        })
      });
    } else {
      out.push({ role: "user", parts: [{ text: "Continue." }] });
    }
  }
  return out;
}

