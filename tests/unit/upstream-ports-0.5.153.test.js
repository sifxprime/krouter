/**
 * Ports from upstream 11222eff, 28cfd9fa, 925cb4aa and 14401c43.
 * Each covers something a user sees or is told.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf-8");
const noComments = (src) => src.split("\n")
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
  }).join("\n");

// Mirrors the fill both executors now apply.
const fill = (parameters) =>
  parameters.type === "object" && !parameters.properties
    ? { ...parameters, properties: {} }
    : parameters;

describe("Responses tool schemas always carry properties", () => {
  it("fills an empty object schema the client supplied verbatim", () => {
    // Strict Responses backends answer 400 "missing required parameter
    // tools[N].parameters.properties", failing the whole turn.
    expect(fill({ type: "object" })).toEqual({ type: "object", properties: {} });
  });

  it("leaves a populated schema untouched", () => {
    const p = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    expect(fill(p)).toEqual(p);
  });

  it("does not invent properties on a non-object schema", () => {
    expect(fill({ type: "string" })).toEqual({ type: "string" });
  });

  it("is applied by both executors that post to a Responses endpoint", () => {
    for (const f of ["open-sse/executors/codex.js", "open-sse/executors/grok-cli.js"]) {
      const src = noComments(read(f));
      expect(src, f).toContain('parameters.type === "object" && !parameters.properties');
      // const would make the reassignment a TypeError at runtime.
      expect(src, f).toContain("let parameters");
    }
  });
});

describe("the dashboard does not claim local storage to a remote viewer", () => {
  const src = () => noComments(read("src/app/(dashboard)/dashboard/profile/page.js"));

  it("detects a non-loopback host", () => {
    const s = src();
    expect(s).toContain("isRemoteHost");
    expect(s).toContain('["localhost", "127.0.0.1", "::1"]');
  });

  it("no longer states unconditionally that data is on your machine", () => {
    const s = src();
    // The bare literal is the false claim; it must now be behind the flag.
    expect(s).not.toMatch(/<p className="mt-1">Local Mode - All data stored on your machine<\/p>/);
    expect(s).toContain('isRemoteHost ? "Remote Mode"');
  });

  it("fixes the prominent card as well as the footer", () => {
    const s = src();
    expect(s).not.toMatch(/>Local Mode<\/h2>/);
    expect(s).toContain('isRemoteHost ? "Running on the host you connected to"');
  });

  it("the predicate is right for both loopback and remote", () => {
    const isRemote = (h) => !["localhost", "127.0.0.1", "::1"].includes(h);
    expect(isRemote("localhost")).toBe(false);
    expect(isRemote("127.0.0.1")).toBe(false);
    expect(isRemote("::1")).toBe(false);
    expect(isRemote("192.168.0.105")).toBe(true);
    expect(isRemote("krouter.example.ts.net")).toBe(true);
  });
});

describe("no theme flash, and no bare ligature text", () => {
  it("applies the persisted theme before first paint", () => {
    const src = read("src/app/layout.js");
    expect(src).toContain("localStorage.getItem('theme')");
    expect(src).toContain("classList.add('dark')");
    // Must read the same key and shape the zustand store persists.
    const cfg = read("src/shared/constants/config.js");
    expect(cfg).toContain('storageKey: "theme"');
  });

  it("waits for the icon font itself, with a failsafe", () => {
    const src = read("src/app/layout.js");
    // document.fonts.ready settles on the text faces alone; the icon woff2 is lazy.
    expect(src).toContain("d.fonts.load('24px \"Material Symbols Outlined\"')");
    expect(src).toContain("setTimeout(f,3000)");
  });

  it("reveals icons by opacity rather than visibility", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain(".material-symbols-outlined { opacity: 0; }");
    expect(css).toContain("transition: opacity .12s ease-out");
  });
});

describe("Claude tools always carry an explicit type", () => {
  it("defaults a bare tool to custom", async () => {
    const { defaultClaudeToolType } = await import("../../open-sse/translator/helpers/toolCallHelper.js");
    const out = defaultClaudeToolType([{ name: "get_time", input_schema: { type: "object" } }]);
    expect(out[0].type).toBe("custom");
    expect(out[0].name).toBe("get_time");
  });

  it("leaves a built-in tool's own type alone", async () => {
    const { defaultClaudeToolType } = await import("../../open-sse/translator/helpers/toolCallHelper.js");
    const out = defaultClaudeToolType([
      { type: "web_search_20250305", name: "web_search" },
      { type: "bash", name: "bash" },
    ]);
    expect(out.map((t) => t.type)).toEqual(["web_search_20250305", "bash"]);
  });

  it("overrides a falsy type rather than letting it survive", async () => {
    const { defaultClaudeToolType } = await import("../../open-sse/translator/helpers/toolCallHelper.js");
    // {type:"custom", ...tool} would keep null here and still 400.
    expect(defaultClaudeToolType([{ name: "a", type: null }])[0].type).toBe("custom");
    expect(defaultClaudeToolType([{ name: "b", type: "" }])[0].type).toBe("custom");
  });

  it("does not mutate the caller's tools", async () => {
    const { defaultClaudeToolType } = await import("../../open-sse/translator/helpers/toolCallHelper.js");
    const input = [{ name: "x" }];
    defaultClaudeToolType(input);
    expect(input[0].type).toBeUndefined();
  });

  it("passes a non-array through untouched", async () => {
    const { defaultClaudeToolType } = await import("../../open-sse/translator/helpers/toolCallHelper.js");
    expect(defaultClaudeToolType(undefined)).toBeUndefined();
  });

  it("is applied on the Claude path in chatCore", () => {
    const src = noComments(read("open-sse/handlers/chatCore.js"));
    expect(src).toContain("finalFormat === FORMATS.CLAUDE && Array.isArray(translatedBody.tools)");
    expect(src).toContain("defaultClaudeToolType(translatedBody.tools)");
  });
});

describe("small guards ported from upstream", () => {
  it("the key mask does not throw on a key shorter than the prefix", () => {
    // "•".repeat(negative) is a RangeError, which crashed the whole card.
    const mask = (apiKey) => `${apiKey.slice(0, 8)}${"•".repeat(Math.min(20, Math.max(0, apiKey.length - 8)))}`;
    expect(() => mask("abc")).not.toThrow();
    expect(mask("abc")).toBe("abc");
    expect(mask("sk-1234567890abcdef")).toBe("sk-12345" + "•".repeat(11));
  });

  it("every mask site in the media-provider page is clamped", () => {
    const src = read("src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js");
    expect(src).not.toContain("Math.min(20, apiKey.length - 8)");
    expect(src.match(/Math\.max\(0, apiKey\.length - 8\)/g) || []).toHaveLength(3);
  });

  it("does not suggest an OpenCode model upstream reports as unavailable", async () => {
    const { FILTERS } = await import("../../src/app/api/providers/suggested-models/filters.js");
    const out = FILTERS["opencode-free"]([
      { id: "big-pickle", name: "Big Pickle" },
      { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash" },
      { id: "glm-5.2-free", name: "GLM" },
    ]);
    expect(out.map((m) => m.id)).toEqual(["big-pickle", "glm-5.2-free"]);
  });

  it("still tolerates a non-array payload", async () => {
    const { FILTERS } = await import("../../src/app/api/providers/suggested-models/filters.js");
    expect(FILTERS["opencode-free"](null)).toEqual([]);
  });
});
