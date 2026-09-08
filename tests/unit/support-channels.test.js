/**
 * The support affordance is the only path a stuck user has to a human, so the
 * destinations are asserted rather than eyeballed: a typo in the number or the
 * address fails silently for everyone who clicks it.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  SUPPORT_CHANNELS,
  SUPPORT_EMAIL,
  SUPPORT_WHATSAPP_URL,
  SUPPORT_WHATSAPP_NUMBER,
  SUPPORT_WHATSAPP_DISPLAY,
} from "../../src/shared/constants/support.js";

const componentSrc = () => fs.readFileSync(
  path.join(process.cwd(), "src/shared/components/SupportMenu.js"), "utf-8");

describe("support channels", () => {
  it("offers exactly WhatsApp and email", () => {
    expect(SUPPORT_CHANNELS.map((c) => c.id)).toEqual(["whatsapp", "email"]);
  });

  it("uses the wa.me format that actually resolves", () => {
    // wa.me wants digits only -- a leading "+" or spaces give a broken link.
    expect(SUPPORT_WHATSAPP_NUMBER).toMatch(/^\d{8,15}$/);
    expect(SUPPORT_WHATSAPP_URL).toBe("https://wa.me/8801312365939");
  });

  it("shows a number that matches the one it dials", () => {
    // The label a user reads and the link they click must not drift apart.
    expect(SUPPORT_WHATSAPP_DISPLAY.replace(/\D/g, "")).toBe(SUPPORT_WHATSAPP_NUMBER);
  });

  it("uses a mailto for the support address", () => {
    const email = SUPPORT_CHANNELS.find((c) => c.id === "email");
    expect(SUPPORT_EMAIL).toBe("support@kodelyth.com");
    expect(email.href).toBe("mailto:support@kodelyth.com");
    expect(email.detail).toBe(SUPPORT_EMAIL);
  });

  it("every channel has a destination and an icon", () => {
    for (const c of SUPPORT_CHANNELS) {
      expect(c.href, c.id).toBeTruthy();
      expect(c.label, c.id).toBeTruthy();
      expect(["whatsapp", "mail"]).toContain(c.icon);
    }
  });
});

describe("support menu component", () => {
  it("draws real SVG marks, not icon-font glyphs or emoji", () => {
    const src = componentSrc();
    expect(src).toContain("<svg");
    // The nav's Material Symbols font has no WhatsApp glyph.
    expect(src).not.toContain("material-symbols-outlined");
    expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("opens external links safely", () => {
    const src = componentSrc();
    expect(src).toContain('rel="noopener noreferrer"');
  });

  it("is operable and announced for keyboard and screen readers", () => {
    const src = componentSrc();
    expect(src).toContain("aria-expanded");
    expect(src).toContain("aria-controls");
    // Collapsed links must leave the tab order, or Tab lands on invisible targets.
    expect(src).toContain("tabIndex={open ? 0 : -1}");
    expect(src).toContain("focus-visible:ring");
    expect(src).toContain('e.key !== "Escape"');
  });

  it("reads its destinations from the shared constants", () => {
    // A second hardcoded copy of the number is how the two drift apart.
    const src = componentSrc();
    expect(src).toContain("SUPPORT_CHANNELS");
    expect(src).not.toContain("wa.me/");
    expect(src).not.toContain("@kodelyth.com");
  });
});
