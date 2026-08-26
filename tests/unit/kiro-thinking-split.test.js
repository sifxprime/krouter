import { describe, it, expect } from "vitest";

/**
 * Kiro enables thinking by prompt injection, so reasoning comes back as literal
 * <thinking> tags inside the assistant text. Those tags are NOT chunk-aligned:
 * a real stream opens with delta "<thinking" and closes the tag only in the next
 * delta. The old stripper ran indexOf("<thinking>") against one chunk at a time,
 * matched neither half, and leaked the whole reasoning block into visible content.
 *
 * These drive the shipped splitter directly, so no live Kiro connection is needed.
 */
import { createThinkingSplitter } from "../../open-sse/executors/kiroThinking.js";

/** Feed chunks through the real splitter and return the accumulated output. */
function run(chunks) {
  const s = createThinkingSplitter();
  let text = "", reasoning = "";
  for (const c of chunks) {
    const r = s.split(c);
    text += r.text;
    reasoning += r.reasoning;
  }
  const held = s.flush();
  return { text: text + held.text, reasoning: reasoning + held.reasoning };
}

describe("kiro <thinking> extraction", () => {
  it("handles the real wire split, where the opening tag straddles two deltas", () => {
    // Captured verbatim from kr/claude-sonnet-4.5-thinking.
    const { text, reasoning } = run([
      "<thinking", ">\nThe user is asking me to", " reply with exactly",
      " the word \"PONG\".", "\n</thinking>", "\n\nPONG",
    ]);
    expect(text).toBe("PONG");
    expect(text).not.toContain("<thinking");
    expect(reasoning).toContain("The user is asking me to reply with exactly");
  });

  it("handles a closing tag split across deltas", () => {
    const { text, reasoning } = run(["<thinking>", "abc", "</think", "ing>", "VISIBLE"]);
    expect(text).toBe("VISIBLE");
    expect(reasoning).toBe("abc");
  });

  it("handles a tag split one character at a time", () => {
    const { text, reasoning } = run([
      ..."<thinking>".split(""), "why", ..."</thinking>".split(""), "OUT",
    ]);
    expect(text).toBe("OUT");
    expect(reasoning).toBe("why");
  });

  it("still works when a whole tag arrives in one chunk", () => {
    const { text, reasoning } = run(["<thinking>r</thinking>\nOUT"]);
    expect(text).toBe("OUT");
    expect(reasoning).toBe("r");
  });

  it("passes through text with no thinking tags untouched", () => {
    const { text, reasoning } = run(["plain ", "text ", "only"]);
    expect(text).toBe("plain text only");
    expect(reasoning).toBe("");
  });

  it("does not swallow a trailing angle bracket that never becomes a tag", () => {
    // "a < b" must survive: '<' looks like the start of a tag but never completes.
    const { text } = run(["value a <", " b end"]);
    expect(text).toBe("value a < b end");
  });

  it("emits an unterminated thinking block as reasoning, not as lost text", () => {
    const { text, reasoning } = run(["<thinking>", "cut off mid-thought"]);
    expect(text).toBe("");
    expect(reasoning).toBe("cut off mid-thought");
  });

  it("keeps a partial tag out of visible content until it resolves", () => {
    const { text, reasoning } = run(["hello <think", "ing>secret</thinking>\nbye"]);
    expect(text).toBe("hello bye");
    expect(reasoning).toBe("secret");
  });
});
