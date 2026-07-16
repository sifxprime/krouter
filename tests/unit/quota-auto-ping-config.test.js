import { describe, it, expect } from "vitest";
import { CLAUDE_AUTOPING_CONFIG, CODEX_AUTOPING_CONFIG } from "@/shared/constants/config";

// 0.5.105 — Codex auto-ping generalizes the Claude-only scheduler. These lock
// the two provider configs so the shared scheduler routes each provider to its
// own settings key + reset window without cross-contamination.
describe("auto-ping provider configs", () => {
  it("Claude and Codex use DISTINCT settings keys", () => {
    expect(CLAUDE_AUTOPING_CONFIG.settingsKey).toBe("claudeAutoPing");
    expect(CODEX_AUTOPING_CONFIG.settingsKey).toBe("codexAutoPing");
    expect(CLAUDE_AUTOPING_CONFIG.settingsKey).not.toBe(CODEX_AUTOPING_CONFIG.settingsKey);
  });

  it("each config targets its provider's 5h-window quota key", () => {
    // Claude's OAuth usage keys the session window "session (5h)"; Codex "session".
    expect(CLAUDE_AUTOPING_CONFIG.fiveHourKey).toBe("session (5h)");
    expect(CODEX_AUTOPING_CONFIG.fiveHourKey).toBe("session");
  });

  it("both configs share the 60s tick + sane ping bounds", () => {
    for (const cfg of [CLAUDE_AUTOPING_CONFIG, CODEX_AUTOPING_CONFIG]) {
      expect(cfg.tickIntervalMs).toBe(60000);
      expect(cfg.pingMaxTokens).toBeGreaterThan(0);
      expect(cfg.pingText).toBeTruthy();
      expect(cfg.pingModel).toBeTruthy();
      expect(cfg.pingLeadMs).toBeGreaterThan(0);
    }
  });

  it("Codex pings a cheap gpt-5 model, Claude a cheap haiku", () => {
    expect(CODEX_AUTOPING_CONFIG.pingModel).toMatch(/gpt-5/);
    expect(CLAUDE_AUTOPING_CONFIG.pingModel).toMatch(/haiku/);
  });
});
