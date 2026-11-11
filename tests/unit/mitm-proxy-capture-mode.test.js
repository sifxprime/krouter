/**
 * 0.5.175 — Proxy capture mode, driven over a real CONNECT tunnel.
 *
 * The DNS capture mode works and costs a sudo prompt per toggle, machine-wide
 * scope, and a domain the whole machine cannot reach if kRouter stops while the
 * /etc/hosts entries remain -- the failure the 0.5.171 watchdog caused and
 * 0.5.173 had to patch with a liveness probe. This mode listens on an ordinary
 * port and speaks HTTP CONNECT instead: per-app, unprivileged, nothing left on
 * disk, and a dead kRouter is one refused connection rather than a black hole.
 *
 * This test runs the transport for real -- it mints a throwaway root CA into a
 * temp DATA_DIR, starts the proxy on an ephemeral port, opens a CONNECT tunnel,
 * completes a TLS handshake against the leaf the proxy mints, and writes a raw
 * HTTP/1.1 request through it. A stub stands in for kRouter so the assertions
 * are about what the proxy sent, not about any model's output.
 *
 * What it pins, each of which was verified against the live install first:
 *   - a gzip body is decoded and mapped (claude-opus-5 -> cc/claude-fable-5)
 *   - the body handed to kRouter is parseable JSON with the model rewritten
 *   - a host we do not intercept is tunnelled, never decrypted -- so pointing a
 *     whole app at this proxy cannot break the rest of its traffic
 *   - proxy.js is a build entrypoint, because cleanPlainFiles deletes every
 *     file in the CLI bundle dir that is not one, which would have dropped this
 *     whole feature from the published package
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import tls from "node:tls";
import path from "node:path";
import zlib from "node:zlib";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.join(HERE, "..", "..");

let tmpDir, savedDataDir, savedRouterBase, proxy, stub, stubPort, caPem;
const seen = [];

/** Open a CONNECT tunnel, handshake, write one raw request, return the response. */
function throughProxy({ host, requestPath, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const connectReq = http.request({
      host: "127.0.0.1", port: proxy.port, method: "CONNECT", path: `${host}:443`,
    });
    connectReq.on("error", reject);
    connectReq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error(`CONNECT -> ${res.statusCode}`));
      let peerCert = null;
      const secure = tls.connect({ socket, servername: host, host, ca: caPem }, () => {
        // Read it at handshake time: after close the socket no longer has it.
        peerCert = secure.getPeerCertificate();
        const lines = [
          `POST ${requestPath} HTTP/1.1`,
          `Host: ${host}`,
          `Content-Length: ${body ? body.length : 0}`,
          ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
          "Connection: close",
          "", "",
        ].join("\r\n");
        secure.write(lines);
        if (body) secure.write(body);
      });
      const chunks = [];
      secure.on("data", (c) => chunks.push(c));
      secure.on("error", reject);
      secure.on("close", () => {
        const raw = Buffer.concat(chunks).toString();
        const [head, ...rest] = raw.split("\r\n\r\n");
        resolve({
          status: Number((head.split("\r\n")[0] || "").split(" ")[1]),
          cert: peerCert,
          body: rest.join("\r\n\r\n"),
        });
      });
    });
    connectReq.end();
  });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "krouter-proxy-"));
  fs.mkdirSync(path.join(tmpDir, "mitm"), { recursive: true });
  savedDataDir = process.env.DATA_DIR;
  savedRouterBase = process.env.MITM_ROUTER_BASE;
  process.env.DATA_DIR = tmpDir; // read at paths.js load, so set before any import

  fs.writeFileSync(
    path.join(tmpDir, "mitm", "aliases.json"),
    JSON.stringify({ claude: { "claude-opus-5": "cc/claude-fable-5" } })
  );

  // Stand in for kRouter and record exactly what the proxy forwards.
  stub = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers, raw: Buffer.concat(chunks) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, from: "stub-router" }));
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  stubPort = stub.address().port;
  process.env.MITM_ROUTER_BASE = `http://127.0.0.1:${stubPort}`; // read at base.js load

  const { generateCert } = await import("../../src/mitm/cert/generate.js");
  await generateCert();
  caPem = fs.readFileSync(path.join(tmpDir, "mitm", "rootCA.crt"), "utf-8");

  const { startProxy } = await import("../../src/mitm/proxy.js");
  proxy = await startProxy({ port: 0 });
}, 30000);

