// Shared SSE primitives (no imports → safe for executors + stream.js)
export const SSE_DONE = "data: [DONE]\n\n";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive"
};

// Variant for web-cookie executors behind nginx (disable proxy buffering)
export const SSE_HEADERS_NO_BUFFER = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "X-Accel-Buffering": "no"
};

// Variant for client-facing SSE responses (adds permissive CORS)
export const SSE_HEADERS_CORS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*"
};

// Whether a client format terminates an SSE stream with `data: [DONE]`.
//
// Antigravity does not. Google's streamGenerateContent?alt=sse just ends, and
// `agy` parses every data: line as JSON -- so the sentinel makes it fail AFTER
// the answer has rendered, which surfaces as "Agent execution terminated due to
// error" on a turn that visibly worked.
//
// This lives here, as one predicate, because the rule was first applied only in
// stream.js and the bypass path kept emitting it -- the same bug twice, in two
// files, for one client. Every place that terminates a client stream asks this.
//
// Compared as a string rather than importing FORMATS, to keep this module free
// of the translator's import graph.
export function clientWantsDoneSentinel(clientFormat) {
  return clientFormat !== "antigravity";
}
