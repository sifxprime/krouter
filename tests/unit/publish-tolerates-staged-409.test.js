/**
 * The release must tell "this version is already in flight" apart from "this
 * release failed", and must not call a publish done until npm serves it.
 *
 * npm holds a new publish in a staged state while it validates it. A staged
 * version is not served — `npm view` 404s, so the workflow's own "Check version"
 * step reports it as unpublished — but a second upload of it is refused:
 *
 *   npm error code E409
 *   409 Conflict - PUT .../@sifxprime%2fkrouter
 *   Cannot publish over previously staged version "0.5.183".
 *
 * Failing on that is how v0.5.183's retry reported a publish npm had in fact
 * accepted. And the mirror image bit too: v0.5.185 was reported as released
 * because the publish step went green, while the registry served nothing and
 * `npm install` could not reach it for hours.
 *
 * Measured staging delays on this package: 0.5.184 nine minutes, 0.5.186 seven,
 * 0.5.183 hours, 0.5.185 hours, 0.5.187 and 0.5.188 still staged at the time of
 * writing — every one of them after a green publish.
 *
 * The matcher is exercised as shell, against npm's real output, because a
 * condition that is too loose silently swallows real failures.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const WF = path.join(process.cwd(), ".github/workflows/npm-publish.yml");
const wf = fs.readFileSync(WF, "utf8");

/** The tolerate-or-fail condition, lifted verbatim out of the workflow. */
function toleranceCondition() {
  const start = wf.indexOf("if printf '%s' \"$OUT\" | grep -q 'E409'");
  expect(start, "the staged-409 condition is no longer in the workflow").toBeGreaterThan(-1);
  const end = wf.indexOf("then", start);
  return wf.slice(start + 3, end).trim(); // drop the leading "if "
}

/** Run the real condition under /bin/sh and report whether it tolerated. */
function tolerates(out, version) {
  const cond = toleranceCondition();
  const script = `OUT=$(cat); VERSION="${version}"\nif ${cond}\nthen echo TOLERATE; else echo FAIL; fi`;
  return execFileSync("/bin/sh", ["-c", script], { input: out, encoding: "utf8" }).trim();
}

const stagedFor = (v) => [
  "npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access",
  "npm error code E409",
  `npm error 409 Conflict - PUT https://registry.npmjs.org/@sifxprime%2fkrouter - Cannot publish over previously staged version "${v}".`,
  "npm error A complete log of this run can be found in: /home/runner/.npm/_logs/x.log",
].join("\n");

describe("the staged-409 matcher", () => {
  it("tolerates a staged conflict for the version being released", () => {
    expect(tolerates(stagedFor("0.5.188"), "0.5.188")).toBe("TOLERATE");
  });

  it("fails on a staged conflict for a different version", () => {
    // A 409 naming someone else's version is not this release being in flight.
    expect(tolerates(stagedFor("0.5.183"), "0.5.188")).toBe("FAIL");
  });

  it("fails on a 409 that is not about staging", () => {
    const other = [
      "npm error code E409",
      "npm error 409 Conflict - PUT https://registry.npmjs.org/@sifxprime%2fkrouter - some other conflict",
    ].join("\n");
    expect(tolerates(other, "0.5.188")).toBe("FAIL");
  });

  it("fails on the errors that really are failures", () => {
    const cases = {
      E404: "npm error code E404\nnpm error 404 Not Found - PUT https://registry.npmjs.org/@sifxprime%2fkrouter",
      E403: "npm error code E403\nnpm error 403 Forbidden - PUT ... - You do not have permission to publish",
      EPUBLISHCONFLICT: 'npm error code EPUBLISHCONFLICT\nnpm error Cannot publish over the previously published versions: 0.5.188.',
      ENEEDAUTH: "npm error code ENEEDAUTH\nnpm error need auth This command requires you to be logged in",
      build: "npm error Build failed because of webpack errors",
    };
    for (const [name, out] of Object.entries(cases)) {
      expect(tolerates(out, "0.5.188"), `${name} must still fail the release`).toBe("FAIL");
    }
  });

  it("is not fooled by the version appearing somewhere unrelated", () => {
    // The version number shows up all over npm's output; only the staged-version
    // wording counts.
    const noise = [
      "npm notice package: @sifxprime/krouter@0.5.188",
      "npm error code E409",
      'npm error 409 Conflict - Cannot publish over previously staged version "0.5.99".',
    ].join("\n");
    expect(tolerates(noise, "0.5.188")).toBe("FAIL");
  });
});

