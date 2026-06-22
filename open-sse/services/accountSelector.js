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
import { scoreOf } from "@/shared/services/connectionHealth";

function randInt(maxExclusive) {
  if (maxExclusive <= 0) return 0;
  // crypto.randomInt available in node 14.10+
  if (typeof crypto.randomInt === "function") return crypto.randomInt(maxExclusive);
  return Math.floor(Math.random() * maxExclusive);
}

// P2C: pick 2 distinct random accounts, return the one with the higher score.
export function selectAccountP2C(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  if (accounts.length === 1) return accounts[0];

  const i = randInt(accounts.length);
  let j = randInt(accounts.length - 1);
  if (j >= i) j++; // ensure distinct

  const a = accounts[i];
  const b = accounts[j];
  const sa = scoreOf(a) ?? 0;
  const sb = scoreOf(b) ?? 0;
  return sa >= sb ? a : b;
}

// Main entry. Returns { account, state } so caller can persist lastIndex
// across calls for round-robin (typically per-provider state).
export function selectAccount(accounts, strategy = "fill-first", state = {}) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return { account: null, state };
  }

  switch (strategy) {
    case "p2c":
      return { account: selectAccountP2C(accounts), state };

    case "random":
      return { account: accounts[randInt(accounts.length)], state };

    case "round-robin": {
      const lastIndex = state.lastIndex ?? -1;
      const nextIndex = (lastIndex + 1) % accounts.length;
      return { account: accounts[nextIndex], state: { ...state, lastIndex: nextIndex } };
    }

    case "fill-first":
    default:
      return { account: accounts[0], state };
  }
}

// Per-provider round-robin state — keyed by provider id.
// Caller is responsible for selecting the right strategy; this just holds state.
const roundRobinState = new Map();

export function getRoundRobinState(providerId) {
  return roundRobinState.get(providerId) || {};
}

export function setRoundRobinState(providerId, state) {
  roundRobinState.set(providerId, state);
}

export function clearAllSelectorState() {
  roundRobinState.clear();
}
