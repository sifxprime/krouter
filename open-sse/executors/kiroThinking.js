/**
 * Kiro has no native reasoning field. Thinking is turned on by injecting
 * <thinking_mode>enabled</thinking_mode> into the system prompt, so the model
 * returns its reasoning as literal <thinking> tags inside ordinary assistant
 * text (assistantResponseEvent), not as a separate reasoningContentEvent.
 *
 * Those tags are not chunk-aligned. A real stream from kr/claude-sonnet-4.5-thinking
 * opens with the delta "<thinking" and only completes the tag in the next delta,
 * so scanning a single chunk with indexOf matches neither half. Any splitter here
 * has to carry state across chunks: text that could still turn out to be the start
 * of a tag is held back until the next chunk proves it either way.
 */

export const OPEN_TAG = "<thinking>";
export const CLOSE_TAG = "</thinking>";

/** Length of the longest suffix of `text` that is a proper prefix of `tag`. */
function partialTagTail(text, tag) {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

export function createThinkingSplitter() {
  let inThinking = false;
  let pending = "";
  // The model writes "</thinking>\n\nAnswer". Those newlines belong to the tag, not
  // to the answer, but they can arrive in a later chunk than the closing tag, so the
  // trim has to survive across chunks instead of running once at close time.
  // Newlines only -- a space after the tag is real content and is left alone.
  let trimLeading = false;

  function split(raw) {
    let buf = pending + raw;
    pending = "";
    let text = "";
    let reasoning = "";

    const pushText = (piece) => {
      if (!piece) return;
      if (trimLeading) {
        piece = piece.replace(/^\n+/u, "");
        if (!piece) return;
        trimLeading = false;
      }
      text += piece;
    };

    while (buf) {
      const tag = inThinking ? CLOSE_TAG : OPEN_TAG;
      const at = buf.indexOf(tag);
      if (at < 0) {
        const keep = partialTagTail(buf, tag);
        const settled = keep ? buf.slice(0, buf.length - keep) : buf;
        if (inThinking) reasoning += settled;
        else pushText(settled);
        pending = keep ? buf.slice(buf.length - keep) : "";
        break;
      }
      if (inThinking) {
        reasoning += buf.slice(0, at);
        inThinking = false;
        trimLeading = true;
      } else {
        pushText(buf.slice(0, at));
        inThinking = true;
      }
      buf = buf.slice(at + tag.length);
    }
    return { text, reasoning };
  }

  /**
   * End of stream. Anything still held back was never going to become a tag, so
   * emit it rather than silently truncating the tail of the response.
   */
  function flush() {
    const tail = pending;
    pending = "";
    if (!tail) return { text: "", reasoning: "" };
    if (inThinking) return { text: "", reasoning: tail };
    const text = trimLeading ? tail.replace(/^\n+/u, "") : tail;
    trimLeading = false;
    return { text, reasoning: "" };
  }

  return {
    split,
    flush,
    get inThinking() { return inThinking; },
  };
}
