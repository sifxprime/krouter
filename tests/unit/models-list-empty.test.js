import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * buildModelsList fell back to the full static catalogue whenever
 * `connections.length === 0`. The comment beside it said "DB unavailable", but that
 * condition is equally true for a first-run user who simply has nothing connected yet —
 * so their /v1/models advertised hundreds of models, every one of which fails when
 * called, and their coding CLI showed a full model picker with no working choice.
 *
 * "The query threw" and "the query returned no rows" are different answers.
 */

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getDisabledModels: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => mocks);

let buildModelsList;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.getCombos.mockResolvedValue([]);
  mocks.getCustomModels.mockResolvedValue([]);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getDisabledModels.mockResolvedValue([]);
  mocks.getSettings.mockResolvedValue({});
  ({ buildModelsList } = await import("../../src/app/api/v1/models/route.js"));
});

describe("buildModelsList with no providers connected", () => {
  it("returns nothing rather than the whole catalogue", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    const models = await buildModelsList(["llm"]);
    expect(Array.isArray(models)).toBe(true);
    // The bug produced hundreds here.
    expect(models.length).toBe(0);
  });

  it("still falls back to the catalogue when the query actually fails", async () => {
    // That fallback exists so the endpoint answers something when the database is
    // unreadable; keying it on failure keeps that behaviour.
    mocks.getProviderConnections.mockRejectedValue(new Error("database is locked"));
    const models = await buildModelsList(["llm"]);
    expect(models.length).toBeGreaterThan(0);
  });

  it("treats every-connection-inactive the same as none", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: 1, provider: "kiro", isActive: false },
    ]);
    const models = await buildModelsList(["llm"]);
    expect(models.length).toBe(0);
  });
});