describe("the serve gate", () => {
  it("exists and runs after the publish", () => {
    const pub = wf.indexOf("- name: Publish");
    const gate = wf.indexOf("- name: Wait until npm actually serves the version");
    expect(gate, "the gate is missing").toBeGreaterThan(-1);
    expect(gate, "the gate must run after the publish").toBeGreaterThan(pub);
  });

  it("asks the registry for the exact version, past any cache", () => {
    const gate = wf.slice(wf.indexOf("- name: Wait until npm actually serves the version"));
    expect(gate, "a stale 404 from a CDN edge reads as a far longer delay").toContain("Cache-Control: no-cache");
    expect(gate, "it must check the version document, not just the packument").toContain("krouter/$VERSION");
    expect(gate, "only a 200 counts as served").toContain('"200"');
  });

  it("fails the job if the version never becomes installable", () => {
    // The point of the gate. A green release whose version cannot be installed
    // is what made v0.5.185 look shipped when it was not.
    const gate = wf.slice(wf.indexOf("- name: Wait until npm actually serves the version"));
    expect(gate).toMatch(/::error::.*has not served it/);
    expect(gate).toContain("exit 1");
  });

  it("gives the job more time than the gate can spend waiting", () => {
    // The gate and the job timeout are coupled, and nothing connects them in the
    // file. Raising the wait to 75m under a 30m job timeout would have had GitHub
    // cancel the job mid-wait, so the release failed for the single reason the
    // gate exists to report accurately.
    const yaml = require("js-yaml");
    const doc = yaml.load(wf);
    const job = doc.jobs.publish["timeout-minutes"];
    const gate = Number(wf.match(/TIMEOUT_MINUTES:\s*"(\d+)"/)[1]);
    expect(job, "the publish job must have a timeout").toBeTruthy();
    expect(job, `job timeout ${job}m must exceed the ${gate}m wait plus the build`).toBeGreaterThan(gate + 20);
  });

  it("waits long enough not to fail merely slow releases", () => {
    // Observed on this package: nine minutes, seven minutes, and hours. A short
    // timeout would open a failure issue for a release that was fine.
    const m = wf.match(/TIMEOUT_MINUTES:\s*"(\d+)"/);
    expect(m, "the timeout must stay configurable in one place").toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(15);
  });
});

describe("the workflow file itself", () => {
  it("is valid YAML", async () => {
    // Added because the suite went green while this file was syntactically
    // broken: a continuation line of a shell string sat at column 0 and ended
    // the `run: |` block scalar. Every other test here reads the file as text,
    // so none of them noticed, and GitHub would only have said so on the next
    // tag — after the release was already cut.
    const yaml = await import("js-yaml");
    const load = yaml.default?.load ?? yaml.load;
    const doc = load(wf);

    expect(doc.jobs.publish, "the publish job must exist").toBeTruthy();
    const names = doc.jobs.publish.steps.map((s) => s.name).filter(Boolean);
    expect(names).toContain("Publish");
    expect(names).toContain("Wait until npm actually serves the version");
    // The gate has to run after the publish, not merely exist.
    expect(names.indexOf("Wait until npm actually serves the version"))
      .toBeGreaterThan(names.indexOf("Publish"));
  });

  it("every run step is valid shell", () => {
    // `sh -n` parses without executing. A stray quote or an unbalanced if/fi in
    // a release script is otherwise found by running a release.
    const yaml = require("js-yaml");
    const doc = yaml.load(wf);
    for (const [jobName, job] of Object.entries(doc.jobs)) {
      for (const step of job.steps || []) {
        if (!step.run) continue;
        // GitHub expands ${{ }} before the shell sees it; substitute something
        // inert so the parse reflects the real script shape.
        const script = step.run.replace(/\$\{\{[^}]*\}\}/g, "X");
        expect(
          () => execFileSync("/bin/sh", ["-n"], { input: script, stdio: ["pipe", "ignore", "pipe"] }),
          `${jobName} / ${step.name || "unnamed"} is not valid shell`
        ).not.toThrow();
      }
    }
  });
});
