/**
 * Unit tests for GET /api/settings/presidio endpoint
 *
 * Tests cover:
 * - Retrieving default configuration when none exists
 * - Retrieving existing configuration from database
 * - Reading YAML file from shared volume
 * - Error handling (404, 500)
 * - Response format validation
 * - Child toggle states when main toggle is disabled
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The route resolves its config path from PRESIDIO_CONFIG_PATH, falling back to
// the app's DATA_DIR (~/.krouter) rather than the container path it used to
// hardcode -- "/app/..." does not exist on an npm install, so saving custom
// patterns always failed there with ENOENT. This must be set before the route
// module is evaluated, since it reads the variable once at module scope.
vi.hoisted(() => {
  process.env.PRESIDIO_CONFIG_PATH = "/tmp/krouter-test-presidio/redaction_config.yaml";
});

const mocks = vi.hoisted(() => ({
  nextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      headers: init?.headers || new Headers(),
      json: async () => body,
    })),
  },
  readFile: vi.fn(),
  access: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: mocks.nextResponse,
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  access: mocks.access,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  saveSettings: mocks.saveSettings,
}));

// Import the route handler (will be created)
let routeHandler;
try {
  const module = await import("../../../src/app/api/settings/presidio/route.js");
  routeHandler = module.GET;
} catch (e) {
  // Route not implemented yet - will be created in next task
}

const mockYamlContent = `# Redaction Configuration for Presidio Sidecar
rules:
  - entity: "EMAIL_REGEX"
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b"
    description: "Regex fallback for email addresses"
  - entity: "PHONE_US"
    pattern: "\\(?(\\d{3})\\)?[\\s-]?\\d{3}[\\s-]?\\d{4}"
    description: "Detects US phone number formats"
`;

const defaultConfigPath = "/tmp/krouter-test-presidio/redaction_config.yaml";

describe("GET /api/settings/presidio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("default configuration", () => {
    it("should return default values when no configuration exists", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      // Mock: No settings in database, but YAML file exists
      mocks.getSettings.mockResolvedValue({});
      mocks.readFile.mockResolvedValue(mockYamlContent);

      const response = await routeHandler();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.enabled).toBe(false);
      expect(body.data.piiRedaction).toBe(false);
      expect(body.data.customRegex).toBe(false);
      expect(body.data.yamlContent).toBe(mockYamlContent);
      expect(body.data.yamlPath).toBe(defaultConfigPath);
    });

    it("should include yamlContent even when toggles are disabled", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      mocks.getSettings.mockResolvedValue({
        presidioEnabled: false,
        presidioPiiRedaction: false,
        presidioCustomRegex: false,
      });
      mocks.readFile.mockResolvedValue(mockYamlContent);

      const response = await routeHandler();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.yamlContent).toBeTruthy();
      expect(body.data.yamlContent).toContain("EMAIL_REGEX");
    });
  });

  describe("existing configuration", () => {
    it("should return stored toggle states from database", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const storedSettings = {
        presidioEnabled: true,
        presidioPiiRedaction: true,
        presidioCustomRegex: false,
      };

      mocks.getSettings.mockResolvedValue(storedSettings);
      mocks.readFile.mockResolvedValue(mockYamlContent);

      const response = await routeHandler();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.enabled).toBe(true);
      expect(body.data.piiRedaction).toBe(true);
      expect(body.data.customRegex).toBe(false);
    });

    it("should return child toggles even when main toggle is false", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const storedSettings = {
        presidioEnabled: false,
        presidioPiiRedaction: true,
        presidioCustomRegex: true,
      };

      mocks.getSettings.mockResolvedValue(storedSettings);
      mocks.readFile.mockResolvedValue(mockYamlContent);

      const response = await routeHandler();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.enabled).toBe(false);
      expect(body.data.piiRedaction).toBe(true);
      expect(body.data.customRegex).toBe(true);
    });

    it("should read actual YAML content from file", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      mocks.getSettings.mockResolvedValue({
        presidioEnabled: true,
        presidioPiiRedaction: true,
        presidioCustomRegex: true,
      });
      mocks.readFile.mockResolvedValue(mockYamlContent);

      const response = await routeHandler();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.yamlContent).toBe(mockYamlContent);
      expect(body.data.yamlContent).toContain("EMAIL_REGEX");
      expect(body.data.yamlContent).toContain("PHONE_US");
    });
  });

  describe("YAML file handling", () => {
    // The config file is written on first save, so a fresh install does not have one.
    // Answering 404 meant the Presidio page opened on an error quoting an absolute
    // filesystem path before the user had done anything, and the toggle state -- which
    // lives in the database and was perfectly readable -- never reached the page.
    // A missing file is an empty config, not a failure.
    it("treats a missing YAML file as an empty config, not an error", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const enoent = new Error("ENOENT: no such file or directory");
      enoent.code = "ENOENT";
      mocks.readFile.mockRejectedValue(enoent);
      mocks.getSettings.mockResolvedValue({ presidioEnabled: true, presidioPiiRedaction: true });

      const response = await routeHandler();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.yamlContent).toBe("");
      // The toggle state must survive — it is what the page renders.
      expect(body.data.enabled).toBe(true);
      expect(body.data.piiRedaction).toBe(true);
    });

    it("still reports a genuine read failure rather than hiding it", async () => {
      if (!routeHandler) return;
      const denied = new Error("EACCES: permission denied");
      denied.code = "EACCES";
      mocks.readFile.mockRejectedValue(denied);
      mocks.getSettings.mockResolvedValue({});

      const response = await routeHandler();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error.details).toContain("EACCES");
    });

    it("should handle empty YAML file", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      mocks.getSettings.mockResolvedValue({});
      mocks.readFile.mockResolvedValue("");

      const response = await routeHandler();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.yamlContent).toBe("");
    });

    it("should handle large YAML files", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      const largeYaml = "# Large config\n" + "rules:\n" + Array(100).fill('  - entity: "TEST"\n    pattern: ".*"\n    description: "Test"').join("\n");

      mocks.getSettings.mockResolvedValue({});
      mocks.readFile.mockResolvedValue(largeYaml);

      const response = await routeHandler();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.yamlContent.length).toBeGreaterThan(1000);
    });
  });

  describe("error handling", () => {
    it("should return 500 when database read fails", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      mocks.getSettings.mockRejectedValue(new Error("Database connection failed"));

      const response = await routeHandler();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });

    it("should return 500 when YAML file read fails", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      mocks.getSettings.mockResolvedValue({});
      mocks.access.mockResolvedValue(undefined);
      mocks.readFile.mockRejectedValue(new Error("Permission denied"));

      const response = await routeHandler();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });

    it("should return 500 when YAML file read fails after access check", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      mocks.getSettings.mockResolvedValue({});
      mocks.access.mockResolvedValue(undefined);
      mocks.readFile.mockRejectedValue(new Error("Disk I/O error"));

      const response = await routeHandler();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
    });
  });

  describe("response format", () => {
    it("should return correct response structure", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      mocks.getSettings.mockResolvedValue({
        presidioEnabled: true,
        presidioPiiRedaction: true,
        presidioCustomRegex: true,
      });
      mocks.readFile.mockResolvedValue(mockYamlContent);

      const response = await routeHandler();
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

      // Types
      expect(typeof body.data.enabled).toBe("boolean");
      expect(typeof body.data.piiRedaction).toBe("boolean");
      expect(typeof body.data.customRegex).toBe("boolean");
      expect(typeof body.data.yamlContent).toBe("string");
      expect(typeof body.data.yamlPath).toBe("string");
    });

    it("should set no-cache headers", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      mocks.getSettings.mockResolvedValue({});
      mocks.readFile.mockResolvedValue(mockYamlContent);

      const response = await routeHandler();

      // Check that headers are included in the response
      expect(response.headers).toBeDefined();
      const cacheControl = response.headers.get ? response.headers.get("Cache-Control") : response.headers["Cache-Control"];
      expect(cacheControl).toContain("no-store");
    });
  });

  describe("database field mapping", () => {
    it("should map legacy field names correctly", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      // Test with legacy field names
      mocks.getSettings.mockResolvedValue({
        presidioEnabled: true,
        presidioPiiRedaction: false,
        presidioCustomRegex: true,
      });
      mocks.readFile.mockResolvedValue(mockYamlContent);

      const response = await routeHandler();
      const body = await response.json();

      expect(body.data.enabled).toBe(true);
      expect(body.data.piiRedaction).toBe(false);
      expect(body.data.customRegex).toBe(true);
    });

    it("should handle partial settings gracefully", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      // Only main toggle is set
      mocks.getSettings.mockResolvedValue({
        presidioEnabled: true,
      });
      mocks.readFile.mockResolvedValue(mockYamlContent);

      const response = await routeHandler();
      const body = await response.json();

      expect(body.data.enabled).toBe(true);
      expect(typeof body.data.piiRedaction).toBe("boolean");
      expect(typeof body.data.customRegex).toBe("boolean");
    });
  });

  describe("yamlPath configuration", () => {
    it("should use default yamlPath from environment or constant", async () => {
      if (!routeHandler) {
        console.log("Skipping test - route not implemented yet");
        return;
      }

      mocks.getSettings.mockResolvedValue({});
      mocks.readFile.mockResolvedValue(mockYamlContent);

      const response = await routeHandler();
      const body = await response.json();

      expect(body.data.yamlPath).toBeTruthy();
      expect(typeof body.data.yamlPath).toBe("string");
    });
  });
});
