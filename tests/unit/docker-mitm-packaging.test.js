import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * The MITM server runs as a separate spawned Node process, so Next's file
 * tracing does not cover it — anything it requires must be physically COPYed
 * into the runner image. A require that escapes src/mitm without a matching
 * COPY produces MODULE_NOT_FOUND at runtime, which surfaces to the user as
 * "MITM server failed to start" and cannot be caught by any JS test that only
 * runs in the repo, where the file is obviously present.
 */

const ROOT = process.cwd();

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

/** Every relative require in src/mitm that resolves outside src/mitm. */
function escapingRequires() {
  const escapes = [];
  for (const file of walk(path.join(ROOT, "src/mitm"))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      const abs = path.resolve(path.dirname(file), m[1]);
      const rel = path.relative(ROOT, abs);
      if (!rel.startsWith("src/mitm")) {
        escapes.push({ from: path.relative(ROOT, file), target: rel });
      }
    }
  }
  return escapes;
}

/** Source paths the runner stage copies out of the builder. */
function dockerCopiedPaths() {
  const df = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  const runner = df.slice(df.lastIndexOf("AS runner"));
  return [...runner.matchAll(/^COPY\s+--from=builder\s+(\S+)/gm)]
    .map((m) => m[1].replace(/^\/app\//, ""))
    .filter((p) => !p.startsWith(".next") && !p.startsWith("node_modules"));
}

describe("Docker image ships everything the MITM child process requires", () => {
  it("every file required from src/mitm exists in the repo", () => {
    for (const e of escapingRequires()) {
      const ok = existsSync(path.join(ROOT, e.target)) || existsSync(path.join(ROOT, `${e.target}.js`));
      expect(ok, `${e.from} requires ${e.target}, which does not exist`).toBe(true);
    }
  });

  it("every require escaping src/mitm is covered by a Dockerfile COPY", () => {
    const copied = dockerCopiedPaths();
    const uncovered = escapingRequires().filter(
      (e) => !copied.some((c) => e.target === c || e.target.startsWith(`${c}/`)),
    );
    expect(
      uncovered.map((e) => `${e.target} (required by ${e.from})`),
      "Dockerfile runner stage does not COPY these, so the MITM server will fail " +
        "with MODULE_NOT_FOUND in the container",
    ).toEqual([]);
  });
});
