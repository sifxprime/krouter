// Resolve a model id a MITM-intercepted IDE asked for into the kRouter model the user
// mapped it to. Returning null means "no mapping" — and on an intercepted vendor host
// that means PASSTHROUGH to the real vendor, so a miss here is not a safe default: the
// request leaves the machine and bills the user's own vendor account.
//
// Lives in its own module so tests exercise this exact function. It used to sit inside
// server.js, which starts a TLS server on require and therefore cannot be imported, so
// every test of the mapping had to re-implement it and could pass while this drifted.

const { MODEL_SYNONYMS, MODEL_PATTERNS } = require("./config");
const { getMitmAlias } = require("./dbReader");

function getMappedModel(tool, model) {
  if (!model) return null;
  try {
    const aliases = getMitmAlias(tool);
    if (!aliases) return null;
    // Normalize via synonym map (e.g., public AG names -> backend model ids)
    const normalizedModel = String(model).replace(/^models\//, "");
    const lookup = MODEL_SYNONYMS?.[tool]?.[normalizedModel] || normalizedModel;
    if (aliases[lookup]) return aliases[lookup];

    // 0.5.169 — three tiers, because two were not enough. Order is:
    //   exact key -> specific patterns -> longest-key prefix -> catch-all patterns
    //
    // SPECIFIC PATTERNS BEFORE PREFIX. MODEL_PATTERNS is a hand-ordered ladder; the prefix
    // match is incidental string overlap. Running the accident first made the ladder
    // unreachable for the very ids it exists for:
    //   aliases { claude-opus-5-5, claude-opus-5-5-low }, model "claude-opus-5-5-extra-low"
    //   -> prefix hit "claude-opus-5-5" and returned the BARE slot, so the -low rule in
    //      config.js never ran. Longest-key-wins cannot fix this: "claude-opus-5-5-low" is
    //      not a prefix of "claude-opus-5-5-extra-low", so it is not even a candidate.
    //
    // PREFIX BEFORE CATCH-ALLS. A rule like /opus/i is a last resort, not a claim about a
    // family. Let it run first and a dated id loses its own slot:
    //   model "claude-opus-5-20261001" over { claude-opus-5, claude-opus-5-5 }
    //   -> /opus/i returned the Opus 5.5 target, while the prefix "claude-opus-5" was right
    //      there. Entries tagged `fallback: true` therefore run only after the prefix step.
    const patterns = MODEL_PATTERNS?.[tool] || [];
    for (const { match, alias, fallback } of patterns) {
      if (!fallback && match.test(lookup) && aliases[alias]) return aliases[alias];
    }

    // LONGEST KEY WINS. Object.keys() is insertion order, which for this map is the order
    // the user saved rows in the UI, so .find() made the answer depend on click history:
    //   model "claude-opus-5-5-20261122" over { claude-opus-5, claude-opus-5-5 }
    //   -> "claude-opus-5" saved first returned the Opus 5 target
    //   -> "claude-opus-5-5" saved first returned the Opus 5.5 target
    // Same config, two answers. Most specific key wins, and ties break on name so the
    // result is reproducible. This matters from 0.5.169 on, where the Claude Desktop slot
    // list gains the colliding claude-opus-5 / claude-opus-5-5 pair.
    const prefixKey = Object.keys(aliases)
      .filter(k => k && aliases[k] && (lookup.startsWith(k) || k.startsWith(lookup)))
      .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))[0];
    if (prefixKey) return aliases[prefixKey];

    // Catch-alls last: nothing more precise matched, so a family-wide guess beats
    // returning null, which on an intercepted vendor host means passthrough.
    for (const { match, alias, fallback } of patterns) {
      if (fallback && match.test(lookup) && aliases[alias]) return aliases[alias];
    }
    return null;
  } catch { return null; }
}

module.exports = { getMappedModel };
