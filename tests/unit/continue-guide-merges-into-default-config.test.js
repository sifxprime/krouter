import { describe, it, expect } from "vitest";
import * as yaml from "js-yaml";
import { CLI_TOOLS } from "../../src/shared/constants/cliTools.js";

/**
 * Continue creates ~/.continue/config.yaml on first use
 * (https://docs.continue.dev/customize/deep-dives/configuration) as
 * YAML.stringify(defaultConfig), whose models is [] (continuedev/continue
 * core/config/default.ts, core/util/paths.ts getConfigYamlPath). So the usual
 * file ends in `models: []`. The guide said "Existing file: add only the entry
 * under models:", and an entry added under `models: []` is invalid YAML
 * ("bad indentation of a mapping entry"), so Continue cannot load the config.
 */
const CONTINUE_DEFAULT_FILE = "name: Main Config\nversion: 1.0.0\nschema: v1\nmodels: []\n";

const render = (code) => code
  .replace(/\{\{baseUrl\}\}/g, "http://localhost:20128/v1")
  .replace(/\{\{apiKey\}\}/g, "sk_krouter")
  .replace(/\{\{model\}\}/g, "cc/claude-sonnet-4-6");

const tool = CLI_TOOLS.continue;
const block = render(tool.codeBlock.code);
const modelsSection = block.slice(block.indexOf("models:"));
const modelEntry = modelsSection.slice(modelsSection.indexOf("\n") + 1);
const mergeStep = tool.guideSteps.find((s) => s.title === "Add Model Config");

const expectKRouterModel = (model) => expect(model).toMatchObject({
  provider: "openai",
  model: "cc/claude-sonnet-4-6",
  apiBase: "http://localhost:20128/v1",
  apiKey: "sk_krouter",
});

describe("Continue guide merges into the default config.yaml", () => {
  it("the old instruction (entry under `models: []`) is what breaks", () => {
    expect(() => yaml.load(`${CONTINUE_DEFAULT_FILE}${modelEntry}\n`)).toThrow();
  });

  it("tells the user what to do with the default `models: []` line", () => {
    expect(mergeStep.desc).toContain("models: []");
    expect(mergeStep.desc).toMatch(/replace/i);
  });

  it("replacing `models: []` with the block's models section parses", () => {
    const merged = CONTINUE_DEFAULT_FILE.replace("models: []\n", `${modelsSection}\n`);
    const config = yaml.load(merged);
    expect(config.name).toBe("Main Config");
    expect(config.models).toHaveLength(1);
    expectKRouterModel(config.models[0]);
  });

  it("adding the entry under a models: list that already has entries parses", () => {
    const existing = "name: Main Config\nversion: 1.0.0\nschema: v1\nmodels:\n  - name: Local\n    provider: ollama\n    model: qwen3\n";
    const config = yaml.load(`${existing}${modelEntry}\n`);
    expect(config.models).toHaveLength(2);
    expectKRouterModel(config.models[1]);
  });
});
