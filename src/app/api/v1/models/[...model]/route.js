import { buildModelsList } from "../route.js";

// URL slug → service kind(s). `web` covers both webSearch and webFetch.
const KIND_SLUG_MAP = {
  "image": ["image"],
  // 0.5.111 — Grok Imagine video. Without this slug, /v1/models/video returns
  // "Unknown model kind" even though the Sidebar links a video page and xai
  // publishes grok-imagine-video with kind "video".
  "video": ["video"],
  "tts": ["tts"],
  "stt": ["stt"],
  "embedding": ["embedding"],
  "image-to-text": ["imageToText"],
  "web": ["webSearch", "webFetch"],
};

const LLM_KIND = "llm";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

function json(data, options = {}) {
  return Response.json(data, {
    ...options,
    headers: {
      "Access-Control-Allow-Origin": "*",
      ...options.headers,
    },
  });
}

/**
 * GET /v1/models/{kind}            - models list filtered by capability.
 * GET /v1/models/{provider}/{model} - single model lookup, OpenAI-compatible.
 *
 * This replaces the former [kind] route rather than sitting beside it: a
 * provider-prefixed id contains a slash, so only a catch-all can capture it, and
 * two dynamic segments at the same level would make which one handles a
 * single-segment path a matter of framework precedence rather than intent.
 */
export async function GET(_request, { params }) {
  try {
    const { model } = await params;
    const path = Array.isArray(model) ? model : [model];
    const identifier = path.filter(Boolean).join("/");
    // Only a single segment can be a kind slug; anything longer is a model id.
    const kindFilter = path.length === 1 ? KIND_SLUG_MAP[identifier] : null;

    if (kindFilter) {
      const data = await buildModelsList(kindFilter);
      return json({ object: "list", data });
    }

    // Match the same LLM catalog exposed by GET /v1/models.
    const models = await buildModelsList([LLM_KIND]);
    const matchedModel = models.find((candidate) => candidate.id === identifier);

    if (!matchedModel) {
      return json(
        {
          error: {
            message: `The model '${identifier}' does not exist or you do not have access to it.`,
            type: "invalid_request_error",
            code: "model_not_found",
          },
        },
        { status: 404 },
      );
    }

    return json(matchedModel);
  } catch (error) {
    console.log("Error fetching model:", error);
    return json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 },
    );
  }
}
