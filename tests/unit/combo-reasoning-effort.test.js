import { describe, it, expect, beforeEach } from "vitest";

import {
  normalizeComboEntry,
  normalizeComboEntries,
  getComboEntryModel,
  getComboEntryReasoning,
  applyComboEntryReasoning,
  handleComboChat,
  handleFusionChat,
  resetComboRotation,
} from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, error: () => {} };
const ok = (obj) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
const fail = (status, message) =>
  new Response(JSON.stringify({ error: { message } }), { status, headers: { "Content-Type": "application/json" } });

describe("combo per-entry reasoning effort", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("keeps legacy string entries untouched", () => {
    expect(normalizeComboEntry("  openai/gpt-4o  ")).toBe("openai/gpt-4o");
    expect(normalizeComboEntries(["a/m1", "a/m2"])).toEqual(["a/m1", "a/m2"]);
    expect(getComboEntryModel("a/m1")).toBe("a/m1");
    expect(getComboEntryReasoning("a/m1")).toBeNull();
  });

  it("normalizes { model, reasoning } and accepts reasoning_effort alias", () => {
    expect(normalizeComboEntry({ model: "a/m1", reasoning: "high" })).toEqual({ model: "a/m1", reasoning: "high" });
    expect(normalizeComboEntry({ model: "a/m1", reasoning_effort: "LOW" })).toEqual({ model: "a/m1", reasoning: "low" });
    expect(normalizeComboEntry({ model: "a/m1", reasoning: "auto" })).toBe("a/m1");
    expect(normalizeComboEntry({ model: "a/m1", reasoning: "bogus" })).toBeNull();
    expect(normalizeComboEntry({ model: "  " })).toBeNull();
  });

  it("applyComboEntryReasoning overrides client effort per attempt", () => {
    const base = { model: "combo", reasoning_effort: "low" };
    const out = applyComboEntryReasoning(base, { model: "a/m1", reasoning: "high" });
    expect(out.reasoning_effort).toBe("high");
    expect(base.reasoning_effort).toBe("low");
  });

  it("auto entries return the original body untouched", () => {
    const base = { model: "combo", reasoning_effort: "low" };
    expect(applyComboEntryReasoning(base, "a/m1")).toBe(base);
    expect(applyComboEntryReasoning(base, { model: "a/m1", reasoning: "auto" })).toEqual(base);
  });

  it("none strips reasoning fields", () => {
    const base = {
      model: "combo",
      reasoning_effort: "high",
      reasoning: { effort: "high" },
      thinking: { type: "enabled", budget_tokens: 16384 },
    };
    const out = applyComboEntryReasoning(base, { model: "a/m1", reasoning: "none" });
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toBeUndefined();
    expect(out.thinking).toBeUndefined();
  });

  it("fallback applies each entry effort only on its own attempt", async () => {
    const seen = [];
    const handleSingleModel = async (b, m) => {
      seen.push({ model: m, effort: b.reasoning_effort });
      if (m === "a/m1") return fail(500, "boom");
      return ok({ choices: [{ message: { content: "fine" } }] });
    };
    const res = await handleComboChat({
      body: { model: "combo", messages: [] },
      models: [
        { model: "a/m1", reasoning: "high" },
        { model: "a/m2", reasoning: "low" },
      ],
      handleSingleModel,
      log,
      comboName: "test-combo-effort",
      comboStrategy: "fallback",
      autoSwitch: false,
    });
    expect(res.ok).toBe(true);
    expect(seen).toEqual([
      { model: "a/m1", effort: "high" },
      { model: "a/m2", effort: "low" },
    ]);
  });

  it("fusion fans out panel efforts and judge inherits first entry", async () => {
    const calls = [];
    const handleSingleModel = async (b, m) => {
      calls.push({ model: m, effort: b.reasoning_effort, stream: b.stream });
      if (calls.length <= 2) {
        return ok({ choices: [{ message: { content: `answer from ${m}` } }] });
      }
      return ok({ choices: [{ message: { content: "final" } }] });
    };
    const res = await handleFusionChat({
      body: { model: "combo", messages: [{ role: "user", content: "hi" }] },
      models: [
        { model: "a/m1", reasoning: "high" },
        { model: "a/m2", reasoning: "low" },
      ],
      handleSingleModel,
      log,
      comboName: "test-fusion-effort",
    });
    expect(res.ok).toBe(true);
    expect(calls[0]).toMatchObject({ model: "a/m1", effort: "high", stream: false });
    expect(calls[1]).toMatchObject({ model: "a/m2", effort: "low", stream: false });
    expect(calls[2].model).toBe("a/m1");
    expect(calls[2].effort).toBe("high");
  });
});
