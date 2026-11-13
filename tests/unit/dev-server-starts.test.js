/**
 * `next dev` has to actually serve a page.
 *
 * It did not, on every route, from v0.5.187 until this. That release added
 * src/instrumentation.js so the background bootstrap runs when the SERVER
 * starts rather than when somebody finally renders a dynamic page. Correct
 * fix, but instrumentation is compiled for every runtime, and the chain
 *
 *   src/instrumentation.js
 *     -> @/shared/services/bootstrap
 *       -> initializeApp -> src/lib/db/driver.js
 *         -> better-sqlite3 -> require('fs')
 *
 * has no answer in the edge runtime. Under the legacy `--webpack` bundler that
 * is a hard resolve failure, so dev served HTTP 500 for every page:
 *
 *   Module not found: Can't resolve 'fs'
 *   Import trace: ./node_modules/better-sqlite3/lib/database.js ...
 *                 ./src/shared/services/bootstrap.js
 *                 ./src/instrumentation.js
 *
 * The `process.env.NEXT_RUNTIME !== "nodejs"` guard inside register() cannot
 * help: it runs at RUNTIME, and this fails at COMPILE time. Turbopack — Next
 * 16's default, which is why the flag is legacy — resolves it per runtime and
 * serves the app normally. Verified both ways: moving instrumentation.js aside
 * made webpack dev work, and switching bundlers made it work with the file in
 * place.
 *
 * `build` deliberately stays on `--webpack`: the production build was never
 * affected (it is verified green) and the release pipeline ships from it, so
 * there is no reason to move it here.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
const scripts = pkg.scripts || {};

const devScripts = Object.entries(scripts).filter(
  ([name]) => name === "dev" || name.startsWith("dev:")
);

describe("dev scripts", () => {
  it("exist", () => {
    expect(devScripts.length).toBeGreaterThan(0);
  });

  it("do not use the legacy bundler", () => {
    // Keeping --webpack here reinstates a 500 on every dev page.
    const broken = devScripts.filter(([, cmd]) => cmd.includes("--webpack"));
    expect(
      broken.map(([n]) => n),
      "these would 500 on every route — instrumentation.js cannot be compiled for the edge runtime by webpack"
    ).toEqual([]);
  });

  it("still run next dev", () => {
    for (const [name, cmd] of devScripts) {
      expect(cmd, `${name} should invoke next dev`).toContain("next dev");
    }
  });
});

describe("the preview server", () => {
  // `.claude/launch.json` is local editor config and is gitignored (.gitignore
  // line 82), so it does not exist on CI. The first version of these checks
  // read it unconditionally and went red the moment it ran anywhere but this
  // machine. Everything that actually matters is assertable from package.json
  // and src/, which are committed; the launch config is cross-checked only
  // when it happens to be present.
  const proxyPort = Number(
    fs
      .readFileSync(path.join(process.cwd(), "src/mitm/proxy.js"), "utf8")
      .match(/DEFAULT_PROXY_PORT\s*=\s*(\d+)/)[1]
  );

  const portOf = (script) => {
    const m = (scripts[script] || "").match(/--port\s+(\d+)/);
    return m ? Number(m[1]) : null;
  };

  it("reads a real proxy port to compare against", () => {
    expect(Number.isFinite(proxyPort)).toBe(true);
  });

  it("does not sit on the MITM proxy's port", () => {
    // It pointed at 20129, which is DEFAULT_PROXY_PORT, so it could never
    // start while proxy capture was running — and capture is on by default
    // once the MITM server is started.
    expect(portOf("dev:preview"), "preview must not bind the proxy's port").not.toBe(proxyPort);
    expect(portOf("dev"), "nor must the main dev server").not.toBe(proxyPort);
  });

  it("does not fight the main dev server for a port", () => {
    const main = portOf("dev");
    const preview = portOf("dev:preview");
    expect(main, "dev must declare a port").toBeTruthy();
    expect(preview, "dev:preview must declare a port").toBeTruthy();
    expect(preview, "the two dev servers cannot share a port").not.toBe(main);
  });

  it("agrees with the local launch config when there is one", () => {
    const file = path.join(process.cwd(), ".claude/launch.json");
    if (!fs.existsSync(file)) return; // gitignored: absent on CI, and that is fine
    const launch = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const cfg of launch.configurations) {
      expect(cfg.port, `${cfg.name} must not bind the proxy's port`).not.toBe(proxyPort);
    }
    const cfg = launch.configurations.find((c) => c.name === "krouter-dev");
    if (cfg) {
      expect(portOf("dev:preview"), "launch.json and dev:preview disagree").toBe(cfg.port);
    }
  });
});
