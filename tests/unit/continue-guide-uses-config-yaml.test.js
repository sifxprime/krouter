import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { CLI_TOOLS } from "../../src/shared/constants/cliTools.js";

/**
 * The Continue guide showed a config.json model block ("title", "apiBase",
 * ...). Continue replaced config.json with ~/.continue/config.yaml and marks
 * config.json deprecated (https://docs.continue.dev/reference, migration guide
 * https://docs.continue.dev/reference/yaml-migration: title -> name). The
 * OpenAI-compatible YAML form is provider: openai with an apiBase ending in /v1
 * (https://docs.continue.dev/customize/model-providers/top-level/openai).
 */
const CARD = path.join(process.cwd(), "src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.js");

// DefaultToolCard renders {{baseUrl}} with /v1 appended (asserted below).
const render = (code, { baseUrl, apiKey, model }) =>
  code.replace(/\{\{baseUrl\}\}/g, baseUrl).replace(/\{\{apiKey\}\}/g, apiKey).replace(/\{\{model\}\}/g, model);

describe("Continue guide uses config.yaml", () => {
  const tool = CLI_TOOLS.continue;

  it("shows a YAML block, not the deprecated config.json block", () => {
    expect(tool.codeBlock.language).toBe("yaml");
    expect(tool.codeBlock.code).not.toContain('"title"');
    expect(tool.codeBlock.code).not.toMatch(/^\s*\{/);
  });

  it("points the user at ~/.continue/config.yaml", () => {
    const text = tool.guideSteps.map((s) => `${s.title} ${s.desc || ""}`).join("\n");
    expect(text).toContain("~/.continue/config.yaml");
  });

  it("renders to a valid Continue config.yaml with an OpenAI-compatible model on /v1", () => {
    const out = render(tool.codeBlock.code, {
      baseUrl: "http://localhost:20128/v1",
      apiKey: "sk_krouter",
      model: "cc/claude-sonnet-4-6",
    });
    const config = yaml.load(out);
    expect(config.name).toEqual(expect.any(String));
    expect(config.version).toEqual(expect.any(String));
    expect(config.schema).toBe("v1");
    expect(config.models).toHaveLength(1);
    expect(config.models[0]).toMatchObject({
      provider: "openai",
      model: "cc/claude-sonnet-4-6",
      apiBase: "http://localhost:20128/v1",
      apiKey: "sk_krouter",
    });
    expect(config.models[0].name).toEqual(expect.any(String));
    expect(config.models[0].title).toBeUndefined();
  });

  it("keeps the /v1 suffix the card adds to {{baseUrl}}", () => {
    const src = fs.readFileSync(CARD, "utf-8");
    expect(src).toMatch(/endsWith\("\/v1"\)/);
    expect(src).toContain("`${normalizedBaseUrl}/v1`");
  });
});
