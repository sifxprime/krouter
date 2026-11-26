#!/usr/bin/env node
/**
 * Dump the raw model ids an Antigravity account can see, straight from Google's
 * v1internal:fetchAvailableModels — the authoritative source for the *wire* model
 * id, which is not always kRouter's catalog id.
 *
 * Why this exists: kRouter sends `model.upstreamModelId || model.id` on the wire.
 * When a tiered entry (e.g. `gemini-4-argon-high`) has no `upstreamModelId`, the
 * `-high` suffix goes to Google verbatim and every call 404s ("Requested entity
 * was not found"). The fix is to set `upstreamModelId` to the *real* wire id — and
 * the only way to know it for sure is to ask the account, which is what this does.
 * See providerModels.js and issue #42.
 *
 * Reads a connected antigravity account's token from the local kRouter DB
 * (~/.krouter/db/data.sqlite, or $DATA_DIR). Read-only. Never prints the token.
 *
 *   node scripts/antigravity/dump-models.mjs          # all ids, gemini-4 family flagged
 *   node scripts/antigravity/dump-models.mjs --json    # raw JSON of data.models
 */
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DATA_DIR = process.env.DATA_DIR && !/^\//.test(process.env.DATA_DIR) === false
  ? process.env.DATA_DIR
  : path.join(os.homedir(), ".krouter");
const DB_PATH = path.join(DATA_DIR, "db", "data.sqlite");

// Request shape mirrors open-sse/services/usage.js getAntigravityUsage exactly.
const QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
const USER_AGENT = "GitHubCopilotChat/0.26.7";

function openDb() {
  try {
    const Better = require("better-sqlite3");
    return { kind: "better", db: new Better(DB_PATH, { readonly: true, fileMustExist: true }) };
  } catch {
    // sql.js fallback (what a pure-JS install uses)
    return null; // keep it simple; better-sqlite3 ships with the dev + default install
  }
}

function readAntigravityConn() {
  const h = openDb();
  if (!h) { throw new Error("better-sqlite3 not available; run from the repo or a default install"); }
  const row = h.db
    .prepare("SELECT email, data FROM providerConnections WHERE provider='antigravity' AND isActive=1 ORDER BY priority ASC LIMIT 1")
    .get();
  if (!row) throw new Error("no active antigravity connection in the DB — add one in the dashboard first");
  const data = JSON.parse(row.data);
  if (!data.accessToken) throw new Error("connection has no accessToken");
  return { email: row.email, accessToken: data.accessToken, projectId: data.projectId || data.project || null };
}

async function fetchModels(accessToken, projectId) {
  const res = await fetch(QUOTA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      "X-Client-Name": "antigravity",
      "X-Client-Version": "1.107.0",
      "x-request-source": "local",
    },
    body: JSON.stringify(projectId ? { project: projectId } : {}),
  });
  const text = await res.text();
  if (res.status === 403) {
    throw new Error(
      "403 PERMISSION_DENIED on fetchAvailableModels. This account can chat but " +
      "cannot query the models/quota API (a known per-account limitation). Run this " +
      "from an account that has the model you need; chat-only accounts can't enumerate.",
    );
  }
  if (!res.ok) throw new Error(`fetchAvailableModels HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  const wantJson = process.argv.includes("--json");
  const conn = readAntigravityConn();
  process.stderr.write(`account: ${conn.email}  project: ${conn.projectId || "(none)"}\n`);

  const data = await fetchModels(conn.accessToken, conn.projectId);
  const models = data.models || data.availableModels || [];

  if (wantJson) { console.log(JSON.stringify(models, null, 2)); return; }

  const ids = models.map((m) => (typeof m === "string" ? m : (m.modelId || m.id || m.name))).filter(Boolean);
  console.log(`\n${ids.length} models visible to this account:\n`);
  for (const id of ids.sort()) {
    const flag = /gemini-4|argon|neon|carbon/i.test(id) ? "  <-- gemini-4 family" : "";
    console.log(`  ${id}${flag}`);
  }
  const g4 = ids.filter((i) => /gemini-4|argon|neon|carbon/i.test(i));
  console.log(`\ngemini-4 wire ids: ${g4.length ? g4.join(", ") : "(none served to this account)"}`);
  console.log("These are the strings to use as upstreamModelId in providerModels.js.\n");
}

main().catch((e) => { process.stderr.write(`\nERROR: ${e.message}\n`); process.exit(1); });
