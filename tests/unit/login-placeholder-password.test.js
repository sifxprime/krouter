import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * v0.5.136 refused remote logins on the public default "123456". But once
 * INITIAL_PASSWORD was set -- to anything -- that guard stepped aside, and
 * kRouter's own docs showed INITIAL_PASSWORD=change-me (.env.example) and
 * "your-first-login-password" (website deploy guide). Pasted verbatim, those are
 * as public as 123456, so they now get the same treatment: local logins only.
 */
const mocks = vi.hoisted(() => ({
  isLocal: false,
  getSettings: vi.fn(async () => ({})),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock("@/lib/auth/dashboardSession", () => ({ setDashboardAuthCookie: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: vi.fn(() => false) }));
vi.mock("@/lib/auth/loginLimiter", () => ({
  checkLock: vi.fn(() => ({ locked: false })),
  recordFail: vi.fn(() => ({ locked: false })),
  recordSuccess: vi.fn(),
  getClientIp: vi.fn(() => "203.0.113.7"),
}));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: vi.fn(() => mocks.isLocal) }));

const { POST } = await import("../../src/app/api/auth/login/route.js");
const login = (password) =>
  POST(new Request("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }));

describe("login with a placeholder INITIAL_PASSWORD", () => {
  const saved = process.env.INITIAL_PASSWORD;
  beforeEach(() => { mocks.isLocal = false; });
  afterEach(() => {
    if (saved === undefined) delete process.env.INITIAL_PASSWORD;
    else process.env.INITIAL_PASSWORD = saved;
  });

  for (const placeholder of ["change-me", "your-first-login-password", "...", "your-password", "Your-Secure-Password ", "tu-contraseña"]) {
    it(`refuses a remote login when INITIAL_PASSWORD is the documented placeholder ${JSON.stringify(placeholder)}`, async () => {
      process.env.INITIAL_PASSWORD = placeholder;
      const res = await login(placeholder);
      expect(res.status).toBe(403);
    });
  }

  it("still allows that login from the machine kRouter runs on", async () => {
    process.env.INITIAL_PASSWORD = "change-me";
    mocks.isLocal = true;
    expect((await login("change-me")).status).toBe(200);
  });

  it("allows a remote login with a real INITIAL_PASSWORD", async () => {
    process.env.INITIAL_PASSWORD = "Zq3v9MSpYw4u1bNc8tHd2kLe";
    expect((await login("Zq3v9MSpYw4u1bNc8tHd2kLe")).status).toBe(200);
  });
});
