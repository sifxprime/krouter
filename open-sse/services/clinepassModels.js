// 0.5.109 (upstream b08751c4) — ClinePass live model catalog.
//
// ClinePass models all live under the `cline-pass/` namespace on Cline's own
// /models endpoint, alongside Cline's regular models. We filter to that
// namespace so a ClinePass connection only ever advertises what it can serve.
import { buildClineHeaders } from "../../src/shared/utils/clineAuth.js";

const CLINEPASS_MODELS_ENDPOINT = "https://api.cline.bot/api/v1/models";
const FETCH_TIMEOUT_MS = 5000;
const CLINEPASS_MODEL_PREFIX = "cline-pass/";

/**
 * Build headers for the ClinePass /models endpoint.
 *
 * API keys go out as plain Bearer tokens; OAuth access tokens must carry the
 * WorkOS `workos:` prefix, which buildClineHeaders applies for us.
 */
function buildModelListHeaders(token, isApiKey) {
  if (isApiKey) {
    return { Accept: "application/json", Authorization: `Bearer ${token}` };
  }
  return buildClineHeaders(token, { Accept: "application/json" });
}

/**
 * Fetch the live ClinePass catalog.
 *
 * @param {object} credentials - { accessToken, apiKey }
 * @returns {Promise<{ models: { id: string, name: string }[] } | null>}
 */
export async function resolveClinepassModels(credentials) {
  const isApiKey = Boolean(credentials?.apiKey);
  const token = isApiKey ? credentials.apiKey : credentials?.accessToken;
  if (!token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(CLINEPASS_MODELS_ENDPOINT, {
      method: "GET",
      headers: buildModelListHeaders(token, isApiKey),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const json = await response.json();
    const rawList = Array.isArray(json) ? json : json?.data;
    if (!Array.isArray(rawList)) return null;

    const models = rawList
      .filter((m) => typeof m?.id === "string" && m.id.startsWith(CLINEPASS_MODEL_PREFIX))
      .map((m) => ({ id: m.id, name: m.name || m.id }));

    return models.length ? { models } : null;
  } catch {
    // A dead catalog must not break the connection — callers fall back to the
    // static model list.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
