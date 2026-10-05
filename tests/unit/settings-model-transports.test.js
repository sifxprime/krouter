import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * OpenCode Go's protocol toggle is stored as settings.providerModelTransports and
 * decides which upstream endpoint a request goes to, so only known protocols for
 * plausible ids may be stored (#23).
 */
const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({})),
  updateSettings: vi.fn(async (body) => ({ ...body })),
}));
vi.mock("@/lib/localDb", () => mocks);
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));

const { PATCH } = await import("../../src/app/api/settings/route.js");
const patch = (body) =>
  PATCH(new Request("http://localhost/api/settings", { method: "PATCH", body: JSON.stringify(body) }));

describe("settings.providerModelTransports", () => {
  beforeEach(() => mocks.updateSettings.mockClear());

  it("stores only known protocols, per provider", async () => {
    const res = await patch({ providerModelTransports: {
      "opencode-go": { "grok-4.6": "chat", "glm-5.1": "websocket", "kimi-k3": "responses" },
      "": { "x": "chat" },
      "empty": { "y": "nope" },
    } });
    expect(res.status).toBe(200);
    expect(mocks.updateSettings.mock.calls[0][0].providerModelTransports).toEqual({
      "opencode-go": { "grok-4.6": "chat", "kimi-k3": "responses" },
    });
  });

  it("turns a malformed value into an empty map", async () => {
    await patch({ providerModelTransports: ["opencode-go"] });
    expect(mocks.updateSettings.mock.calls[0][0].providerModelTransports).toEqual({});
  });

  it("leaves the setting alone when the request does not mention it", async () => {
    await patch({ requireLogin: true });
    expect(mocks.updateSettings.mock.calls[0][0]).not.toHaveProperty("providerModelTransports");
  });
});
