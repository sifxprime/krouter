import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { readFile, access } from "node:fs/promises";
import { validateYamlSyntax } from "@/lib/presidio/validateYaml";
import { writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

// Path to the Presidio configuration file
// This will be on a shared volume between kRouter and Presidio sidecar
// Docker sets PRESIDIO_CONFIG_PATH explicitly (docker-compose.yml maps it to the
// shared presidio-config volume). The fallback matters everywhere else: the old
// default was the container path "/app/redaction_config.yaml", which does not
// exist on an npm install, so saving custom patterns from the dashboard always
// failed with ENOENT. DATA_DIR is the app's own resolver and falls back to
// ~/.krouter, matching how MITM certs and the database are located.
const PRESIDIO_CONFIG_PATH =
  process.env.PRESIDIO_CONFIG_PATH || path.join(DATA_DIR, "presidio", "redaction_config.yaml");

/**
 * GET /api/settings/presidio
 * Retrieves current Presidio sidecar configuration
 */
export async function GET() {
  try {
    // Get toggle states from database
    const settings = await getSettings();

    // Check if YAML file exists
    try {
      await access(PRESIDIO_CONFIG_PATH);
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "CONFIG_NOT_FOUND",
            message: `Presidio configuration file not found at ${PRESIDIO_CONFIG_PATH}`,
          },
        },
        { status: 404, headers: SETTINGS_RESPONSE_HEADERS }
      );
    }

    // Read YAML content
    let yamlContent;
    try {
      yamlContent = await readFile(PRESIDIO_CONFIG_PATH, "utf-8");
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to read configuration file",
            details: error.message,
          },
        },
        { status: 500, headers: SETTINGS_RESPONSE_HEADERS }
      );
    }

    // Build response with toggle states
    const response = {
      success: true,
      data: {
        enabled: settings.presidioEnabled === true,
        piiRedaction: settings.presidioPiiRedaction === true,
        customRegex: settings.presidioCustomRegex === true,
        yamlContent: yamlContent || "",
        yamlPath: PRESIDIO_CONFIG_PATH,
      },
    };

    return NextResponse.json(response, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.error("Error getting Presidio settings:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to retrieve configuration",
          details: error.message,
        },
      },
      { status: 500, headers: SETTINGS_RESPONSE_HEADERS }
    );
  }
}

/**
 * PUT /api/settings/presidio
 * Updates Presidio sidecar configuration
 */
