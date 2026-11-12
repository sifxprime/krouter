// The runtime translator walks text nodes and remembers each one's original
// string, so a language switch can re-translate from the source rather than
// from an already-translated string. That cache is keyed on the text node
// object — and React reuses a text node when a conditional swaps two elements
// of the same type at the same position:
//
//     {running ? <Badge variant="success">Running</Badge>
//              : <Badge variant="default">Stopped</Badge>}
//
// is ONE node whose value changes. The cache survived the change, so the next
// walk translated the stale original and wrote it back over React's update.
//
// Seen live on the MITM page: the card rendered with the green "running" style
// while its text read "Stopped", because "Stopped" was the value that node
// happened to hold the first time the translator saw it. React's own props
// said "Running".
import { describe, it, expect } from "vitest";
import { processTextNode } from "../../src/i18n/runtime.js";

/** The smallest thing processTextNode will accept — it only reads these. */
function textNode(value, parentTag = "span") {
  const parent = { tagName: parentTag.toUpperCase(), hasAttribute: () => false, parentElement: null };
  return { nodeValue: value, parentElement: parent };
}

describe("i18n does not fight React", () => {
  it("keeps a value React wrote, instead of restoring the first one it saw", () => {
    const node = textNode("Stopped");
    processTextNode(node);              // first walk: caches "Stopped"
    node.nodeValue = "Running";         // React re-renders in place
    processTextNode(node);              // a sibling was added; the walk runs again

    expect(node.nodeValue).toBe("Running");
  });

  it("survives repeated walks — the page re-renders on a poll", () => {
    const node = textNode("Stopped");
    processTextNode(node);
    node.nodeValue = "Running";
    for (let i = 0; i < 5; i++) processTextNode(node);
    expect(node.nodeValue).toBe("Running");
  });

  it("re-captures the original, so a later language switch translates the NEW text", () => {
    // The cache exists for language switching; the fix must not break it by
    // leaving the superseded string behind as the translation source.
    const node = textNode("Stopped");
    processTextNode(node);
    node.nodeValue = "Running";
    processTextNode(node);
    expect(node._originalText).toBe("Running");
  });

  it("leaves a node alone when nothing changed it", () => {
    const node = textNode("Providers");
    processTextNode(node);
    const after = node.nodeValue;
    processTextNode(node);
    expect(node.nodeValue).toBe(after);
    expect(node._originalText).toBe("Providers");
  });

  it("ignores whitespace-only and empty nodes", () => {
    for (const v of ["", "   ", "\n  "]) {
      const node = textNode(v);
      processTextNode(node);
      expect(node.nodeValue).toBe(v);
      expect(node._originalText).toBeUndefined();
    }
  });

  it("still skips a subtree marked data-i18n-skip", () => {
    const node = textNode("Running");
    node.parentElement.hasAttribute = (a) => a === "data-i18n-skip";
    processTextNode(node);
    expect(node._originalText).toBeUndefined();
  });

  it("still skips tags that cannot hold translated text", () => {
    for (const tag of ["script", "style", "code", "pre"]) {
      const node = textNode("Running", tag);
      processTextNode(node);
      expect(node._originalText, `${tag} should be skipped`).toBeUndefined();
    }
  });
});
