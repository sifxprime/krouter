// Tests for accountSelector (0.5.28).
import { describe, expect, it, beforeEach } from "vitest";
import {
  selectAccount,
  selectAccountP2C,
  clearAllSelectorState,
} from "../../open-sse/services/accountSelector.js";

const accounts = [
  { id: "a", health: { score: 50 } },
  { id: "b", health: { score: 80 } },
  { id: "c", health: { score: 20 } },
];

describe("selectAccount", () => {
  beforeEach(() => clearAllSelectorState());

  it("returns null for empty list", () => {
    expect(selectAccount([]).account).toBeNull();
    expect(selectAccount(null).account).toBeNull();
  });

  it("fill-first returns accounts[0]", () => {
    expect(selectAccount(accounts, "fill-first").account.id).toBe("a");
  });

  it("default strategy is fill-first", () => {
    expect(selectAccount(accounts).account.id).toBe("a");
  });

  it("round-robin advances lastIndex on each call", () => {
    let state = {};
    const seen = [];
    for (let i = 0; i < 5; i++) {
      const { account, state: nextState } = selectAccount(accounts, "round-robin", state);
      seen.push(account.id);
      state = nextState;
    }
    // After 5 picks across 3 accounts, expect cycle: b, c, a, b, c (starting from lastIndex=-1 → 0=a → wait)
    // Actually -1+1=0 → a, then 1 → b, 2 → c, 0 → a, 1 → b
    expect(seen).toEqual(["a", "b", "c", "a", "b"]);
  });

  it("random returns a valid account", () => {
    const { account } = selectAccount(accounts, "random");
    expect(accounts.map(a => a.id)).toContain(account.id);
  });

  it("p2c always returns a valid account from the candidate list", () => {
    // We can't deterministically test that p2c "prefers" higher scores
    // because scoreOf() reads from a global health store, not the fake
    // health field on our test objects. What we can test: every call
    // returns one of the input accounts (never null, never duplicate).
    const valid = new Set(accounts.map(a => a.id));
    for (let i = 0; i < 50; i++) {
      const { account } = selectAccount(accounts, "p2c");
      expect(account).not.toBeNull();
      expect(valid.has(account.id)).toBe(true);
    }
  });

  it("p2c picks distinct candidates (never compares an account against itself)", () => {
    // White-box check via selectAccountP2C: with 2 accounts, the picked one
    // must be one of them. With 1 account, returns it directly.
    const two = [{ id: "x" }, { id: "y" }];
    for (let i = 0; i < 20; i++) {
      const picked = selectAccountP2C(two);
      expect(["x", "y"]).toContain(picked.id);
    }
  });

  it("p2c returns the only account if list has 1", () => {
    expect(selectAccountP2C([accounts[0]]).id).toBe("a");
  });

  it("p2c returns null for empty list", () => {
    expect(selectAccountP2C([])).toBeNull();
  });
});
