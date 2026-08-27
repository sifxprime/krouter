import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const strip = (src) =>
  src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

/**
 * Three controls that changed the screen before knowing whether the server agreed, so
 * the UI and the actual state could silently diverge.
 */

describe("provider master toggle", () => {
  const src = strip(readFileSync("src/app/(dashboard)/dashboard/providers/page.js", "utf8"));
  const fn = src.slice(src.indexOf("const handleToggleProvider"), src.indexOf("const handleBatchTest"));

  it("inspects the results it awaits", () => {
    // allSettled was awaited and discarded, so the switch stayed flipped even when
    // every PUT failed — the user believed a provider was disabled while it kept
    // serving traffic.
    expect(fn).toMatch(/const results = await Promise\.allSettled/);
    expect(fn).toMatch(/r\.status !== "fulfilled" \|\| !r\.value\?\.ok/);
  });

  it("rolls the UI back and says so when the writes failed", () => {
    expect(fn).toMatch(/setConnections\(previous\)/);
    expect(fn).toContain("notify.error");
  });
});

describe("MITM DNS toggle", () => {
  const src = strip(readFileSync("src/app/(dashboard)/dashboard/cli-tools/components/MitmToolCard.js", "utf8"));

  it("has no silently-ignored catches left anywhere in the card", () => {
    // saveMappings was a WRITE that neither checked res.ok nor reported a throw, so a
    // model mapping the user had typed could fail to save while the field still showed it.
    expect(src).not.toMatch(/catch \{ \/\* ignore \*\/ \}/);
  });

  it("does not swallow the error it explicitly throws", () => {
    // `throw new Error(data.error ...)` was caught by `catch { /* ignore */ }`, and the
    // modal only closes on success — so a wrong sudo password left an open dialog with
    // nothing to indicate what had happened.
    expect(src).not.toMatch(/catch \{ \/\* ignore \*\/ \}/);
    expect(src).toMatch(/catch \(error\)/);
  });

  it("routes the message to whichever surface the user is looking at", () => {
    expect(src).toMatch(/if \(showPasswordModal\) setModalError\(message\)/);
    expect(src).toContain("setActionError(message)");
    expect(src).toContain("{actionError && (");
  });

  it("keeps the pending action so a retry still works", () => {
    const fn = src.slice(src.indexOf("const doDnsAction"), src.indexOf("const handleConfirmPassword"));
    // Clearing it in `finally` made the second attempt a no-op, so it has to run only
    // on the success path -- i.e. after the try/finally, not inside it.
    const finallyBody = fn.slice(fn.indexOf("} finally {"), fn.indexOf("}", fn.indexOf("} finally {") + 11));
    expect(finallyBody).not.toContain("setPendingDnsAction");
    expect(fn).toContain("setPendingDnsAction(null)");
  });
});

describe("bulk delete of connections", () => {
  const src = strip(readFileSync("src/app/(dashboard)/dashboard/providers/[id]/page.js", "utf8"));

  it("removes only the rows that were actually deleted", () => {
    // The filter dropped every attempted id, so a failed delete vanished from the list
    // while still existing on the server, leaving nothing to retry.
    expect(src).toContain("const deletedIds = []");
    expect(src).toMatch(/prev\.filter\(c => !deletedIds\.includes\(c\.id\)\)/);
    expect(src).not.toMatch(/prev\.filter\(c => !idsToDelete\.includes\(c\.id\)\)/);
  });

  it("leaves the failures selected so they can be retried", () => {
    expect(src).toMatch(/setSelectedConnectionIds\(idsToDelete\.filter/);
  });
});

describe("/v1/models with nothing connected", () => {
  const src = strip(readFileSync("src/app/api/v1/models/route.js", "utf8"));

  it("falls back to the catalogue on failure, not on emptiness", () => {
    expect(src).toContain("connectionsUnavailable");
    expect(src).toMatch(/if \(connectionsUnavailable\)/);
    expect(src).not.toMatch(/if \(connections\.length === 0\) \{[\s\S]{0,120}aliasToProviderId/);
  });
});
