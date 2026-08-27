import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const strip = (src) =>
  src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

/**
 * Four defects a user could hit from the dashboard, each found by working the product
 * rather than by running the suite.
 */

describe("Presidio cannot be enabled into a broken state", () => {
  const mw = strip(readFileSync("src/middleware/redaction/middleware.js", "utf8"));
  const route = strip(readFileSync("src/app/api/settings/presidio/route.js", "utf8"));

  it("defaults the sidecar to loopback, not a Compose service name", () => {
    // docker-compose.yml sets SIDECAR_URL explicitly, so the in-code default only ever
    // applied where "presidio-sidecar" cannot resolve -- i.e. every npm install.
    expect(mw).toContain("http://127.0.0.1:5001/redact");
    expect(mw).not.toContain('"http://presidio-sidecar:5001/redact"');
  });

  it("refuses to enable redaction when the sidecar is unreachable", () => {
    // Redaction is fail-closed by design, so enabling it blind 503s every /v1 call.
    expect(route).toContain("SIDECAR_UNREACHABLE");
    expect(route).toMatch(/body\.enabled === true/);
  });
});

describe("MITM certificate card", () => {
  const card = strip(readFileSync("src/app/(dashboard)/dashboard/mitm/CertManagementCard.js", "utf8"));

  it("shows the sudo field before the click, not while the request is in flight", () => {
    // Gating on `busy` meant the input appeared only after the request had already
    // been sent with sudoPassword: undefined, then vanished when busy cleared.
    expect(card).not.toMatch(/showSudoInput\s*=[^;]*busy === "install"/);
    expect(card).toMatch(/showSudoInput\s*=[^;]*\(showInstall \|\| showUninstall\)/);
  });
});

describe("POST /api/import", () => {
  const route = strip(readFileSync("src/app/api/import/route.js", "utf8"));

  it("does not take the directory to read from the request body", () => {
    // body.sourceDir went straight into existsSync/readdirSync/readFileSync with no
    // allow-list or containment check, and the 404 echoed the path back.
    expect(route).not.toContain("body.sourceDir");
    expect(route).toMatch(/const sourceDir = CLI_PROXY_DIR;/);
  });

  it("does not echo the attempted path back to the caller", () => {
    expect(route).not.toMatch(/Directory not found: \$\{sourceDir\}/);
  });
});

describe("database import", () => {
  const db = strip(readFileSync("src/lib/db/index.js", "utf8"));

  it("rejects a payload carrying no recognised section", () => {
    // The only check was "non-array object", so {} wiped six tables and inserted
    // nothing -- every connection, key, pool and combo gone.
    expect(db).toContain("IMPORT_SECTIONS");
    expect(db).toMatch(/present\.length === 0/);
  });

  it("snapshots the database before replacing it", () => {
    expect(db).toContain("pre-import");
    expect(db).toContain("backupFile");
  });

  it("still wipes only inside the transaction, after validation", () => {
    const validateAt = db.indexOf("present.length === 0");
    const wipeAt = db.indexOf("DELETE FROM settings");
    expect(validateAt).toBeGreaterThan(-1);
    expect(wipeAt).toBeGreaterThan(validateAt);
  });
});
