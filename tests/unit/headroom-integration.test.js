import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { compressWithHeadroom, formatHeadroomLog } from "../../open-sse/rtk/headroom.js";

describe("v0.5.115 Headroom integration", () => {
  it("compressWithHeadroom fails open when disabled or no url", async () => {
    expect(await compressWithHeadroom({ messages: [] }, { enabled: false })).toBeNull();
    expect(await compressWithHeadroom({ messages: [] }, { enabled: true, url: "" })).toBeNull();
  });

  it("fails open (returns null) when the proxy is unreachable — never throws", async () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const r = await compressWithHeadroom(body, {
      enabled: true, url: "http://127.0.0.1:1", model: "gpt-4", format: "openai", timeoutMs: 800,
    });
    expect(r).toBeNull();
    expect(body.messages).toHaveLength(1); // untouched
  });

  it("formatHeadroomLog returns null for no stats", () => {
    expect(formatHeadroomLog(null)).toBeNull();
  });

  it("chatCore wires headroom into the token-saver block", () => {
    const src = readFileSync("open-sse/handlers/chatCore.js", "utf8");
    expect(src).toMatch(/compressWithHeadroom\(translatedBody/);
    expect(src).toMatch(/if \(headroomEnabled\)/);
  });

  it("chat.js passes headroom settings to both handleChatCore calls", () => {
    const src = readFileSync("src/sse/handlers/chat.js", "utf8");
    const n = (src.match(/headroomEnabled: !!settings\.headroomEnabled/g) || []).length;
    expect(n).toBe(2);
  });

  it("all headroom API routes + lib exist", () => {
    for (const f of [
      "src/lib/headroom/detect.js", "src/lib/headroom/process.js", "open-sse/rtk/headroom.js",
      "src/app/api/headroom/start/route.js", "src/app/api/headroom/stop/route.js",
      "src/app/api/headroom/status/route.js", "src/app/api/headroom/extras/route.js",
      "src/app/api/headroom/restart/route.js",
    ]) {
      expect(() => readFileSync(f, "utf8"), `${f} must exist`).not.toThrow();
    }
  });

  it("settings default headroom off with the standard proxy url", () => {
    const src = readFileSync("src/lib/db/repos/settingsRepo.js", "utf8");
    expect(src).toMatch(/headroomEnabled: false/);
    expect(src).toMatch(/headroomUrl: "http:\/\/localhost:8787"/);
  });
});
