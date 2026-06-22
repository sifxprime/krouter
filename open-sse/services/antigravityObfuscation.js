// antigravityObfuscation (0.5.29) — port of OmniRoute's antigravityObfuscation.
//
// Obfuscates client tool names (OpenCode, Cursor, Claude Code, etc.) in
// the request body using zero-width joiners so Google's backend can't
// grep for them in request logs to flag third-party clients.
//
// Pure function — accepts a string body, returns string with sensitive
// words split by a U+200D ZWJ. Visually identical, byte-different.

const ZWJ = "‍";

const DEFAULT_SENSITIVE_WORDS = [
  "opencode",
  "open-code",
  "cline",
  "roo-cline",
  "roo_cline",
  "cursor",
  "windsurf",
  "aider",
  "continue.dev",
  "copilot",
  "avante",
  "codecompanion",
  "claude code",
  "claude-code",
  "kilo code",
  "kilocode",
  "kodelyth",
  "krouter",
  "omniroute",
];

let configuredWords = [...DEFAULT_SENSITIVE_WORDS];

export function setAntigravitySensitiveWords(words) {
  configuredWords = Array.isArray(words) && words.length > 0
    ? words.filter(w => typeof w === "string" && w.length > 0)
    : [...DEFAULT_SENSITIVE_WORDS];
}

export function getAntigravitySensitiveWords() {
  return [...configuredWords];
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const _regexCache = new Map();
function getObfuscationRegex(word) {
  let regex = _regexCache.get(word);
  if (!regex) {
    if (_regexCache.size > 2000) _regexCache.clear();
    regex = new RegExp(escapeRegex(word), "gi");
    _regexCache.set(word, regex);
  }
  return regex;
}

// Inject a ZWJ after the first character of every sensitive word in `text`.
// "opencode" → "o<ZWJ>pencode". Visually identical, breaks grep / regex
// fingerprinting on Google's side.
export function obfuscateSensitiveWords(text) {
  if (typeof text !== "string" || !text || configuredWords.length === 0) return text;
  let result = text;
  for (const word of configuredWords) {
    if (!word) continue;
    const regex = getObfuscationRegex(word);
    result = result.replace(regex, (m) => (m.length <= 1 ? m : m[0] + ZWJ + m.slice(1)));
  }
  return result;
}

// Convenience: walk an arbitrary body shape and obfuscate every string
// field (depth-limited so we don't blow the stack on circular bodies).
// Returns a new object — never mutates input.
export function obfuscateBodyStrings(body, maxDepth = 8) {
  if (maxDepth <= 0) return body;
  if (typeof body === "string") return obfuscateSensitiveWords(body);
  if (Array.isArray(body)) {
    return body.map(v => obfuscateBodyStrings(v, maxDepth - 1));
  }
  if (body && typeof body === "object") {
    const out = {};
    for (const [k, v] of Object.entries(body)) {
      out[k] = obfuscateBodyStrings(v, maxDepth - 1);
    }
    return out;
  }
  return body;
}
