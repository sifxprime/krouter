/**
 * The Claude Desktop MITM tool must offer the models Anthropic currently ships.
 *
 * MITM_TOOLS.claude.defaultModels are the slots shown on the MITM page: each one is a
 * model id Claude Desktop may ask for, which the user then maps to a kRouter model.
 * A slot that does not exist cannot be mapped, so when Anthropic ships a new flagship
 * and the list is not updated, the app's current models silently fall through to
 * passthrough - they reach Anthropic directly instead of the provider you mapped.
 *
 * That is what happened in 0.5.166: the Antigravity tool's list was moved to the 5.5
 * family and Claude Desktop's was left at 4.7 and below.
 *
 * Old ids are deliberately KEPT - a user may have a saved mapping against one, and an
 * older Desktop build in the field still sends them.
 */
import { describe, it, expect } from "vitest";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

const claude = MITM_TOOLS.claude;
const slots = claude.defaultModels.map((m) => m.id);
// The ids the catalog serves for the Claude Code provider, newest first.
const catalog = (PROVIDER_MODELS.cc || []).map((m) => m.id);

describe("the Claude Desktop MITM tool is wired", () => {
  it("intercepts the Anthropic API host", () => {
    expect(claude.configType).toBe("mitm");
    expect(claude.mitmDomain).toBe("api.anthropic.com");
  });

  it("every slot has a stable id and alias", () => {
    for (const m of claude.defaultModels) {
      expect(typeof m.id).toBe("string");
      expect(m.alias).toBe(m.id);
      expect(typeof m.name).toBe("string");
    }
    expect(new Set(slots).size).toBe(slots.length);
  });
});

describe("the slot list keeps up with the catalog", () => {
  // The families a current Claude Desktop build can ask for. If the catalog gains a
  // newer flagship, add a slot for it here and in MITM_TOOLS.claude.
  const CURRENT = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"];

  it.each(CURRENT)("offers a slot for %s", (id) => {
    expect(catalog).toContain(id);
    expect(slots).toContain(id);
  });

  it("still offers the older ids, so saved mappings survive", () => {
    for (const old of ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"]) {
      expect(slots).toContain(old);
    }
  });

  it("offers no model the catalog cannot route to", () => {
    // A slot may use the undated spelling of a dated catalog id (haiku), so compare on prefix.
    const servable = (id) => catalog.some((c) => c === id || c.startsWith(`${id}-20`));
    expect(slots.filter((s) => !servable(s))).toEqual([]);
  });
});
