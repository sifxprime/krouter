import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Docker users must start kRouter with INITIAL_PASSWORD: the default "123456" is
 * refused for any non-loopback login, and under Docker the browser is never
 * loopback. Login accepted INITIAL_PASSWORD, but the first password change only
 * accepted "" or "123456" as the current password -- so a script passing the
 * password it had just logged in with got "Invalid current password".
 */
const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(async (body) => ({ ...body })),
}));
vi.mock("@/lib/localDb", () => mocks);
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));

const { PATCH } = await import("../../src/app/api/settings/route.js");

const patch = (body) =>
  PATCH(new Request("http://localhost/api/settings", { method: "PATCH", body: JSON.stringify(body) }));

describe("first password change (no stored password yet)", () => {
  const saved = process.env.INITIAL_PASSWORD;
  beforeEach(() => {
    mocks.getSettings.mockResolvedValue({});
    mocks.updateSettings.mockClear();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.INITIAL_PASSWORD;
    else process.env.INITIAL_PASSWORD = saved;
  });

  it("accepts INITIAL_PASSWORD as the current password when it is set", async () => {
    process.env.INITIAL_PASSWORD = "choose-a-password";
    const res = await patch({ currentPassword: "choose-a-password", newPassword: "new-secret-1" });
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
  });

  it("rejects 123456 once INITIAL_PASSWORD replaces the default", async () => {
    process.env.INITIAL_PASSWORD = "choose-a-password";
    const res = await patch({ currentPassword: "123456", newPassword: "new-secret-1" });
    expect(res.status).toBe(401);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("still accepts the default 123456 when INITIAL_PASSWORD is not set", async () => {
    delete process.env.INITIAL_PASSWORD;
    const res = await patch({ currentPassword: "123456", newPassword: "new-secret-1" });
    expect(res.status).toBe(200);
  });

  it("still accepts an empty current password, which the Profile page sends", async () => {
    process.env.INITIAL_PASSWORD = "choose-a-password";
    const res = await patch({ currentPassword: "", newPassword: "new-secret-1" });
    expect(res.status).toBe(200);
  });

  it("rejects a wrong current password", async () => {
    process.env.INITIAL_PASSWORD = "choose-a-password";
    const res = await patch({ currentPassword: "guess", newPassword: "new-secret-1" });
    expect(res.status).toBe(401);
  });
});

describe("raw password field", () => {
  beforeEach(() => {
    mocks.getSettings.mockResolvedValue({ password: "$2a$10$storedhashstoredhashstoredhashstoredhashstoredhashstor" });
    mocks.updateSettings.mockClear();
  });

  // The current-password check guards newPassword only; a client could skip it by
  // sending the stored field itself. Only the newPassword path may set it.
  it("never writes a password the client sends directly", async () => {
    const res = await patch({ password: "attacker-chosen", requireLogin: true });
    expect(res.status).toBe(200);
    const written = mocks.updateSettings.mock.calls[0][0];
    expect(written).not.toHaveProperty("password");
    expect(written.requireLogin).toBe(true);
  });
});
