/**
 * 0.5.174 — Claude Desktop gzips its request bodies, and the MITM could not read them.
 *
 * Symptom as the user saw it: `claude` DNS on, /etc/hosts redirecting
 * api.anthropic.com to 127.0.0.1, the TLS handshake served by "9Router MITM Root CA",
 * the MITM listening on :443 -- and Claude Desktop still spending the user's own
 * Anthropic quota. Nothing in the dashboard said anything was wrong.
 *
 * Measured on the live install before the fix, from the MITM's own raw dumps:
 *
 *   /v1/messages raw dumps        34
 *   of those, passthrough         33
 *   content-encoding on each one  gzip      (5 of 5 sampled)
 *   body as the MITM read it      \x1f\x8b...   (binary)
 *   model as the MITM read it     (not found)
 *   user-agent                    claude-cli/2.1.321 (external, claude-desktop, ...)
 *
 * The chain: extractModel() -> isBinaryData() counts >30% non-printable bytes in the
 * gzip header -> returns null -> getMappedModel(tool, null) returns null -> server.js
 * does `if (!mappedModel) return passthrough(...)`. Passthrough on an intercepted
 * vendor host is not a safe default: the request leaves the machine and bills the
 * vendor account. Kiro was unaffected and worked throughout -- it sends no
 * content-encoding and a plain JSON body -- which is why this looked like a
 * Claude-only trust or toggle problem rather than a body-reading problem.
 *
 * Two things are pinned here: the decoder itself, and the two call sites in server.js
 * that have to use its output. server.js opens a TLS listener on require, so the call
 * sites are asserted at source level -- the same reason getMappedModel was extracted
 * into modelMap.js in 0.5.169.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "src", "mitm");
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), "utf-8");

let tmpDir, savedDataDir, decodeRequestBody, getMappedModel, decideRoute;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-gzipbody-"));
  fs.mkdirSync(path.join(tmpDir, "mitm"), { recursive: true });
  savedDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tmpDir; // read at paths.js load, so set before first import
  fs.writeFileSync(
    path.join(tmpDir, "mitm", "aliases.json"),
    JSON.stringify({ claude: { "claude-opus-5": "cc/claude-fable-5" } })
  );
  ({ decodeRequestBody } = await import("../../src/mitm/bodyCodec.js"));
  ({ getMappedModel } = await import("../../src/mitm/modelMap.js"));
  ({ decideRoute } = await import("../../src/mitm/dispatch.js"));
});

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// A real Claude Desktop /v1/messages body, trimmed to the fields that matter.
const CLAUDE_BODY = JSON.stringify({
  model: "claude-opus-5",
  max_tokens: 32000,
  stream: true,
  messages: [{ role: "user", content: "hello" }],
});

describe("decodeRequestBody", () => {
  it("decodes the gzip body Claude Desktop actually sends", () => {
    const wire = zlib.gzipSync(Buffer.from(CLAUDE_BODY));
    // The pre-fix failure, reproduced: the raw bytes are unparseable.
    expect(() => JSON.parse(wire.toString())).toThrow();
    expect(decodeRequestBody(wire, { "content-encoding": "gzip" }).toString()).toBe(CLAUDE_BODY);
  });

  it.each([
    ["gzip", zlib.gzipSync],
    ["x-gzip", zlib.gzipSync],
    ["br", zlib.brotliCompressSync],
    ["deflate", zlib.deflateSync],
    ["deflate (raw, as some clients send it)", zlib.deflateRawSync],
  ])("decodes content-encoding: %s", (label, compress) => {
    const encoding = label.split(" ")[0];
    const wire = compress(Buffer.from(CLAUDE_BODY));
    expect(decodeRequestBody(wire, { "content-encoding": encoding }).toString()).toBe(CLAUDE_BODY);
  });

  it("undoes stacked encodings right-to-left, as they were applied", () => {
    const wire = zlib.gzipSync(zlib.deflateSync(Buffer.from(CLAUDE_BODY)));
    expect(decodeRequestBody(wire, { "content-encoding": "deflate, gzip" }).toString()).toBe(CLAUDE_BODY);
  });

  it("handles header casing and identity", () => {
    const plain = Buffer.from(CLAUDE_BODY);
    expect(decodeRequestBody(plain, {}).toString()).toBe(CLAUDE_BODY);
    expect(decodeRequestBody(plain, { "content-encoding": "identity" }).toString()).toBe(CLAUDE_BODY);
    expect(decodeRequestBody(zlib.gzipSync(plain), { "Content-Encoding": "GZIP" }).toString()).toBe(CLAUDE_BODY);
  });

  // The decoder sits in front of every intercepted request, so it must never be the
  // thing that fails one. Anything it cannot decode comes back untouched and the
  // caller's existing passthrough path applies, exactly as before.
  it.each([
    ["an unknown encoding", () => Buffer.from(CLAUDE_BODY), { "content-encoding": "exi" }],
    ["a body that is not actually compressed", () => Buffer.from(CLAUDE_BODY), { "content-encoding": "gzip" }],
    ["truncated gzip", () => zlib.gzipSync(Buffer.from(CLAUDE_BODY)).subarray(0, 12), { "content-encoding": "gzip" }],
  ])("returns the body unchanged for %s", (_label, make, headers) => {
    const buffer = make();
    expect(decodeRequestBody(buffer, headers).equals(buffer)).toBe(true);
  });

  it("does not throw on empty or absent bodies", () => {
    expect(decodeRequestBody(Buffer.alloc(0), { "content-encoding": "gzip" }).length).toBe(0);
    expect(decodeRequestBody(null, { "content-encoding": "gzip" })).toBeNull();
    expect(decodeRequestBody(undefined, {})).toBeUndefined();
  });
});

describe("the gzip body now reaches a mapping decision", () => {
  it("decode -> parse -> getMappedModel returns a target instead of a miss", () => {
    const wire = zlib.gzipSync(Buffer.from(CLAUDE_BODY));

    // What the MITM did before the fix, with the model it could read: nothing.
    expect(getMappedModel("claude", null)).toBeNull();

    const model = JSON.parse(decodeRequestBody(wire, { "content-encoding": "gzip" }).toString()).model;
    expect(model).toBe("claude-opus-5");
    expect(getMappedModel("claude", model)).toBe("cc/claude-fable-5");
  });
});

describe("decideRoute reaches intercept on a gzip Claude Desktop request", () => {
  // The real end-to-end verdict, not a source match: this is the single decision
  // that made the difference between "routed" and "billed to Anthropic".
  const gzipReq = () => ({
    url: "/v1/messages",
    headers: { host: "api.anthropic.com", "content-encoding": "gzip" },
  });

  it("intercepts, and hands the handler a body it can JSON.parse", () => {
    const route = decideRoute(gzipReq(), zlib.gzipSync(Buffer.from(CLAUDE_BODY)));
    expect(route.action).toBe("intercept");
    expect(route.model).toBe("claude-opus-5");
    expect(route.mappedModel).toBe("cc/claude-fable-5");
    // handlers/claude.js does JSON.parse(bodyBuffer.toString()) -- it must not throw.
    expect(JSON.parse(route.body.toString()).model).toBe("claude-opus-5");
  });

  it("passes through with reason no-mapping when the model is unmapped", () => {
    const body = JSON.stringify({ model: "claude-not-a-real-model", messages: [] });
    const route = decideRoute(gzipReq(), zlib.gzipSync(Buffer.from(body)));
    expect(route.action).toBe("passthrough");
    expect(route.reason).toBe("no-mapping");
    // The model was still READ -- the pre-fix bug was failing one step earlier.
    expect(route.model).toBe("claude-not-a-real-model");
  });

  it("an undecodable gzip body degrades to passthrough rather than throwing", () => {
    const truncated = zlib.gzipSync(Buffer.from(CLAUDE_BODY)).subarray(0, 12);
    const route = decideRoute(gzipReq(), truncated);
    expect(route.action).toBe("passthrough");
    expect(route.model).toBeNull();
  });
});

describe("server.js wires the shared decision in", () => {
  const server = read("server.js");

  it("uses decideRoute rather than its own copy of the logic", () => {
    expect(server).toMatch(/require\("\.\/dispatch"\)/);
    expect(server).toMatch(/decideRoute\(req,\s*bodyBuffer\)/);
    // The local copies were deleted, not left behind to drift.
    expect(server).not.toMatch(/^function extractModel/m);
    expect(server).not.toMatch(/^function isBinaryData/m);
  });

  it("gives the handler the decoded body, so its JSON.parse works", () => {
    expect(server).toMatch(/intercept\(req,\s*res,\s*route\.body,\s*route\.mappedModel/);
  });

  // passthrough forwards to the real vendor with the client's own headers, which
  // still say gzip -- so it has to keep sending the original bytes.
  it("keeps sending the original compressed bytes on passthrough", () => {
    const calls = server.match(/[^a-zA-Z]passthrough\(req,\s*res,\s*[A-Za-z.]+/g) || [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/bodyBuffer$/);
  });
});

describe("handlers/base.js does not forward a stale content-encoding", () => {
  // fetchRouter re-serializes with JSON.stringify. Forwarding the client's
  // `content-encoding: gzip` with plain JSON tells kRouter to gunzip text.
  it("strips content-encoding before forwarding to kRouter", () => {
    const block = read("handlers", "base.js").match(/const STRIP_HEADERS = new Set\(\[[\s\S]*?\]\);/);
    expect(block).not.toBeNull();
    expect(block[0]).toContain('"content-encoding"');
  });
});
