import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { APP_CONFIG } from "../../src/shared/constants/config.js";

/**
 * The product is "kRouter" -- lowercase k, capital R. The sidebar styled its
 * wordmark with `uppercase`, so it rendered "KROUTER" while the login screen,
 * which uses the same APP_CONFIG.name, rendered it correctly. A user spotted
 * the mismatch. CSS must not restyle the brand's capitalisation.
 */
describe("sidebar wordmark", () => {
  const src = readFileSync("src/shared/components/Sidebar.js", "utf8");
  const heading = src.slice(src.indexOf("<h1"), src.indexOf("</h1>"));

  it("keeps the brand's own capitalisation", () => {
    expect(APP_CONFIG.name).toBe("kRouter");
    expect(heading).not.toMatch(/\buppercase\b/);
    expect(heading).not.toMatch(/\bcapitalize\b/);
  });

  it("renders the name from config rather than a hardcoded string", () => {
    expect(heading).toContain("APP_CONFIG.name");
  });
});
