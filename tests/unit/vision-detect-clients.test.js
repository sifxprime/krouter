import { describe, it, expect } from "vitest";
import { detectRequiredCapabilities } from "../../open-sse/services/combo.js";

// upstream 345cdcf6 — these client shapes previously read as text-only, so the
// capacity adapter never swapped in a vision-capable model.
describe("0.5.142 vision detection across client shapes", () => {
  const caps = (b) => [...detectRequiredCapabilities(b)];

  it("Ollama / Hermes images[] array", () => {
    expect(caps({ messages: [{ role: "user", content: "what is this?", images: ["iVBORw0KGgo="] }] })).toContain("vision");
  });

  it("Vercel AI SDK experimental_attachments", () => {
    expect(caps({ messages: [{ role: "user", content: "look", experimental_attachments: [{ contentType: "image/png", url: "https://x/y.png" }] }] })).toContain("vision");
  });

  it("attachment with only a data: url (mime inferred)", () => {
    expect(caps({ messages: [{ role: "user", content: "x", attachments: [{ url: "data:image/jpeg;base64,AAA" }] }] })).toContain("vision");
  });

  it("message-level image_url / audio_url", () => {
    expect(caps({ messages: [{ role: "user", content: "a", image_url: "https://x/y.png" }] })).toContain("vision");
    expect(caps({ messages: [{ role: "user", content: "a", audio_url: "https://x/y.mp3" }] })).toContain("audioInput");
  });

  it("data: URI embedded in plain string content", () => {
    expect(caps({ messages: [{ role: "user", content: "see data:image/png;base64,AAA" }] })).toContain("vision");
  });

  it("standard OpenAI content blocks still work (no regression)", () => {
    expect(caps({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x/y.png" } }] }] })).toContain("vision");
  });

  it("plain text stays text-only (no false positives)", () => {
    expect(caps({ messages: [{ role: "user", content: "just text" }] })).toEqual([]);
  });
});
