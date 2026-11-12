# Usage attribution: record the intercepted MITM tool

## Problem
A request captured from Kiro/Antigravity is booked under the *serving provider*
(`claude`), because the MITM rewrites the model before calling the router. So
usage reads "kiro: 1 request, 18h ago" while Kiro is demonstrably being
captured. The intercepted tool is known at interception time
(`decideRoute().tool`) and then thrown away.

## Found while investigating (separate bug, proven)
One streaming request writes TWO `usageHistory` rows. `finalizeStream`
(open-sse/utils/stream.js) calls `logUsage` -> `saveRequestUsage`, and also
calls `onStreamComplete` -> `saveUsageStats` -> `saveRequestUsage`.
Evidence: rows 2576/2577, same tokens 44/161, 1ms apart; the `logUsage` row has
an empty `endpoint`, the `saveUsageStats` row has `/v1/chat/completions`.
=> totalRequests, byProvider, byModel, cost and the lifetime counter are ~2x for
streaming. Must be fixed or `byTool` inherits the same inflation.

## Plan
- [x] 1. Shared contract in `src/shared/constants/mitmToolHosts.js`:
      `MITM_TOOL_HEADER`, `MITM_TOOLS`, `normalizeMitmTool()` (validates against
      the known tool list - the header arrives from a client and is untrusted).
- [x] 2. `src/mitm/handlers/base.js` `fetchRouter`: strip any client-supplied
      copy of the header (STRIP_HEADERS, case-insensitive), then set it from
      `getToolForHost(clientHeaders.host)` - the same derivation that chose the
      handler, so no second source of truth.
- [x] 3. Router reads it: helper `mitmToolFromRequest(clientRawRequest)`;
      `saveUsageStats` gains `tool`; 4 call sites pass it.
- [x] 4. Storage + aggregation in `src/lib/db/repos/usageRepo.js`:
      write `meta={tool}` (column is currently a dead `{}`), add `day.byTool`,
      surface `byTool` in BOTH `getUsageStats` paths, and add `meta` to the
      raw-row SELECT (it is not selected today).
- [x] 5. Fix the double write in `open-sse/utils/stream.js` without losing the
      fallback: `logUsage` keeps the console line; the DB write happens once.
- [x] 6. Unit tests: header derivation, spoof rejection, aggregation, no-tool
      rows unaffected.
- [x] 7. Live verify against the dev server with a MITM-shaped request.

## Review
Shipped as two separate changes.

**1. Tool attribution.** The MITM derives the tool from the host that already
chose the handler and sends it as `x-krouter-mitm-tool`; the router validates it
against the known tool list, stores it in the previously-dead `meta` column, and
aggregates it into `byTool` keyed `tool|model|provider` (like `byEndpoint`), so a
tool breaks down by the model that actually served it. Surfaced in the API for
all periods, in `getUsageHistory` as a `tool` field, and in the dashboard as a
new "Usage by Captured Tool" view.

`byTool` is deliberately NOT a partition of the day: only captured requests have
a tool. An empty table there next to a busy byModel now means "capture is off",
which is the distinction the old stats could not express.

**2. The double count.** Fixed: `logUsage` no longer writes a row when
`onStreamComplete` will, and keeps the write when nothing else records. Measured
before: 1 streaming request -> 2 rows. After: 1 row.

### Evidence
- 3778 tests pass (12 new), eslint clean on every changed file.
- Live, dev server, real provider: one labelled streaming request wrote exactly
  one row, `meta={"tool":"kiro"}`, where the same request wrote two rows with
  `meta={}` before.
- `byTool` agrees across both independent aggregation paths (raw-row scan for
  today/24h, usageDaily rollup for 7d): 3 captured requests in each.
- A forged `x-krouter-mitm-tool: evil-corp` was dropped (`meta={}`) and the
  request still served normally.

### Not verified
- The dashboard view itself. /dashboard requires a login and I do not handle the
  user's password, so the new table was never rendered on screen - it is covered
  by lint, the production build, and the API data behind it, not by eyes.
- The MITM half ran as unit tests only; proving it live needs a rebuilt MITM
  bundle, i.e. a release.

### Known gap
The stream path with no `onStreamComplete` still records tool-less, because that
code has no client request in scope. It is the degraded path (nothing else
tracks the stream at all), so it counts the request but cannot attribute it.