afterAll(async () => {
  if (proxy) await proxy.close();
  if (stub) await new Promise((r) => stub.close(r));
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  if (savedRouterBase === undefined) delete process.env.MITM_ROUTER_BASE;
  else process.env.MITM_ROUTER_BASE = savedRouterBase;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("the proxy comes up unprivileged", () => {
  it("binds an ordinary port and reports the one it actually got", () => {
    expect(proxy.port).toBeGreaterThan(0);
    expect(proxy.port).not.toBe(443); // the whole point: no privileged port
  });

  it("answers a health probe over plain HTTP", async () => {
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${proxy.port}/_krouter_proxy_health`, (res) => {
        let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(d));
      }).on("error", reject);
    });
    expect(JSON.parse(body)).toMatchObject({ ok: true, mode: "proxy" });
  });
});

describe("an intercepted host over CONNECT", () => {
  it("terminates TLS with our own leaf for the requested hostname", async () => {
    const res = await throughProxy({
      host: "api.anthropic.com", requestPath: "/v1/messages",
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ model: "claude-opus-5", messages: [] })),
    });
    expect(res.cert.subject.CN).toBe("api.anthropic.com");
    expect(res.cert.issuer.CN).toMatch(/9Router|MITM/i);
  }, 20000);

  it("decodes a gzip body, maps the model, and sends kRouter parseable JSON", async () => {
    seen.length = 0;
    const plain = JSON.stringify({
      model: "claude-opus-5", max_tokens: 64, messages: [{ role: "user", content: "hi" }],
    });
    const res = await throughProxy({
      host: "api.anthropic.com", requestPath: "/v1/messages",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: zlib.gzipSync(Buffer.from(plain)),
    });

    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("/v1/messages");

    // The pre-0.5.174 failure was that this threw, so nothing was ever mapped.
    const forwarded = JSON.parse(seen[0].raw.toString());
    expect(forwarded.model).toBe("cc/claude-fable-5");
    expect(forwarded.messages[0].content).toBe("hi");

    // Forwarding the client's content-encoding would tell kRouter to gunzip
    // the JSON that fetchRouter just re-serialized.
    expect(seen[0].headers["content-encoding"]).toBeUndefined();
  }, 20000);
});

describe("a host we do not intercept", () => {
  it("is tunnelled byte-for-byte and never decrypted", async () => {
    // A server with its own identity. If the proxy decrypted this, the client
    // would be handed OUR leaf instead and the handshake below would not match.
    const origin = net.createServer((sock) => {
      sock.on("data", () => sock.end("HTTP/1.1 204 No Content\r\nX-Origin: real\r\n\r\n"));
    });
    await new Promise((r) => origin.listen(0, "127.0.0.1", r));
    const originPort = origin.address().port;

    const got = await new Promise((resolve, reject) => {
      const c = http.request({
        host: "127.0.0.1", port: proxy.port, method: "CONNECT",
        path: `127.0.0.1:${originPort}`,
      });
      c.on("error", reject);
      c.on("connect", (res, socket) => {
        if (res.statusCode !== 200) return reject(new Error(`CONNECT -> ${res.statusCode}`));
        let d = "";
        socket.on("data", (x) => (d += x));
        socket.on("close", () => resolve(d));
        socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      });
      c.end();
    });
    origin.close();

    // Raw bytes from the origin, with no TLS in between: proof it was a tunnel.
    expect(got).toContain("204 No Content");
    expect(got).toContain("X-Origin: real");
  }, 20000);
});

describe("the mode actually ships", () => {
  // cleanPlainFiles deletes every file in cli/app/src/mitm that is not an
  // ENTRY, so an entrypoint missing from that list is removed from the
  // published package and the feature is silently absent at runtime.
  it("proxy.js is a build entrypoint", () => {
    const build = fs.readFileSync(path.join(REPO, "cli", "scripts", "buildMitm.js"), "utf-8");
    const entries = build.match(/const ENTRIES = \[([^\]]*)\]/);
    expect(entries).not.toBeNull();
    expect(entries[1]).toContain('"server.js"');
    expect(entries[1]).toContain('"proxy.js"');
  });

  it("is runnable standalone, so the manager can spawn it without sudo", () => {
    const src = fs.readFileSync(path.join(REPO, "src", "mitm", "proxy.js"), "utf-8");
    expect(src).toMatch(/require\.main === module/);
  });
});
