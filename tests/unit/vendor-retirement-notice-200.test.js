/**
 * 0.5.172 — an HTTP 200 whose "answer" is the vendor saying the model is gone.
 *
 * Measured live against ag/claude-sonnet-4-6, an id still in the catalogue:
 *
 *   HTTP 200
 *   {"object":"chat.completion","model":"gemini","choices":[{"message":{
 *     "content":"Claude Sonnet 4.6 is no longer available. Please switch to Claude Sonnet 5.5."},
 *     "finish_reason":"stop"}]}
 *
 * Nothing in the tree saw a problem. finish_reason is a clean "stop" and there IS text,
 * so it counted as a success: billed, written to the request log as "200 OK", rendered
 * to the user as the model's own words, and a combo did not advance to its next entry —
 * isZeroContentResponse rejects anything whose finish_reason is not in_progress/incomplete.
 *
 * The danger in fixing it is the opposite error: a model legitimately ANSWERING a question
 * about a retired model says much the same words, and throwing that away would be worse
 * than the bug. So detection is a conjunction, and these tests pin both directions —
 * what must be caught, and what must be left alone.
 */
import { describe, it, expect } from "vitest";
import {
  detectVendorRetirementNotice,
  detectEmptyCompletion,
  EMPTY_COMPLETION_STATUS,
} from "../../open-sse/utils/emptyCompletion.js";
import { isZeroContentResponse } from "../../open-sse/services/combo.js";

const NOTICE = "Claude Sonnet 4.6 is no longer available. Please switch to Claude Sonnet 5.5.";
const MODEL = "ag/claude-sonnet-4-6";

const completion = (content, finish = "stop") => ({
  object: "chat.completion",
  model: "gemini",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }],
});

describe("the notice is recognised", () => {
  it("flags the exact body measured from the provider", () => {
    const d = detectVendorRetirementNotice({ text: NOTICE, model: MODEL });
    expect(d).toBeTruthy();
    expect(d.code).toBe("vendor_retirement_notice");
    expect(d.notice).toBe(NOTICE);
  });

  it("flags it even when the caller does not say which model was asked for", () => {
    expect(detectVendorRetirementNotice({ text: NOTICE })).toBeTruthy();
  });

  it.each([
    "Gemini 1.5 Pro has been retired. Please migrate to Gemini 2.5 Pro.",
    "gpt-4-turbo is deprecated — use gpt-5 instead.",
    "This model is no longer supported. Switch to the current release.",
  ])("flags other vendors' phrasings: %s", (text) => {
    expect(detectVendorRetirementNotice({ text })).toBeTruthy();
  });
});

describe("a real answer is never eaten — each gate on its own", () => {
  it("a notice naming a DIFFERENT model than the one requested", () => {
    // The user asked Opus 5.5 something; the reply discusses Sonnet 4.6. Not our case.
    expect(detectVendorRetirementNotice({ text: NOTICE, model: "ag/claude-opus-5-5-high" })).toBeNull();
  });

  it("an ordinary completion", () => {
    expect(detectVendorRetirementNotice({ text: "OK7", model: MODEL })).toBeNull();
  });

  it("a genuine, longer explanation about the retirement", () => {
    const essay =
      "Yes — Claude Sonnet 4.6 is no longer available, and the recommended path is to " +
      "switch to Claude Sonnet 5.5. Below I walk through what changes, which parameters " +
      "moved, and how to stage the migration so nothing breaks in production.";
    expect(detectVendorRetirementNotice({ text: essay, model: MODEL })).toBeNull();
  });

  it("'gone' without a replacement named", () => {
    expect(detectVendorRetirementNotice({ text: "Claude Sonnet 4.6 is no longer available.", model: MODEL })).toBeNull();
  });

  it("anything that also made a tool call", () => {
    expect(detectVendorRetirementNotice({ text: NOTICE, toolCalls: [{ id: "t" }], model: MODEL })).toBeNull();
  });

  it.each([[null], [undefined], [""], ["   "], [42]])("junk text %p", (text) => {
    expect(detectVendorRetirementNotice({ text })).toBeNull();
  });
});

describe("it reaches the places that act on it", () => {
  it("detectEmptyCompletion returns it, despite the text being non-empty", () => {
    // The early return "there is text, therefore there was output" used to win here.
    const d = detectEmptyCompletion({ text: NOTICE, finishReason: "stop", model: MODEL });
    expect(d?.code).toBe("vendor_retirement_notice");
  });

  it("a combo treats it as zero-content and advances", () => {
    expect(isZeroContentResponse(completion(NOTICE), MODEL)).toBe(true);
  });

  it("a combo still returns a real answer from the same seat", () => {
    expect(isZeroContentResponse(completion("OK7"), MODEL)).toBe(false);
  });

  it("the finish_reason gate no longer hides it", () => {
    // "stop" is not in ZERO_CONTENT_FINISH, which is why this used to return false.
    expect(completion(NOTICE).choices[0].finish_reason).toBe("stop");
    expect(isZeroContentResponse(completion(NOTICE), MODEL)).toBe(true);
  });

  it("the request log says what it was, not '200 OK'", () => {
    const d = detectEmptyCompletion({ text: NOTICE, finishReason: "stop", model: MODEL });
    expect(EMPTY_COMPLETION_STATUS(d)).toBe("200 RETIREMENT NOTICE (not an answer)");
    expect(EMPTY_COMPLETION_STATUS(null)).toBe("200 OK");
  });
});
