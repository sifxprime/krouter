/**
 * 0.5.169 — src/mitm/modelMap.js getMappedModel, the real function.
 *
 * This is the single decision that makes MITM work or silently not work. A null return
 * means "no mapping", and on an intercepted vendor host no mapping means PASSTHROUGH to
 * the real vendor. So a miss is not a safe default: the request leaves the machine and
 * bills the user's own vendor account while the dashboard still shows MITM as on.
 *
 * Three defects are pinned here, all confirmed against the shipped resolver on a live
 * install before the fix:
 *
 * 1. NO CLAUDE LADDER. MODEL_PATTERNS had an `antigravity` key and nothing for `claude`,
 *    so any Desktop model id outside the alias map fell through to Anthropic. Measured
 *    with MITM on and api.anthropic.com redirected to kRouter:
 *      claude-opus-4-7   -> routed, served as cc/claude-opus-5
 *      claude-opus-5-5   -> 401 "invalid x-api-key" FROM ANTHROPIC (req_011CgvsLCqYZ...)
 *
 * 2. PREFIX BEAT PATTERNS. The prefix step is incidental string overlap; MODEL_PATTERNS
 *    is a hand-ordered ladder. Running the accident first made the ladder unreachable:
 *      aliases { claude-opus-5-5, claude-opus-5-5-low }, model claude-opus-5-5-extra-low
 *      -> returned the BARE slot, never the -low tier the pattern exists to catch.
 *
 * 3. KEY ORDER DECIDED THE ANSWER. Object.keys() is insertion order, which for this map
 *    is the order rows were saved in the UI:
 *      model claude-opus-5-5-20261122 over { claude-opus-5, claude-opus-5-5 }
 *      -> Opus 5 target or Opus 5.5 target depending purely on which was saved first.
 *
 * The test drives the real module rather than a copy of it: getMappedModel used to live
 * inside server.js, which starts a TLS listener on require and so cannot be imported, so
 * every previous test of this logic re-implemented it and could pass while it drifted.
 * DATA_DIR is redirected to a temp dir and dbReader re-reads the file on every call, so
 * swapping the map between cases needs no module reset.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir, savedDataDir, getMappedModel;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-modelmap-"));
  fs.mkdirSync(path.join(tmpDir, "mitm"), { recursive: true });
  savedDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tmpDir; // read at paths.js load, so set before first import
  ({ getMappedModel } = await import("../../src/mitm/modelMap.js"));
});

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const setMap = (map) =>
  fs.writeFileSync(path.join(tmpDir, "mitm", "aliases.json"), JSON.stringify(map));

// What a real user has after mapping only the slots 0.5.168 offered.
const OLD_ONLY = {
  "claude-opus-4-7": "cc/claude-opus-5",
  "claude-opus-4-6": "cc/claude-opus-5",
  "claude-sonnet-4-6": "cc/claude-opus-5",
  "claude-sonnet-4-5": "cc/claude-opus-5",
  "claude-haiku-4-5": "cc/claude-opus-5",
};

beforeEach(() => setMap({ claude: OLD_ONLY }));

describe("the module is importable at all", () => {
  it("exports the real function, with no TLS listener started", () => {
    expect(typeof getMappedModel).toBe("function");
  });
});

describe("1. a current Claude id does not escape to Anthropic", () => {
  const CURRENT = [
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-1",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-opus-4-8",
  ];

  it.each(CURRENT)("%s maps instead of passing through", (id) => {
    expect(getMappedModel("claude", id)).not.toBeNull();
  });

  it("the ids that already worked are unchanged", () => {
    for (const id of Object.keys(OLD_ONLY)) {
      expect(getMappedModel("claude", id)).toBe("cc/claude-opus-5");
    }
  });

  it("prefers the newest slot the user actually mapped", () => {
    setMap({ claude: { ...OLD_ONLY, "claude-opus-5-5": "ag/claude-opus-5-5-high" } });
    expect(getMappedModel("claude", "claude-opus-5-5")).toBe("ag/claude-opus-5-5-high");
  });

  it("keeps haiku off the sonnet slot", () => {
    setMap({ claude: { ...OLD_ONLY, "claude-haiku-4-5": "kr/claude-haiku" } });
    expect(getMappedModel("claude", "claude-haiku-5-5")).toBe("kr/claude-haiku");
  });
});

describe("2. the ordered ladder outranks an incidental prefix", () => {
  it("a tier suffix reaches its tier rule, not the bare slot", () => {
    setMap({
      antigravity: {
        "claude-opus-5-5": "BARE",
        "claude-opus-5-5-low": "LOW_TIER",
      },
    });
    expect(getMappedModel("antigravity", "claude-opus-5-5-extra-low")).toBe("LOW_TIER");
  });

  it("an exact key still wins over everything", () => {
    setMap({ antigravity: { "claude-opus-5-5": "BARE", "claude-opus-5-5-low": "LOW_TIER" } });
    expect(getMappedModel("antigravity", "claude-opus-5-5")).toBe("BARE");
  });
});

describe("3. the answer does not depend on UI save order", () => {
  const FWD = { "claude-opus-5": "T_OPUS5", "claude-opus-5-5": "T_OPUS55" };
  const REV = { "claude-opus-5-5": "T_OPUS55", "claude-opus-5": "T_OPUS5" };

  it.each([
    ["claude-opus-5-5-20261122", "T_OPUS55"],
    ["claude-opus-5-20261001", "T_OPUS5"],
  ])("%s resolves to %s in either insertion order", (model, expected) => {
    setMap({ claude: FWD });
    const fwd = getMappedModel("claude", model);
    setMap({ claude: REV });
    const rev = getMappedModel("claude", model);
    expect(fwd).toBe(rev);
    expect(fwd).toBe(expected);
  });

  it("the longest matching key wins, not the first saved", () => {
    setMap({ claude: { "claude-opus": "SHORT", "claude-opus-5-5-thinking": "LONGEST" } });
    expect(getMappedModel("claude", "claude-opus-5-5-thinking-20261122")).toBe("LONGEST");
  });
});

describe("it leaves alone what it should", () => {
  it.each(["gpt-5", "gemini-3.8-flash", "glm-5.1"])("%s is not a Claude model", (id) => {
    expect(getMappedModel("claude", id)).toBeNull();
  });

  it("an empty model id is rejected before the prefix step matches everything", () => {
    // k.startsWith("") is true of EVERY key, so the `if (!model) return null` guard is
    // what stops an empty id resolving to an arbitrary slot.
    expect(getMappedModel("claude", "")).toBeNull();
    expect(getMappedModel("claude", null)).toBeNull();
  });

  it("an unknown tool has no map and maps nothing", () => {
    expect(getMappedModel("nosuchtool", "claude-opus-5-5")).toBeNull();
  });

  it("strips a models/ prefix before matching", () => {
    expect(getMappedModel("claude", "models/claude-opus-4-7")).toBe("cc/claude-opus-5");
  });
});
