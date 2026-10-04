#!/usr/bin/env node
// Prints one version's CHANGELOG.md section as GitHub release notes.
//
// CHANGELOG.md is hard-wrapped for reading in an editor. GitHub renders release
// bodies like comments, where a single newline is a <br>, so wrapped prose shows
// as ragged half-width lines. Paragraphs and list items are joined back into
// single lines; headings, tables, code fences, HTML and explicit breaks
// (two trailing spaces or a backslash) keep their lines.
//
// Usage: node scripts/release-notes.js <tag> [--title] [CHANGELOG.md]
//   prints the notes, or with --title the release title; exits 1 if the tag has
//   no section.
"use strict";

const fs = require("fs");

const VERSION_HEADING = /^# v\d/;
// A line that starts its own block instead of continuing the one above it.
const BLOCK_START = /^\s*([-*+] |\d+[.)] |#|\||>|```|<|(-{3,}|\*{3,}|_{3,})\s*$)/;
// A line whose end must stay a line end.
const HARD_END = /^\s*(#|\||<|```|(-{3,}|\*{3,}|_{3,})\s*$)|( {2}|\\)$/;

function extractSection(changelog, tag) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l === `# ${tag}` || l.startsWith(`# ${tag} `));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => VERSION_HEADING.test(l));
  return {
    title: lines[start].slice(2),
    body: (end === -1 ? rest : rest.slice(0, end)).join("\n"),
  };
}

function unwrap(markdown) {
  const out = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    const isFence = line.trimStart().startsWith("```");
    const prev = out.length ? out[out.length - 1] : "";
    const continues =
      !inFence && !isFence &&
      line.trim() !== "" && prev.trim() !== "" &&
      !BLOCK_START.test(line) && !HARD_END.test(prev);
    if (continues) out[out.length - 1] = `${prev.trimEnd()} ${line.trim()}`;
    else out.push(line);
    if (isFence) inFence = !inFence;
  }
  return out.join("\n").trim() + "\n";
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const wantTitle = args.includes("--title");
  const [tag, file = "CHANGELOG.md"] = args.filter((a) => a !== "--title");
  if (!tag) {
    console.error("Usage: node scripts/release-notes.js <tag> [--title] [CHANGELOG.md]");
    process.exit(2);
  }
  const section = extractSection(fs.readFileSync(file, "utf8"), tag);
  if (!section) {
    console.error(`No "# ${tag}" section in ${file}`);
    process.exit(1);
  }
  process.stdout.write(wantTitle ? `${section.title}\n` : unwrap(section.body));
}

module.exports = { extractSection, unwrap };
