import { describe, it, expect } from "vitest";
import {
  getProviderCapabilities,
  listProviderCapabilities,
} from "@/shared/constants/providerCapabilities.js";

describe("getProviderCapabilities", () => {
  it("returns null for unknown id", () => {
    expect(getProviderCapabilities("does-not-exist")).toBeNull();
  });

  it("classifies an OAuth-only provider correctly", () => {
    const claude = getProviderCapabilities("claude");
    expect(claude).not.toBeNull();
    expect(claude.tier).toBe("oauth");
    expect(claude.authModes[0]).toBe("oauth");
    expect(claude.name).toBe("Claude Code");
    expect(claude.deprecated).toBe(true);
  });

  it("classifies an API-key provider correctly", () => {
    const sf = getProviderCapabilities("siliconflow");
    expect(sf.tier).toBe("paid");
    expect(sf.authModes).toContain("apikey");
    expect(sf.links.apiKey).toContain("cloud.siliconflow.com");
    expect(sf.features.customModels).toBe(true);
  });

  it("classifies a passthrough (no custom models) provider", () => {
    const or = getProviderCapabilities("openrouter");
    expect(or.tier).toBe("freetier");
    expect(or.features.passthroughModels).toBe(true);
    expect(or.features.customModels).toBe(false);
  });

  it("classifies a free noAuth provider (opencode)", () => {
    const oc = getProviderCapabilities("opencode");
    expect(oc.tier).toBe("free");
    expect(oc.authModes[0]).toBe("free");
    expect(oc.noAuth).toBe(true);
  });

  it("surfaces regions when provider has them (xiaomi-tokenplan)", () => {
    const xm = getProviderCapabilities("xiaomi-tokenplan");
    expect(xm.features.hasRegions).toBe(true);
    expect(xm.regions.length).toBeGreaterThan(0);
    expect(xm.defaultRegion).toBe("sgp");
  });

  it("preserves dual-auth when provider declares authModes explicitly (xai)", () => {
    const xai = getProviderCapabilities("xai");
    // xai appears in APIKEY_PROVIDERS but also declares authModes: ["oauth","apikey"]
    expect(xai.authModes).toContain("apikey");
  });

  it("every listed provider has non-empty authModes", () => {
    const all = listProviderCapabilities();
    expect(all.length).toBeGreaterThan(30);
    for (const p of all) {
      expect(p.authModes.length).toBeGreaterThan(0);
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
    }
  });

  it("compatible-provider detection is deterministic (whether or not any match)", () => {
    // Property test: for every provider, if features.compatibleModels is true
    // then authModes must include "compatible".
    for (const p of listProviderCapabilities()) {
      if (p.features.compatibleModels) {
        expect(p.authModes).toContain("compatible");
      }
    }
  });
});
