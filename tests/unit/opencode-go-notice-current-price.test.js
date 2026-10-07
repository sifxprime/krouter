/**
 * The OpenCode Go provider card quoted "$5/mo (then $10/mo)". OpenCode ended the
 * first-month discount (anomalyco/opencode #44633, 2026-08-24) and now sells two
 * plans: Go at $10/month and Go Plus at $40/month (https://opencode.ai/docs/go/,
 * https://opencode.ai/go).
 */
import { describe, expect, it } from "vitest";

import { AI_PROVIDERS } from "@/shared/constants/providers";

const notice = () => AI_PROVIDERS["opencode-go"].notice.text;

describe("OpenCode Go provider notice", () => {
  it("quotes the current Go and Go Plus prices", () => {
    expect(notice()).toContain("$10/mo");
    expect(notice()).toContain("$40/mo");
    expect(notice()).toContain("Go Plus");
  });

  it("no longer advertises the ended $5 first month", () => {
    expect(notice()).not.toContain("$5");
  });
});
