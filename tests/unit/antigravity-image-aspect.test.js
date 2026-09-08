/**
 * Antigravity encodes the aspect ratio in the model id, not in a parameter, so a
 * requested size has to become a model suffix. Ported from upstream 2a9213c5.
 */
import { describe, expect, it } from "vitest";
import { sizeToAspectRatio } from "../../open-sse/handlers/imageProviders/_base.js";
import fs from "node:fs";
import path from "node:path";

const src = () => fs.readFileSync(
  path.join(process.cwd(), "open-sse/handlers/imageProviders/antigravity.js"), "utf-8");

// Mirrors the adapter's resolution.
const resolve = (model, size) => {
  const isImageModel = (m) => /image|imagen|image-generation/i.test(m || "");
  let target = isImageModel(model) ? model : "gemini-3.1-flash-image";
  if (size && typeof size === "string") {
    const suffix = sizeToAspectRatio(size).replace(":", "x");
    if (!target.includes(suffix)) target = `${target}-${suffix}`;
  }
  return target;
};

describe("Antigravity image model resolution", () => {
  it("appends the aspect ratio as a model suffix", () => {
    expect(resolve("gemini-3.1-flash-image", "1024x1024")).toContain("1x1");
  });

  it("falls back to an image model when handed a chat model", () => {
    // A chat id reaching an image request is a routing slip; sending it produces a
    // confusing upstream error rather than an obvious one.
    expect(resolve("gemini-3-flash-agent", undefined)).toBe("gemini-3.1-flash-image");
  });

  it("keeps an explicit image model", () => {
    expect(resolve("imagen-4", undefined)).toBe("imagen-4");
  });

  it("does not double-append a suffix already present", () => {
    const once = resolve("gemini-3.1-flash-image", "1024x1024");
    expect(resolve(once, "1024x1024")).toBe(once);
  });

  it("passes the resolved model to the executor, not the original", () => {
    const s = src();
    expect(s).toContain("model: targetModel");
    expect(s).toContain("sizeToAspectRatio");
  });
});
