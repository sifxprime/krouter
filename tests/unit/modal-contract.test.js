import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const MODAL = read("src/shared/components/Modal.js");

/**
 * The same file with comments removed.
 *
 * Needed because the comments here describe the behaviour that was replaced,
 * naming the very strings these tests assert are gone — so a check against the
 * raw text fails on the explanation of the fix rather than on the fix.
 */
const MODAL_CODE = MODAL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Modal", () => {
  it("announces itself as a dialog", () => {
    // Without these a screen reader reads the dialog as more of the page it is
    // covering, with no indication that the rest is inert.
    expect(MODAL).toContain('role="dialog"');
    expect(MODAL).toContain('aria-modal="true"');
    expect(MODAL, "the title must name the dialog").toContain("aria-labelledby");
  });

  it("captures the opener during render, not from an effect", () => {
    // The bug this replaces: the restore target was read from
    // `document.activeElement` inside an effect. React applies `autoFocus`
    // while committing the panel, so by the time any effect runs — layout or
    // passive — focus is already on a control inside the dialog. The dialog
    // then "restored" focus to the element it was about to destroy, and
    // closing left focus on <body> with no way back to the trigger.
    const effectBodies = MODAL_CODE.split("useEffect(").slice(1).join("useEffect(");
    expect(
      effectBodies,
      "reading document.activeElement from an effect is too late to find the opener"
    ).not.toMatch(/const\s+opener\s*=\s*document\.activeElement/);
    expect(MODAL_CODE, "the open transition must capture the opener").toMatch(/isOpen && !wasOpen\.current/);
  });

  it("keeps Tab inside while it is open", () => {
    expect(MODAL_CODE, "no Tab handling — focus walks out of the dialog").toContain('e.key !== "Tab"');
    expect(MODAL_CODE, "shift-tab off the first control must wrap to the last").toContain("e.shiftKey");
  });

  it("restores the page scroll it locked, not a hardcoded value", () => {
    // Setting `overflow = ""` on close clobbers a lock some other component
    // owns, which is how two stacked dialogs end up scrolling the page behind.
    expect(MODAL).toContain("const previousOverflow = document.body.style.overflow");
    expect(MODAL).toContain("document.body.style.overflow = previousOverflow");
  });

  it("has no decorative controls that do nothing", () => {
    // It used to draw macOS traffic lights: one real close button and two grey
    // circles with `cursor-not-allowed` — window chrome on something that is
    // not a window, and controls on things that are not controls.
    expect(MODAL_CODE, "a disabled-looking fake control is still a fake control").not.toContain("cursor-not-allowed");
    expect(MODAL_CODE).not.toContain("showTrafficLights");
  });

  it("is the only dialog implementation the shared components use", () => {
    // Not a hard rule for pages, which have one-off overlays, but a second
    // dialog in the shared layer means two sets of focus behaviour to keep
    // right, and the second one never gets the attention.
    const shared = fs
      .readdirSync(path.join(process.cwd(), "src/shared/components"))
      .filter((f) => f.endsWith(".js") && f !== "Modal.js");
    const rogue = shared.filter((f) => {
      const src = read(`src/shared/components/${f}`);
      return src.includes('role="dialog"') && !src.includes("from \"./Modal\"");
    });
    expect(rogue, `these build their own dialog instead of using Modal: ${rogue}`).toEqual([]);
  });
});
