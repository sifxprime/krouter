// complexityRouter (0.5.29) — simplified port of OmniRoute's complexityRouter.
//
// OmniRoute's version depends on a 1000+ line specificityDetector engine. For
// our use case we just need a fast heuristic that says "this looks trivial /
// moderate / hard" so the dashboard can suggest a model tier. Hot-path safe,
// no I/O, ~1ms per call.

// "free" / "cheap" / "premium" tier targets.
// Anything tool-using auto-floors at "cheap" because free-tier models often
// have weak function-calling reliability.

const TIER_ORDER = ["free", "cheap", "premium"];

function escalateTier(tier, floor) {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(floor) ? tier : floor;
}

// Count chars across user-role messages. Cheap and good enough for triage.
function countUserChars(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) {
    if (m?.role !== "user") continue;
    const c = m.content;
    if (typeof c === "string") {
      total += c.length;
    } else if (Array.isArray(c)) {
      for (const part of c) {
        if (typeof part?.text === "string") total += part.text.length;
        else if (typeof part?.content === "string") total += part.content.length;
      }
    }
  }
  return total;
}

// Count fenced code blocks across user messages. More blocks = harder request.
function countCodeBlocks(messages) {
  if (!Array.isArray(messages)) return 0;
  let n = 0;
  for (const m of messages) {
    const c = m?.content;
    if (typeof c !== "string") continue;
    const matches = c.match(/```/g);
    if (matches) n += Math.floor(matches.length / 2);
  }
  return n;
}

// Score 0..100 — higher = more complex.
function computeScore({ chars, codeBlocks, toolCount, msgCount }) {
  let score = 0;
  // length contribution: 0 chars → 0, 10000+ → 50
  score += Math.min(50, chars / 200);
  // code blocks contribution: 5 blocks → 25
  score += Math.min(25, codeBlocks * 5);
  // tools contribution: 10 tools → 15
  score += Math.min(15, toolCount * 1.5);
  // conversation length: 20+ messages → 10
  score += Math.min(10, msgCount * 0.5);
  return Math.round(Math.min(100, score));
}

function levelFromScore(score) {
  if (score < 15) return "trivial";
  if (score < 35) return "simple";
  if (score < 60) return "moderate";
  if (score < 80) return "complex";
  return "expert";
}

function tierFromLevel(level) {
  switch (level) {
    case "trivial": return "free";
    case "simple":  return "free";
    case "moderate": return "cheap";
    case "complex": return "cheap";
    case "expert":  return "premium";
    default:        return "cheap";
  }
}

// Pure classifier — safe on the hot path.
export function classifyRequestComplexity(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const chars = countUserChars(messages);
  const codeBlocks = countCodeBlocks(messages);
  const toolCount = tools.length;
  const msgCount = messages.length;
  const score = computeScore({ chars, codeBlocks, toolCount, msgCount });
  const level = levelFromScore(score);
  let recommendedTier = tierFromLevel(level);
  const hasToolUse = toolCount > 0;
  if (hasToolUse) recommendedTier = escalateTier(recommendedTier, "cheap");
  return {
    score,
    level,
    recommendedTier,
    hasToolUse,
    signals: {
      userChars: chars,
      codeBlocks,
      toolCount,
      msgCount,
    },
  };
}

// Public escalateTier helper for callers that want to compose
export { escalateTier };
export const _TIER_ORDER = TIER_ORDER;
