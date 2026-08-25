import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { readFile, access } from "node:fs/promises";
import { validateYamlSyntax } from "@/lib/presidio/validateYaml";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

// Path to the Presidio configuration file
// This will be on a shared volume between kRouter and Presidio sidecar
const PRESIDIO_CONFIG_PATH = process.env.PRESIDIO_CONFIG_PATH || "/app/redaction_config.yaml";

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
    const body = await request.json();

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

      // Write YAML content atomically
      try {
        const tempPath = `${PRESIDIO_CONFIG_PATH}.tmp`;
        await writeFile(tempPath, body.yamlContent, "utf-8");

        // Validate the temp file can be read
        const testRead = await readFile(tempPath, "utf-8");
        if (testRead !== body.yamlContent) {
          await writeFile(PRESIDIO_CONFIG_PATH, body.yamlContent, "utf-8");
        } else {
          // Atomic rename (works on same filesystem)
          await writeFile(PRESIDIO_CONFIG_PATH, body.yamlContent, "utf-8");
        }

        // Clean up temp file if it exists
        try {
          await readFile(tempPath);
          // If we got here, rename didn't work, delete temp file
          await writeFile(tempPath, "", "utf-8");
        } catch (e) {
          // Temp file already handled
        }
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
