import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { extractSection, unwrap } = require("../../scripts/release-notes.js");

/**
 * CHANGELOG.md is hard-wrapped for editors. GitHub renders release bodies like
 * comments, where a single newline is a <br>, so the v0.5.161 release page showed
 * 38 forced breaks: ragged half-width paragraphs, worse on a phone. Release notes
 * are now unwrapped -- but only prose; code, tables and headings keep their lines.
 */
const CHANGELOG = `# v2.0.0 (2026-01-02) — newest

**Upgrade now.** First line of a paragraph
continues here
and ends here.

## Fixed

- **A bug.** Wrapped list item
  continued with indentation.
- Second item
  - nested item
    nested continuation

| a | b |
|---|---|
| 1 | 2 |

\`\`\`bash
npm i -g pkg
krouter --help
\`\`\`

Explicit break  
kept.

# v1.0.0 (2026-01-01) — older

Older text.
`;

describe("release notes", () => {
  it("extracts exactly one version's section and its title", () => {
    const s = extractSection(CHANGELOG, "v2.0.0");
    expect(s.title).toBe("v2.0.0 (2026-01-02) — newest");
    expect(s.body).toContain("Explicit break");
    expect(s.body).not.toContain("Older text");
    expect(extractSection(CHANGELOG, "v1.0.0").body.trim()).toBe("Older text.");
  });

  it("does not match a version that only shares a prefix", () => {
    expect(extractSection(CHANGELOG, "v2.0")).toBeNull();
    expect(extractSection(CHANGELOG, "v9.9.9")).toBeNull();
  });

  it("joins wrapped paragraphs and list items into single lines", () => {
    const out = unwrap(extractSection(CHANGELOG, "v2.0.0").body);
    expect(out).toContain("**Upgrade now.** First line of a paragraph continues here and ends here.");
    expect(out).toContain("- **A bug.** Wrapped list item continued with indentation.");
    expect(out).toContain("- Second item\n  - nested item nested continuation");
  });

  it("leaves headings, tables, code fences and explicit breaks alone", () => {
    const out = unwrap(extractSection(CHANGELOG, "v2.0.0").body);
    expect(out).toContain("\n## Fixed\n");
    expect(out).toContain("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(out).toContain("```bash\nnpm i -g pkg\nkrouter --help\n```");
    expect(out).toContain("Explicit break  \nkept.");
  });

  it("leaves no wrapped prose in the real changelog's latest release", () => {
    const real = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
    const tag = real.match(/^# (v\d+\.\d+\.\d+) /m)[1];
    const out = unwrap(extractSection(real, tag).body);
    let inFence = false;
    const wrapped = out.split("\n").filter((line, i, all) => {
      if (line.trimStart().startsWith("```")) inFence = !inFence;
      const next = all[i + 1] ?? "";
      const isProse = (l) => l.trim() !== "" && !/^\s*([-*+] |\d+[.)] |#|\||>|```|<)/.test(l);
      return !inFence && line.trim() !== "" && !/^\s*(#|\|)/.test(line) && !/( {2}|\\)$/.test(line) && isProse(next);
    });
    expect(wrapped).toEqual([]);
  });
});
