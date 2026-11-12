import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const MODAL = read("src/shared/components/Modal.js");
// The dialog behaviour — role, focus trap, scroll lock, restore — lives in the
// hook, so that both `Modal` and the overlays that keep their own markup get
// one implementation instead of two that drift. These tests follow it there.
const HOOK = read("src/shared/hooks/useDialog.js");
const BEHAVIOUR = MODAL + "\n" + HOOK;

/**
 * The same file with comments removed.
 *
 * Needed because the comments here describe the behaviour that was replaced,
 * naming the very strings these tests assert are gone — so a check against the
 * raw text fails on the explanation of the fix rather than on the fix.
 */
const MODAL_CODE = BEHAVIOUR.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Modal", () => {
  it("announces itself as a dialog", () => {
    // Without these a screen reader reads the dialog as more of the page it is
    // covering, with no indication that the rest is inert.
    expect(BEHAVIOUR).toContain('role: "dialog"');
    expect(BEHAVIOUR).toContain('"aria-modal": "true"');
    expect(BEHAVIOUR, "the title must name the dialog").toContain("aria-labelledby");
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
    expect(BEHAVIOUR).toContain("const previousOverflow = document.body.style.overflow");
    expect(BEHAVIOUR).toContain("document.body.style.overflow = previousOverflow");
  });

  it("has no decorative controls that do nothing", () => {
    // It used to draw macOS traffic lights: one real close button and two grey
    // circles with `cursor-not-allowed` — window chrome on something that is
    // not a window, and controls on things that are not controls.
    expect(MODAL_CODE, "a disabled-looking fake control is still a fake control").not.toContain("cursor-not-allowed");
    expect(MODAL_CODE).not.toContain("showTrafficLights");
  });

  it("keeps one implementation of the behaviour, not two", () => {
    // Modal must not re-implement what the hook does; two copies drift, and
    // the copy nobody is looking at is the one that rots.
    expect(MODAL, "Modal should delegate to the hook").toContain("useDialog(");
    const modalOnly = MODAL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(modalOnly, "Modal is trapping focus itself again").not.toContain('e.key !== "Tab"');
    expect(modalOnly, "Modal is locking scroll itself again").not.toContain("document.body.style.overflow");
  });

  it("every full-screen overlay is either a dialog or a status", () => {
    // Ten overlays were a plain <div> over a backdrop: no role, no focus, Tab
    // walking out into the page behind them. An overlay is one of two things —
    // something you interact with, which is a dialog, or something you only
    // read, which is a status — and neither is a bare div.
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules" && e.name !== ".next") walk(full);
          continue;
        }
        if (!e.name.endsWith(".js")) continue;
        const src = fs.readFileSync(full, "utf8");
        if (!src.includes("fixed inset-0 z-50")) continue;
        const rel = path.relative(process.cwd(), full);
        if (rel.endsWith("src/shared/components/Modal.js")) continue;
        const handled =
          src.includes("useDialog") || src.includes('role="status"') || /<Modal\b/.test(src);
        if (!handled) offenders.push(rel);
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(
      offenders,
      `these cover the page with no role, no focus trap and no way back: ${offenders}`
    ).toEqual([]);
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
