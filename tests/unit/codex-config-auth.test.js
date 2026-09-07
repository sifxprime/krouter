import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseTOML, stringifyTOML } from "confbox";

const ROUTE = path.join(process.cwd(), "src/app/api/cli-tools/codex-settings/route.js");
const CARD = path.join(process.cwd(), "src/app/(dashboard)/dashboard/cli-tools/components/CodexToolCard.js");

const readNoComments = (p) => fs.readFileSync(p, "utf-8")
  // Strip comments so our own explanatory prose can't satisfy these assertions.
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
  .join("\n");

// Mirrors the route's helper so the test exercises real serialization.
const setNestedSection = (obj, dottedKey, value) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
};

describe("Codex config carries the key Codex actually reads", () => {
  it("writes the key as an http_headers Authorization bearer, not to auth.json", () => {
    const src = readNoComments(ROUTE);
    expect(src).toContain("http_headers: { Authorization: `Bearer ${apiKey}` }");
    // The POST path must no longer write auth.json -- that clobbers a ChatGPT login
    // and a custom provider never reads it anyway.
    expect(src).not.toContain("authData.OPENAI_API_KEY = apiKey");
    expect(src).not.toContain('authData.auth_mode = "apikey"');
  });

  it("keeps the DELETE repair path that clears a previously written auth.json", () => {
    const src = readNoComments(ROUTE);
    expect(src).toContain("delete authData.OPENAI_API_KEY");
  });

  it("uses the agents.default_subagent_model scalar and clears the legacy table", () => {
    const src = readNoComments(ROUTE);
    expect(src).toContain('setNestedSection(parsed, "agents.default_subagent_model"');
    expect(src).toContain('deleteNestedSection(parsed, "agents.subagent")');
    expect(src).not.toContain('setNestedSection(parsed, "agents.subagent"');
  });

  it("emits valid TOML that round-trips and preserves unrelated agent keys", () => {
    const parsed = parseTOML('model = "old"\n\n[agents]\nsomething = "keep-me"\n');
    setNestedSection(parsed, "model_providers.krouter", {
      name: "kRouter",
      base_url: "http://127.0.0.1:20128/v1",
      wire_api: "responses",
      http_headers: { Authorization: "Bearer sk_test123" },
    });
    setNestedSection(parsed, "agents.default_subagent_model", "gpt-5-mini");

    const out = stringifyTOML(parsed);
    const back = parseTOML(out);

    expect(back.model_providers.krouter.http_headers.Authorization).toBe("Bearer sk_test123");
    expect(back.agents.default_subagent_model).toBe("gpt-5-mini");
    expect(back.agents.something).toBe("keep-me");
    // TOML requires scalars before sub-tables; a bad order makes Codex refuse the file.
    expect(out.indexOf("[model_providers.krouter]")).toBeLessThan(out.indexOf("[model_providers.krouter.http_headers]"));
  });

  it("parses the subagent model back out of the config it writes", () => {
    const card = readNoComments(CARD);
    const written = 'default_subagent_model = "gpt-5-mini"';
    const regexLine = card.match(/subagentModelMatch = codexStatus\.config\.match\((\/.+\/m)\)/);
    expect(regexLine).toBeTruthy();
    // The card must read the same key the route writes, or the UI shows it blank.
    expect(regexLine[1]).toContain("default_subagent_model");
    expect(new RegExp(/^default_subagent_model\s*=\s*"([^"]+)"/m).exec(written)?.[1]).toBe("gpt-5-mini");
  });

  it("no longer offers an auth.json file in the manual config", () => {
    const card = readNoComments(CARD);
    expect(card).not.toContain("OPENAI_API_KEY");
    expect(card).toContain("[model_providers.krouter.http_headers]");
  });
});
