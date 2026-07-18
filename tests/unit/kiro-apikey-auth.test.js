import { describe, it, expect } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

describe("v0.5.118 Kiro API-key auth", () => {
  const ex = new KiroExecutor();
  const apiKeyCreds = { accessToken: "ksk_abc123", providerSpecificData: { authMethod: "api_key", profileArn: "arn:aws:codewhisperer:us-east-1:111:profile/X" } };
  const oauthCreds = { accessToken: "aoaAAAA_oauth", providerSpecificData: { authMethod: "google", profileArn: "arn:aws:...:profile/Y" } };

  it("sends tokentype: API_KEY for api-key auth", () => {
    const h = ex.buildHeaders(apiKeyCreds, true);
    expect(h.Authorization).toBe("Bearer ksk_abc123");
    expect(h.tokentype).toBe("API_KEY");
  });

  it("does NOT send tokentype for OAuth auth", () => {
    const h = ex.buildHeaders(oauthCreds, true);
    expect(h.Authorization).toBe("Bearer aoaAAAA_oauth");
    expect(h.tokentype).toBeUndefined();
  });

  it("api-key auth tries *.amazonaws.com hosts FIRST", () => {
    const ordered = ex.getOrderedBaseUrls(apiKeyCreds);
    expect(ordered[0]).toContain("amazonaws.com");
    // the kiro.dev gateway (which rejects API_KEY tokens) must not be first
    expect(ordered[0]).not.toContain("kiro.dev");
  });

  it("OAuth auth keeps the default order (kiro.dev first)", () => {
    const ordered = ex.getOrderedBaseUrls(oauthCreds);
    expect(ordered[0]).toContain("kiro.dev");
  });

  it("buildUrl walks the reordered list for api-key", () => {
    expect(ex.buildUrl("m", true, 0, apiKeyCreds)).toContain("amazonaws.com");
  });
});
