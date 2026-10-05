import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * /api/settings/database exports and imports the whole database -- provider
 * credentials and the dashboard password hash included -- so it asks for the
 * password again even inside a dashboard session. The kRouter CLI may skip that
 * with its token, but the route only checked that the x-9r-cli-token header
 * EXISTED: a session sending "x-9r-cli-token: junk" exported the database with no
 * password (reproduced against the published 0.5.161 image: HTTP 200).
 */
const mocks = vi.hoisted(() => ({
  exportDb: vi.fn(async () => ({ settings: {} })),
  importDb: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({})),
  verifyDashboardPassword: vi.fn(async (pw) => pw === "right-password"),
}));
vi.mock("@/lib/localDb", () => ({ exportDb: mocks.exportDb, importDb: mocks.importDb, getSettings: mocks.getSettings }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardPassword: mocks.verifyDashboardPassword }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn(async () => "real-cli-token16") }));

const { GET, POST } = await import("../../src/app/api/settings/database/route.js");
const get = (headers) => GET(new Request("http://localhost/api/settings/database", { headers }));
const post = (headers, body) =>
  POST(new Request("http://localhost/api/settings/database", { method: "POST", headers, body: JSON.stringify(body) }));

describe("database export/import step-up", () => {
  beforeEach(() => { mocks.exportDb.mockClear(); mocks.importDb.mockClear(); });

  it("refuses export with a junk CLI token and no password", async () => {
    expect((await get({ "x-9r-cli-token": "junk" })).status).toBe(401);
    expect(mocks.exportDb).not.toHaveBeenCalled();
  });

  it("refuses import with a junk CLI token and no password", async () => {
    expect((await post({ "x-9r-cli-token": "junk" }, { settings: {} })).status).toBe(401);
    expect(mocks.importDb).not.toHaveBeenCalled();
  });

  it("lets the real CLI token export without a password", async () => {
    expect((await get({ "x-9r-cli-token": "real-cli-token16" })).status).toBe(200);
  });

  it("lets the correct password export", async () => {
    expect((await get({ "x-9r-password": "right-password" })).status).toBe(200);
  });
});
