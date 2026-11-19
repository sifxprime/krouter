import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { withRedaction } from "@/middleware/redaction/index.js";
import { getSettings, getApiKeys } from "@/lib/localDb";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * POST /api/dashboard/chat/completions — the Chat page's backend.
 *
 * BasicChatPageClient has posted here since it was written, and this route did
 * not exist: not in any release, not anywhere in git history. Every send came
 * back 404, which the page rendered as "Request failed (404)". 0.5.193 made the
 * page reachable from the nav; it still could not send a message, because the
 * endpoint underneath it was never written.
 *
 * It is deliberately the same shape as /v1/chat/completions — same handler, same
 * redaction wrapper, so the Chat page gets the same routing, failover and PII
 * handling as every other client. It exists separately only because of how the
 * two are authorised. /v1 is the public LLM API and is keyed. This is dashboard
 * surface: dashboardGuard's deny-by-default already required a session (or the
 * CLI token) before the request got here, so the browser authenticates as itself
 * and sends no API key.
 */
async function withServerApiKey(request) {
  // handleChat only demands a key when the operator has turned requireApiKey on.
  // The browser has none to give — it authenticated with a session cookie — so
  // borrow a stored one rather than let that setting break the operator's own
  // dashboard.
  //
  // This widens nothing: anything that can reach this route has already cleared
  // the same gate as /api/keys, which hands out the keys themselves.
  if (request.headers.get("Authorization")) return request;

  let settings;
  try {
    settings = await getSettings();
  } catch {
    return request;
  }
  if (!settings?.requireApiKey) return request;

  let key;
  try {
    const keys = await getApiKeys();
    key = keys?.find((k) => k?.key && (k.isActive === true || k.isActive === 1))?.key;
  } catch {
    return request;
  }
  // No usable key: pass the original through so handleChat answers with its own
  // 401, instead of this route inventing a different failure for the same cause.
  if (!key) return request;

  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${key}`);
  return new Request(request.url, {
    method: "POST",
    headers,
    body: await request.text(),
  });
}

export const POST = withRedaction(async (request) => {
  await ensureInitialized();
  return await handleChat(await withServerApiKey(request));
});
