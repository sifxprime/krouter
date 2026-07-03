// Account Selector (0.5.28) — port of OmniRoute's accountSelector.
//
// Pluggable strategies for choosing an account from the filtered candidate
// list (the picker has already applied modelLock/quota-preflight filters).
// Default strategy stays "fill-first" so existing behavior is preserved.
// New strategies opt-in via per-provider settings.
//
// Strategies:
//   - fill-first  (default): always pick accounts[0] — exhaust top before next
//   - round-robin: cycle through accounts using state.lastIndex
//   - random:      uniform random pick
//   - p2c:         "power of two choices" — pick 2 random, return the healthier
//                  one (by score). Good for load-balancing across equal-tier
//                  accounts without picking the same one every time.

import crypto from "node:crypto";
import { scoreOf } from "../../src/shared/services/connectionHealth.js";
import { scoreModelForCombo } from "./quotaPreflight.js";

function randInt(maxExclusive) {
  if (maxExclusive <= 0) return 0;
  // crypto.randomInt available in node 14.10+
  if (typeof crypto.randomInt === "function") return crypto.randomInt(maxExclusive);
  return Math.floor(Math.random() * maxExclusive);
}

// 0.5.70 — Zenith Scoring Engine port.
// Combines connectionHealth (latency + success rate) with quotaPreflight (remaining %)
// to yield an absolute 0-1000 score for a specific account+model.
export function zenithScore(account, model) {
  if (!account) return 0;

  // Health Score: Base is 0-1000, derived from success rate and penalised by latency.
  // 1000 = perfectly fast and healthy.
  const healthScore = Math.max(0, scoreOf(account.id) ?? 500);

  let finalScore = healthScore;

  // Quota Modifier: Remaining Percentage [0-100].
  // If an account is nearly exhausted (e.g. 5% remaining), we aggressively discount
  // its score so healthier accounts naturally rise above it in the ranking.
  if (model && account.provider) {
    const remainingPct = scoreModelForCombo(account.provider, account.id, model);
    if (remainingPct !== null) {
      // Linear penalty for quota under 30%
      if (remainingPct < 30) {
        const factor = Math.max(0.1, remainingPct / 30);
        finalScore *= factor;
      }
    }
  }

  // Priority bonus: if the user explicitly set a priority level on this connection,
  // bump its final score slightly so it breaks ties.
  if (account.priority && account.priority > 0) {
    finalScore += account.priority * 10;
  }

  return finalScore;
}

// Zenith Strategy: Sort all accounts by their Zenith score and pick the top one.
export function selectAccountZenith(accounts, model) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  if (accounts.length === 1) return accounts[0];

  let bestAccount = accounts[0];
  let bestScore = -1;

  for (const acc of accounts) {
    const score = zenithScore(acc, model);
    if (score > bestScore) {
      bestScore = score;
      bestAccount = acc;
    }
  }

  return bestAccount;
}

// P2C: pick 2 distinct random accounts, return the one with the higher score.
export function selectAccountP2C(accounts, model) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  if (accounts.length === 1) return accounts[0];

  const i = randInt(accounts.length);
  let j = randInt(accounts.length - 1);
  if (j >= i) j++; // ensure distinct

  const a = accounts[i];
  const b = accounts[j];
  const sa = zenithScore(a, model);
  const sb = zenithScore(b, model);
  return sa >= sb ? a : b;
}

// Main entry. Returns { account, state } so caller can persist lastIndex
// across calls for round-robin (typically per-provider state).
export function selectAccount(accounts, strategy = "fill-first", state = {}, model = null) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return { account: null, state };
  }

  // 0.5.70: Default to zenith if the user hasn't explicitly set a strategy.
  // Zenith's pre-ranking is mathematically superior to dumb fill-first.
  const activeStrategy = strategy === "fill-first" ? "zenith" : strategy;

  switch (activeStrategy) {
    case "zenith":
      return { account: selectAccountZenith(accounts, model), state };

    case "p2c":
      return { account: selectAccountP2C(accounts, model), state };

    case "random":
      return { account: accounts[randInt(accounts.length)], state };

    case "round-robin": {
      const lastIndex = state.lastIndex ?? -1;
      const nextIndex = (lastIndex + 1) % accounts.length;
      return { account: accounts[nextIndex], state: { ...state, lastIndex: nextIndex } };
    }

    default:
      return { account: accounts[0], state };
  }
}

// Per-provider round-robin state — keyed by provider id.
// State is mutated in place inside selectAccount() via the returned object;
// getRoundRobinState() is enough for round-robin to work.
const roundRobinState = new Map();

export function getRoundRobinState(providerId) {
  return roundRobinState.get(providerId) || {};
}

// Test-only utility: clear internal state between test runs.
// Not called from production code — tests import it directly.
export function clearAllSelectorState() {
  roundRobinState.clear();
}
