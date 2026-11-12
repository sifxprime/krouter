/**
 * The background bootstrap must run when the server starts, not when a page
 * happens to be rendered.
 *
 * `initializeApp` was reachable only as a side effect of importing
 * `app/layout.js`, which Next evaluates while rendering a page. `/login` is
 * prerendered — `○ /login` in the build, `server/app/login.html` in the output —
 * so it is served as static HTML without evaluating the layout, and
 * `/dashboard` is redirected by middleware before it renders. On a boot with
 * nobody signed in, nothing rendered a dynamic page, so none of this ran:
 * MITM auto-start, the watchdog, the network monitor, tunnel auto-resume, the
 * token warmer, background quota refresh.
 *
 * Measured on the published 0.5.186: service up, `/login` 200, `/api/health`
 * 200, `/dashboard` 307 — and not one `[InitApp]` line in four minutes. Port 443
 * stayed down. That is the reported "MITM never comes back after a reboot", and
 * it survived two releases of fixes to the sudo-password key and the start lock
 * because neither was ever reached.
 *
 * With Next's `register()` hook the same boot brings :443 up with zero page
 * loads.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const HOOK = "src/instrumentation.js";
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/shared/services/bootstrap");
  delete process.env.NEXT_RUNTIME;
});

describe("server-start bootstrap", () => {
  it("exists where Next looks for it", () => {
    // Next only honours this file at the project root or directly inside src/.
    // Anywhere else and it is dead code that nothing complains about.
    expect(fs.existsSync(path.join(process.cwd(), HOOK)), `${HOOK} is missing`).toBe(true);
    expect(read(HOOK)).toMatch(/export\s+async\s+function\s+register\s*\(/);
  });

  it("starts the bootstrap on the node runtime", async () => {
    let imported = 0;
    vi.doMock("@/shared/services/bootstrap", () => {
      imported += 1;
      return {};
    });
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("@/instrumentation.js");
    await register();
    expect(imported, "register() must pull in the bootstrap").toBe(1);
  });

  it("does nothing on the edge runtime", async () => {
    // No filesystem, no child processes, no business starting a MITM server.
    let imported = 0;
    vi.doMock("@/shared/services/bootstrap", () => {
      imported += 1;
      return {};
    });
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("@/instrumentation.js");
    await register();
    expect(imported, "the edge runtime must not bootstrap").toBe(0);
  });

  it("is reached by more than a page render", () => {
    // The whole defect in one assertion: if layout.js is the only importer,
    // the bootstrap is gated behind rendering a dynamic page again.
    const importers = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules" && e.name !== ".next") walk(full);
          continue;
        }
        if (!/\.(js|jsx)$/.test(e.name)) continue;
        if (full.endsWith(path.join("services", "bootstrap.js"))) continue;
        if (fs.readFileSync(full, "utf8").includes("services/bootstrap")) {
          importers.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), "src"));

    expect(importers, "nothing imports the bootstrap at all").not.toEqual([]);
    expect(
      importers.some((f) => f === HOOK),
      `only these import it: ${importers.join(", ")} — the server-start hook must be one of them`
    ).toBe(true);
  });

  it("stays safe to reach twice", () => {
    // register() and the layout import can both fire. bootstrap.js has to be
    // the thing that de-duplicates, or a dashboard visit re-runs every
    // interval, watchdog and auto-start the hook already started.
    const bootstrap = read("src/shared/services/bootstrap.js");
    expect(bootstrap, "the global guard is what makes two entry points safe").toContain("__appBootstrapped");
  });
});