export async function PUT(request) {
  try {
    // A malformed body is a client error, not a server fault, so it gets a 400
    // rather than falling through to the generic 500 handler below.
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid JSON in request body",
            details: error.message,
          },
        },
        { status: 400, headers: SETTINGS_RESPONSE_HEADERS }
      );
    }

    // Validate required fields
    const requiredFields = ["enabled", "piiRedaction", "customRegex"];
    const missingFields = requiredFields.filter((field) => !Object.prototype.hasOwnProperty.call(body, field));

    if (missingFields.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Missing required fields",
            details: `Fields '${missingFields.join(", ")}' are required`,
          },
        },
        { status: 400, headers: SETTINGS_RESPONSE_HEADERS }
      );
    }

    // Validate field types
    if (typeof body.enabled !== "boolean" || typeof body.piiRedaction !== "boolean" || typeof body.customRegex !== "boolean") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid field types",
            details: "Fields 'enabled', 'piiRedaction', 'customRegex' must be booleans",
          },
        },
        { status: 400, headers: SETTINGS_RESPONSE_HEADERS }
      );
    }

    // Validate and update YAML content if provided and customRegex is enabled
    if (body.yamlContent !== undefined) {
      if (typeof body.yamlContent !== "string") {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid yamlContent type",
              details: "yamlContent must be a string",
            },
          },
          { status: 400, headers: SETTINGS_RESPONSE_HEADERS }
        );
      }

      // Validate YAML syntax
      const validation = validateYamlSyntax(body.yamlContent);
      if (!validation.valid) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "INVALID_YAML",
              message: "YAML structure validation failed",
              details: validation.error,
            },
          },
          { status: 400, headers: SETTINGS_RESPONSE_HEADERS }
        );
      }

      // Write the YAML content. Stage it to a sibling temp file first so a
      // failure part-way through a write never leaves the live config
      // truncated, then publish it to the real path.
      // Write atomically: stage to a sibling temp file, then rename over the live
      // path. rename(2) is atomic within a filesystem, so the sidecar's
      // hot-reload watcher never observes a partially written file.
      //
      // The original wrote the temp file, read it back, then wrote the real path
      // in BOTH branches of an if/else, so the check had no effect and nothing
      // was ever renamed despite the comment claiming otherwise.
      try {
        await mkdir(path.dirname(PRESIDIO_CONFIG_PATH), { recursive: true });
        const tempPath = `${PRESIDIO_CONFIG_PATH}.tmp`;
        await writeFile(tempPath, body.yamlContent, "utf-8");
        await rename(tempPath, PRESIDIO_CONFIG_PATH);
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Failed to write configuration file",
              details: error.message,
            },
          },
          { status: 500, headers: SETTINGS_RESPONSE_HEADERS }
        );
      }
    }

    // Redaction is deliberately fail-closed: if the sidecar cannot be reached, the
    // request is rejected rather than forwarded unredacted. That is the right default,
    // but it means turning this on without a reachable sidecar 503s every /v1 call and
    // the dashboard gave no hint that would happen. Refuse the switch instead of
    // letting someone brick their own traffic from a settings page.
    if (body.enabled === true) {
      const sidecarUrl = process.env.SIDECAR_URL || "http://127.0.0.1:5001/redact";
      const healthUrl = sidecarUrl.replace(/\/redact\/?$/, "/health");
      let reachable = false;
      let reason = "";
      try {
        const probe = await fetch(healthUrl, { signal: AbortSignal.timeout(4000) });
        reachable = probe.ok;
        if (!probe.ok) reason = `responded ${probe.status}`;
      } catch (e) {
        reason = e?.name === "TimeoutError" ? "timed out after 4s" : (e?.message || "unreachable");
      }
      if (!reachable) {
        return NextResponse.json(
          {
            error: {
              code: "SIDECAR_UNREACHABLE",
              message: "Presidio sidecar is not reachable — refusing to enable redaction",
              details:
                `Tried ${healthUrl} (${reason}). Redaction fails closed, so enabling it now ` +
                `would reject every /v1 request. Start the sidecar first, or set SIDECAR_URL ` +
                `if it runs elsewhere. Setup: docs/REDACTION_SETUP.md`,
            },
          },
          { status: 409, headers: SETTINGS_RESPONSE_HEADERS }
        );
      }
    }

    // Update database toggle states
    const updateData = {
      presidioEnabled: body.enabled,
      presidioPiiRedaction: body.piiRedaction,
      presidioCustomRegex: body.customRegex,
    };

    await updateSettings(updateData);

    // Read updated YAML content for response
    let updatedYamlContent = "";
    try {
      updatedYamlContent = await readFile(PRESIDIO_CONFIG_PATH, "utf-8");
    } catch (error) {
      updatedYamlContent = body.yamlContent || "";
    }

    const response = {
      success: true,
      data: {
        enabled: body.enabled,
        piiRedaction: body.piiRedaction,
        customRegex: body.customRegex,
        yamlContent: updatedYamlContent,
        yamlPath: PRESIDIO_CONFIG_PATH,
        updatedAt: new Date().toISOString(),
      },
    };

    return NextResponse.json(response, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.error("Error updating Presidio settings:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to update configuration",
          details: error.message,
        },
      },
      { status: 500, headers: SETTINGS_RESPONSE_HEADERS }
    );
  }
}
