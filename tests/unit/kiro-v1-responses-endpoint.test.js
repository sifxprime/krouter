/**
 * 0.5.173 — Kiro IDE 1.4.x moved its chat endpoint again, and MITM stopped routing it.
 *
 * Captured from a real client (KiroIDE 1.4.154) through MITM file logging:
 *
 *   POST /v1/responses
 *   content-type: application/json
 *   {"model":"auto","input":[ ...42 items... ],"tools":[ ...25 ... ],"stream":true,
 *    "origin":"AI_EDITOR","profileArn":"...","metadata":{"kiro:agent_mode":"vibe",...}}
 *
 * URL_PATTERNS.kiro listed only "/generateAssistantResponse", and isChatRequest's
 * header fallback only matches x-amz-target, which this request does not send. So every
 * chat turn failed isChatRequest and went straight to passthrough: MITM showed as
 * enabled, kRouter recorded no request at all, and the user's own Kiro credits were
 * spent. The dump confirms it — the response file was written as `passthrough`.
 *
 * This is the SECOND time this has happened. config.js already carries the note for
 * 1.0.228, which moved from the path to `POST /` plus x-amz-target and broke it the
 * same way. The lesson pinned here is that a missed endpoint is silent: it does not
 * error, it bills the vendor instead.
 *
 * `model: "auto"` is a key the alias map already has, so once the request is recognised
 * the existing mapping works unchanged.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require_ = createRequire(import.meta.url);
const { URL_PATTERNS, isChatRequest } = require_("../../src/mitm/config.js");

// The captured request, trimmed to the fields that decide routing.
const kiroRequest = (url = "/v1/responses") => ({ url, headers: { "content-type": "application/json" } });

describe("the endpoints Kiro has used are all recognised", () => {
  it.each([
    ["1.4.x Responses endpoint", "/v1/responses"],
    ["the original path", "/generateAssistantResponse"],
  ])("%s is a chat request", (_label, url) => {
    expect(isChatRequest("kiro", kiroRequest(url))).toBe(true);
  });

  it("1.0.228's header form still works, with no matching path", () => {
    const req = { url: "/", headers: { "x-amz-target": "KiroRuntimeService.GenerateAssistantResponse" } };
    expect(isChatRequest("kiro", req)).toBe(true);
  });

  it("both paths are listed, so neither move is forgotten", () => {
    expect(URL_PATTERNS.kiro).toContain("/v1/responses");
    expect(URL_PATTERNS.kiro).toContain("/generateAssistantResponse");
  });
});

describe("it does not start intercepting unrelated traffic", () => {
  it.each(["/", "/health", "/v1/models", "/telemetry", "/codewhisperer/ping"])(
    "%s is not a chat request without the header",
    (url) => {
      expect(isChatRequest("kiro", kiroRequest(url))).toBe(false);
    },
  );
});

describe("the handler forwards the Responses body untouched", () => {
  const src = require_("node:fs").readFileSync("src/mitm/handlers/kiro.js", "utf8");

  it("routes /v1/responses to kRouter's own /v1/responses", () => {
    expect(src).toContain('fetchRouter(responsesBody, "/v1/responses"');
  });

  it("swaps only the model", () => {
    expect(src).toContain("responsesBody.model = mappedModel");
  });

  it("pipes plain SSE, not AWS EventStream frames", () => {
    // The CodeWhisperer path re-frames into EventStream; a Responses client wants SSE.
    const i = src.indexOf('includes("/v1/responses")');
    expect(i).toBeGreaterThan(-1);
    const branch = src.slice(i, i + 600);
    expect(branch).toContain("pipeSSE(");
    expect(branch).not.toContain("pipeTransformedEventStream(");
  });

  it("decides before the CodeWhisperer translation runs", () => {
    // codeWhispererToMessages would throw on this body ("produced 0 messages"), so the
    // branch has to come first INSIDE intercept — compare within that function, not the
    // whole file, where the helper's own definition appears earlier.
    const fn = src.slice(src.indexOf("async function intercept"));
    const branch = fn.indexOf('includes("/v1/responses")');
    const translate = fn.indexOf("codeWhispererToMessages(body)");
    expect(branch).toBeGreaterThan(-1);
    expect(translate).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(translate);
  });
});
