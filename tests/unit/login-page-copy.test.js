import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Assert on code, not on the comments explaining what was removed -- those name the
// old API on purpose. Line-prefix filtering is not enough: a multi-line JSX comment's
// continuation lines carry no marker of their own.
const strip = (src) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")  // {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, "")        // /* ... */
    .replace(/^\s*\/\/.*$/gm, "");             // // ...

/**
 * v0.5.136 turned a default-password remote login into a hard 403 instead of an
 * advisory flag. That was the right call, but it orphaned the "set a new password"
 * form the login page used to show: mustChangePassword now only ever ships alongside
 * that 403, and the page read it inside `if (res.ok)`. The form, its handler and its
 * state became unreachable, while the warning above the login button went on promising
 * "you will be asked to set one when logging in remotely" — which nobody ever is.
 */
describe("login page", () => {
  const raw = readFileSync("src/app/login/page.js", "utf8");
  const src = strip(raw);

  it("no longer carries the unreachable password-change form", () => {
    expect(src).not.toContain("mustChange");
    expect(src).not.toContain("handleSetNewPassword");
    expect(src).not.toContain("setNewPassword");
    expect(src).not.toContain("Set a new password before accessing the dashboard remotely");
  });

  it("does not promise a prompt that never comes", () => {
    expect(raw).not.toContain("You will be asked to set one when logging in remotely");
  });

  it("tells the user what actually happens and where to fix it", () => {
    expect(raw).toContain("Remote logins are refused until you set");
    expect(raw).toMatch(/profile/i);
  });

  it("still handles a successful login and surfaces server errors", () => {
    expect(src).toMatch(/router\.push\("\/dashboard"\)/);
    expect(src).toMatch(/setError\(data\.error/);
  });
});

describe("the API route that made it dead is untouched", () => {
  const route = readFileSync("src/app/api/auth/login/route.js", "utf8");

  it("still refuses a default-password login from off-machine", () => {
    // The 403 is the v0.5.136 security fix; only the dead UI was removed.
    expect(route).toContain("mustChangePassword: true");
    expect(route).toMatch(/status: 403/);
    expect(route).toMatch(/usingDefaultPassword && !isLocalRequest\(request\)/);
  });
});

describe("endpoint security warning", () => {
  const src = readFileSync("src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js", "utf8");

  it("does not claim the endpoint is open when remote callers need a key", () => {
    // A tunnelled request carries X-Forwarded-For, server-peer-patch stamps it
    // via-proxy, and isLocalRequest refuses to call it local — so /v1 already 401s.
    expect(src).not.toContain("your endpoint is publicly accessible without authentication");
  });

  it("names the gap that is actually real", () => {
    expect(src).toContain("forwards without a client-IP header");
  });
});
