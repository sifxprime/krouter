export const FILTERS = {
  "openrouter-free": (models) =>
    models
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          m.context_length >= 200000
      )
      .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
      .sort((a, b) => b.contextLength - a.contextLength),

  // 0.5.82 — OpenCode's free-tier endpoint (opencode.ai/zen/v1/models) now
  // returns ALL free models with clean IDs (no more "-free" suffix). The old
  // filter was matching zero of the 50 upstream models. Show everything the
  // endpoint returns; if a model is on this endpoint at all, it's free.
  "opencode-free": (models) =>
    (Array.isArray(models) ? models : []).map((m) => ({
      id: m.id,
      name: m.name || m.id,
    })),

  // Xiaomi's free-ai endpoint currently only accepts the "mimo-auto" alias —
  // the other mimo-* names (mimo-v2.5-pro, mimo-v2-omni, mimo-v2-flash, etc.)
  // returned by models.dev belong to the paid Xiaomi Token Plan and respond
  // with HTTP 400 "Not supported model" on the free channel. Surfacing them
  // here would let new users add a non-working model to a combo and have
  // their requests silently fail. Restrict suggestions to the working alias;
  // if Xiaomi expands the free channel we'll add the new ids here too.
  "mimo-free": (models) => {
    const list = Array.isArray(models) ? models : [];
    const fromUpstream = list.find((m) => m?.id === "mimo-auto");
    return [fromUpstream
      ? { id: fromUpstream.id, name: fromUpstream.name || fromUpstream.id }
      : { id: "mimo-auto", name: "MiMo Auto" }];
  },
};
