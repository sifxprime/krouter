import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The Cline card said only "Install Cline VS Code extension or CLI" and never
 * which Cline Apply configures. Apply writes ~/.cline/data on the machine
 * running kRouter. The Cline CLI reads it on its next run. The VS Code
 * extension (4.x) shares the folder but loads globalState.json once at startup
 * and rewrites it from memory (apps/vscode/src/shared/storage/ClineFileStorage.ts),
 * so it needs VS Code closed during Apply, or a manual setup in its settings.
 * The manual config also showed the CLI a globalState.json snippet it never
 * reads; `cline auth` is the CLI's own way to set a provider.
 */
const CARD = path.join(process.cwd(), "src/app/(dashboard)/dashboard/cli-tools/components/ClineToolCard.js");

// Strip comments so our own explanatory prose can't satisfy these assertions.
const readNoComments = (p) => fs.readFileSync(p, "utf-8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
  .join("\n");

describe("Cline card says which Cline it configures", () => {
  it("names the folder it writes and both Cline clients", () => {
    const src = readNoComments(CARD);
    expect(src).toContain("~/.cline/data");
    expect(src).toContain("Cline CLI");
    expect(src).toContain("VS Code extension");
  });

  it("tells VS Code users to close VS Code before Apply", () => {
    const src = readNoComments(CARD);
    expect(src).toMatch(/[Qq]uit VS Code|[Cc]lose VS Code/);
  });

  it("explains the manual VS Code setup with the provider and /v1 base URL", () => {
    const src = readNoComments(CARD);
    expect(src).toContain("OpenAI Compatible");
    expect(src).toContain("Base URL");
    expect(src).toContain("Model ID");
  });

  it("offers the cline auth command for the CLI in manual config", () => {
    const src = readNoComments(CARD);
    expect(src).toContain("cline auth --provider openai-compatible");
    expect(src).toContain("--baseurl");
  });
});
