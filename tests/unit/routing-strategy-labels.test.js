import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { selectAccount, zenithScore } from "../../open-sse/services/accountSelector.js";
import {
  PROVIDER_DEFAULT_STRATEGY,
  getEffectiveFallbackStrategy,
} from "../../open-sse/config/providerStrategy.js";
import { recordOutcome, scoreOf } from "../../src/shared/services/connectionHealth.js";
import { _setQuotaCacheEntry, clearQuotaCache } from "../../open-sse/services/quotaPreflight.js";
import { detectRequiredCapabilities } from "../../open-sse/services/combo.js";

/**
 * The Settings page called the default strategy "Fill First" and said it used
 * "accounts in priority order". The stored default is still the string
 * "fill-first", but selectAccount() swaps it for Zenith scoring (0.5.70), so
 * the label described a strategy that never runs. The help text also missed
 * two things the router does: round-robin drops conversation stickiness
 * (0.5.93) and Antigravity round-robins by default (0.5.119).
 */
const read = (p) => readFileSync(p, "utf8");

function routingSection() {
  const src = read("src/app/(dashboard)/dashboard/profile/page.js");
  const start = src.indexOf("Routing Strategy</h3>");
  const end = src.indexOf("Task-Aware Routing", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// auth.js passes the requested model, and its DB rows carry provider and
// priority (1 = top of the dashboard list). Call selectAccount the same way so
// these guards check the path production runs.
const conn = (id, priority) => ({ id, provider: "rs-label-prov", priority });
const MODEL = "rs-label-model";

describe("the default routing strategy is labelled as what it runs", () => {
  afterEach(() => clearQuotaCache());

  it("auth.js calls selectAccount with the model, as these guards do", () => {
    expect(read("src/sse/services/auth.js")).toContain(
      "selectAccount(availableConnections, strategy, getRoundRobinState(providerId), model)"
    );
  });

  it("the stored default 'fill-first' runs Zenith scoring, not list order", () => {
    expect(getEffectiveFallbackStrategy({}, "openai")).toBe("fill-first");
    for (let i = 0; i < 10; i++) recordOutcome("rs-label-failing", false, 0);
    recordOutcome("rs-label-healthy", true, 200);
    const accounts = [conn("rs-label-failing", 1), conn("rs-label-healthy", 2)];
    // The first account in the list loses to the healthier one.
    expect(selectAccount(accounts, "fill-first", {}, MODEL).account.id).toBe("rs-label-healthy");
  });

  it("the Zenith score also counts tracked quota and the account's place in the list", () => {
    // Never-used ids share the same neutral health, so only quota or priority can differ.
    _setQuotaCacheEntry("rs-label-prov", "rs-q-high", { [MODEL]: { remainingPercentage: 90 } });
    _setQuotaCacheEntry("rs-label-prov", "rs-q-low", { [MODEL]: { remainingPercentage: 5 } });
    expect(zenithScore(conn("rs-q-low", 1), MODEL)).toBeLessThan(zenithScore(conn("rs-q-high", 1), MODEL));

    _setQuotaCacheEntry("rs-label-prov", "rs-p-1", { [MODEL]: { remainingPercentage: 90 } });
    _setQuotaCacheEntry("rs-label-prov", "rs-p-2", { [MODEL]: { remainingPercentage: 90 } });
    expect(zenithScore(conn("rs-p-1", 1), MODEL)).not.toBe(zenithScore(conn("rs-p-2", 2), MODEL));

    expect(routingSection()).toContain(
      "Zenith scores each account on recent success rate, latency, tracked quota left and its place in the list"
    );
  });

  it("does not promise the healthiest account while a healthier one can lose", () => {
    // Review probe: with no quota data scoreModelForCombo returns 0, so Zenith
    // scales health by 0.1 and the priority bonus decides the pick.
    recordOutcome("rs-probe-a", true, 1000);
    recordOutcome("rs-probe-b", false, 0);
    const list = [conn("rs-probe-a", 1), conn("rs-probe-c", 2), conn("rs-probe-b", 3)];
    const healthiest = list.reduce((best, c) => (scoreOf(c.id) > scoreOf(best.id) ? c : best)).id;
    const picked = selectAccount(list, "fill-first", {}, MODEL).account.id;
    const promisesHealth = /healthie(st|r)/i.test(routingSection());
    // The text may promise health only once the engine picks the healthiest account.
    expect(picked === healthiest || !promisesHealth).toBe(true);
  });

  it("labels the default option Zenith, not Fill First", () => {
    const s = routingSection();
    expect(s).toContain('{ value: "fill-first", label: "Zenith (default)" }');
    expect(s).not.toMatch(/Fill First/);
  });

  it("does not claim the default uses accounts in priority order", () => {
    expect(routingSection()).not.toMatch(/priority order/i);
  });

  it("keeps the stored value, so routing behaviour does not change", () => {
    const s = routingSection();
    expect(s).toContain('value={settings.fallbackStrategy || "fill-first"}');
  });
});

describe("the help text matches how each strategy treats a conversation", () => {
  it("round robin says conversations are not pinned (0.5.93)", () => {
    const chat = read("src/sse/handlers/chat.js");
    expect(chat).toContain("!userWantsRoundRobin && conversationFingerprint");
    expect(routingSection()).toContain("Conversations are not pinned to one account.");
  });

  it("the other strategies say a conversation keeps its account", () => {
    expect(routingSection()).toContain("A conversation keeps the account that answered it");
  });
});

describe("the help text says Antigravity round-robins by default", () => {
  it("Antigravity ignores the global choice unless it has its own override", () => {
    expect(PROVIDER_DEFAULT_STRATEGY.antigravity).toBe("round-robin");
    expect(getEffectiveFallbackStrategy({ fallbackStrategy: "p2c" }, "antigravity")).toBe("round-robin");
    expect(routingSection()).toContain("Antigravity uses Round Robin by default");
  });
});

describe("the combo help text does not promise a fixed first model", () => {
  it("combos can move a model forward for an attachment or for quota", () => {
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] }] };
    expect(detectRequiredCapabilities(body).has("vision")).toBe(true);
    const s = routingSection();
    expect(s).not.toMatch(/always start with their first model/);
    expect(s).not.toMatch(/always starting with first/);
  });

  it("the quota and attachment exception is shown with Combo Round Robin on as well", () => {
    // handleComboChat reorders after getRotatedModels, whatever the combo strategy.
    const combo = read("open-sse/services/combo.js");
    expect(combo).toMatch(/getRotatedModels\([\s\S]*reorderByCapabilities\([\s\S]*reorderByQuota\(rotatedModels\)/);
    expect(routingSection()).toContain('{", unless another has more quota left or is needed for an attachment (image, PDF, audio, video)."}');
  });
});
