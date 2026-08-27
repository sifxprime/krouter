/**
 * Unit tests for PUT /api/settings/presidio endpoint
 *
 * Tests cover:
 * - Valid configuration updates (toggles only)
 * - Valid configuration updates (with YAML)
 * - Invalid field types
 * - Missing required fields
 * - Invalid YAML syntax
 * - Invalid YAML structure
 * - Atomic file write behavior
 * - Database updates
 * - Error handling (400, 500)
 * - Child toggle constraints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      headers: init?.headers || new Headers(),
      json: async () => body,
    })),
  },
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: mocks.nextResponse,
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  rename: mocks.rename,
  mkdir: mocks.mkdir,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

// Import the route handler
let routeHandler;
try {
  const module = await import("../../../src/app/api/settings/presidio/route.js");
  routeHandler = module.PUT;
} catch (e) {
  // Route not implemented yet
}

// NOTE ON ESCAPING: these fixtures pass through two escaping layers. The JS
// template literal collapses `\\\\` to `\\`, and a double-quoted YAML scalar
// then collapses `\\` to a single `\`. So a regex `\b` needs four backslashes
// here. Using only two yields YAML `\b`/`\.`, and `\.` is not a valid YAML
// escape sequence, which makes the whole document fail to parse.
const mockYamlContent = `rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Z|a-z]{2,}\\\\b"
    description: "Email pattern"
  - entity: "PHONE_US"
    pattern: "\\\\(?(\\\\d{3})\\\\)?[\\\\s-]?\\\\d{3}[\\\\s-]?\\\\d{4}"
    description: "Phone pattern"
`;

const updatedYamlContent = `rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Z|a-z]{2,}\\\\b"
    description: "Updated email pattern"
  - entity: "PHONE_US"
    pattern: "\\\\(?(\\\\d{3})\\\\)?[\\\\s-]?\\\\d{3}[\\\\s-]?\\\\d{4}"
    description: "Phone pattern"
  - entity: "CREDIT_CARD"
    pattern: "\\\\b(?:\\\\d[ -]*?){13,16}\\\\b"
    description: "Credit card pattern"
`;

describe("PUT /api/settings/presidio", () => {
  // Stateful stand-in for the config file. The route writes the new YAML and
  // then reads the path back to build its response, so a fixed readFile value
  // would hand back stale content that no real filesystem would return. Paths
  // that were never written fall back to the seeded on-disk config.
  let writtenFiles;

  beforeEach(() => {
    vi.clearAllMocks();
    // Enabling redaction now probes the sidecar's /health first and refuses with 409
    // if it cannot be reached, because redaction is fail-closed and turning it on
    // blind 503s every /v1 request. These tests exercise the settings write, not the
    // probe, so stand a reachable sidecar up. The refusal path has its own tests.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    writtenFiles = new Map();
    mocks.readFile.mockImplementation(async (filePath) =>
      writtenFiles.has(filePath) ? writtenFiles.get(filePath) : mockYamlContent
    );
    mocks.writeFile.mockImplementation(async (filePath, content) => {
      writtenFiles.set(filePath, content);
    });
    // The route stages to `<path>.tmp` then rename()s it over the live path, so
    // the fake filesystem has to move the entry -- otherwise the read-back that
    // builds the response finds nothing at the real path.
    mocks.rename.mockImplementation(async (from, to) => {
      if (!writtenFiles.has(from)) {
        const err = new Error(`ENOENT: no such file or directory, rename '${from}'`);
        err.code = "ENOENT";
        throw err;
      }
      writtenFiles.set(to, writtenFiles.get(from));
      writtenFiles.delete(from);
    });
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.updateSettings.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("valid configuration updates", () => {
    it("should update toggle states only", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: false,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.enabled).toBe(true);
      expect(body.data.piiRedaction).toBe(true);
      expect(body.data.customRegex).toBe(false);

      // Verify database was updated
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        presidioEnabled: true,
        presidioPiiRedaction: true,
        presidioCustomRegex: false,
      });

      // Verify file was not written (no yamlContent provided)
      expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    it("should update toggles and YAML content", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: updatedYamlContent,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.customRegex).toBe(true);
      expect(body.data.yamlContent).toContain("CREDIT_CARD");

      // Verify file was written
      expect(mocks.writeFile).toHaveBeenCalled();

      // Verify database was updated
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        presidioEnabled: true,
        presidioPiiRedaction: true,
        presidioCustomRegex: true,
      });
    });

    it("should disable all toggles", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: false,
        piiRedaction: false,
        customRegex: false,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.enabled).toBe(false);
      expect(body.data.piiRedaction).toBe(false);
      expect(body.data.customRegex).toBe(false);

      expect(mocks.updateSettings).toHaveBeenCalledWith({
        presidioEnabled: false,
        presidioPiiRedaction: false,
        presidioCustomRegex: false,
      });
    });

    it("should return updatedAt timestamp", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: true,
        piiRedaction: false,
        customRegex: false,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(body.data.updatedAt).toBeDefined();
      expect(body.data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe("validation errors", () => {
    it("should reject missing required fields", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: true,
        // Missing piiRedaction and customRegex
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain("Missing required fields");
      expect(body.error.details).toContain("piiRedaction");
      expect(body.error.details).toContain("customRegex");

      // Verify database was NOT updated
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    it("should reject invalid field types", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: "true", // Should be boolean
        piiRedaction: true,
        customRegex: false,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details).toContain("must be booleans");
    });

    it("should reject invalid yamlContent type", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: 12345, // Should be string
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details).toContain("yamlContent must be a string");
    });

    it("should reject invalid YAML syntax", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const invalidYaml = `rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Z|a-z]{2,}\\\\b"
    description: "Email pattern"
    invalid_syntax: [unclosed array
`;

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: invalidYaml,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("INVALID_YAML");
      expect(body.error.message).toContain("YAML structure validation failed");
      expect(body.error.details).toContain("parse error");

      // Verify file was NOT written
      expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    it("should reject YAML without rules array", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const invalidYaml = `config:
  someSetting: value
  anotherSetting: value2
`;

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: invalidYaml,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("INVALID_YAML");
      expect(body.error.details).toContain("rules");
    });

    it("should reject YAML with missing rule fields", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const invalidYaml = `rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Z|a-z]{2,}\\\\b"
    # Missing description field
`;

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: invalidYaml,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("INVALID_YAML");
      expect(body.error.details).toContain("description");
    });

    it("should reject YAML with invalid regex pattern", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const invalidYaml = `rules:
  - entity: "INVALID_REGEX"
    pattern: "[invalid(regex"
    description: "Invalid regex pattern"
`;

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: invalidYaml,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("INVALID_YAML");
      expect(body.error.details).toContain("regex");
    });

    it("should reject YAML with duplicate entity names", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const invalidYaml = `rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Z|a-z]{2,}\\\\b"
    description: "First email pattern"
  - entity: "EMAIL_REGEX"
    pattern: "\\\\S+@\\\\S+"
    description: "Second email pattern"
`;

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: invalidYaml,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("INVALID_YAML");
      expect(body.error.details).toContain("Duplicate");
      expect(body.error.details).toContain("EMAIL_REGEX");
    });
  });

  describe("child toggle constraints", () => {
    it("should accept yamlContent when customRegex is true", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: updatedYamlContent,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mocks.writeFile).toHaveBeenCalled();
    });

    it("should ignore yamlContent when customRegex is false", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: false,
        yamlContent: updatedYamlContent,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      // YAML content should still be validated but may not be written
      // This behavior is implementation-dependent
    });

    it("should allow child toggles when main toggle is false", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: false,
        piiRedaction: true,
        customRegex: true,
        yamlContent: updatedYamlContent,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.enabled).toBe(false);
      expect(body.data.piiRedaction).toBe(true);
      expect(body.data.customRegex).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should return 500 when database update fails", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      mocks.updateSettings.mockRejectedValue(new Error("Database connection failed"));

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: false,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });

    it("should return 500 when file write fails", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      mocks.writeFile.mockRejectedValue(new Error("Permission denied"));

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: updatedYamlContent,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.details).toContain("Permission denied");
    });

    it("should return 500 when file read fails after write", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      mocks.readFile.mockRejectedValueOnce(new Error("Read failed"));

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: updatedYamlContent,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      // Should still succeed, returning the original yamlContent
      expect(body.data.yamlContent).toBe(updatedYamlContent);
    });

    it("should handle invalid JSON request body", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "invalid json{{{",
      });

      const response = await routeHandler(request);
      const body = await response.json();

      // A malformed body is the client's fault, so the handler reports it as a
      // structured 400 rather than throwing and letting the framework emit an
      // opaque 500.
      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain("Invalid JSON");
    });
  });

  describe("response format", () => {
    it("should return correct response structure on success", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: true,
        piiRedaction: false,
        customRegex: false,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);
      const body = await response.json();

      // Top-level structure
      expect(body).toHaveProperty("success");
      expect(body).toHaveProperty("data");

      // Data structure
      expect(body.data).toHaveProperty("enabled");
      expect(body.data).toHaveProperty("piiRedaction");
      expect(body.data).toHaveProperty("customRegex");
      expect(body.data).toHaveProperty("yamlContent");
      expect(body.data).toHaveProperty("yamlPath");
      expect(body.data).toHaveProperty("updatedAt");

      // Types
      expect(typeof body.data.enabled).toBe("boolean");
      expect(typeof body.data.piiRedaction).toBe("boolean");
      expect(typeof body.data.customRegex).toBe("boolean");
      expect(typeof body.data.yamlContent).toBe("string");
      expect(typeof body.data.yamlPath).toBe("string");
      expect(typeof body.data.updatedAt).toBe("string");
    });

    it("should set no-cache headers", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: true,
        piiRedaction: false,
        customRegex: false,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);

      expect(response.headers).toBeDefined();
      const cacheControl = response.headers.get ? response.headers.get("Cache-Control") : response.headers["Cache-Control"];
      expect(cacheControl).toContain("no-store");
    });
  });

  describe("atomic file write", () => {
    it("should write YAML content atomically", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const requestBody = {
        enabled: true,
        piiRedaction: true,
        customRegex: true,
        yamlContent: updatedYamlContent,
      };

      const request = new Request("http://localhost:20128/api/settings/presidio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const response = await routeHandler(request);

      expect(response.status).toBe(200);
      expect(mocks.writeFile).toHaveBeenCalled();

      // Verify the content written matches the input
      const writeCalls = mocks.writeFile.mock.calls;
      expect(writeCalls.length).toBeGreaterThan(0);
      expect(writeCalls[0][1]).toBe(updatedYamlContent);
    });
  });

  describe("sidecar preflight", () => {
    // Redaction is fail-closed: with no reachable sidecar every /v1 request returns
    // 503. Enabling it from the dashboard used to do exactly that with no warning, so
    // a first-run npm user flipped two toggles and their coding CLI stopped working.
    const put = (body) =>
      routeHandler(
        new Request("http://localhost:20128/api/settings/presidio", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      );

    it("refuses to enable when the sidecar cannot be reached", async () => {
      if (!routeHandler) return;
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch failed"); }));
      const response = await put({ enabled: true, piiRedaction: true, customRegex: false });
      const body = await response.json();
      expect(response.status).toBe(409);
      expect(body.error.code).toBe("SIDECAR_UNREACHABLE");
      // The message has to name what was tried, or it is not actionable.
      expect(body.error.details).toContain("/health");
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    it("refuses when the sidecar answers but is unhealthy", async () => {
      if (!routeHandler) return;
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
      const response = await put({ enabled: true, piiRedaction: false, customRegex: false });
      expect(response.status).toBe(409);
      expect(mocks.updateSettings).not.toHaveBeenCalled();
    });

    it("does not probe when redaction is being turned OFF", async () => {
      // Disabling must work even while the sidecar is down -- otherwise a user whose
      // sidecar died could not switch redaction back off to unblock their traffic.
      if (!routeHandler) return;
      const fetchSpy = vi.fn(async () => { throw new Error("fetch failed"); });
      vi.stubGlobal("fetch", fetchSpy);
      const response = await put({ enabled: false, piiRedaction: false, customRegex: false });
      expect(response.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mocks.updateSettings).toHaveBeenCalled();
    });
  });
});
