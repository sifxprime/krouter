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


---

# MITM auto-start on boot (v0.5.185)

## Symptom
After `launchctl kickstart -k`, MITM did not come back. `mitmEnabled: true`,
`hasCachedPassword: true`, and the only trace was
`[InitApp] MITM was enabled but no saved password found, skipping auto-start`.
The watchdog then correctly stripped the DNS redirects, so capture was off.

## Causes (three, all silent)
- [x] 1. `deriveKey()` depended on PATH. `node-machine-id` shells out to `ioreg`
      (/usr/sbin); the LaunchAgent PATH has no /usr/sbin, so the call threw and
      the key silently became `sha256(salt)` instead of `sha256(machineId+salt)`.
      Different key -> GCM auth-tag failure -> "no password saved".
      Fix: derive from the persisted `DATA_DIR/machine-id`; try all historical
      keys on decrypt; memoize (the call ran per attempt, 162 ioreg errors/boot).
- [x] 2. A stale start lock blocked every later start FOREVER. Written O_EXCL,
      removed only on clean paths, and `kickstart -k` is a SIGKILL. Fix: reclaim
      a lock whose holder is dead, with a 2-minute age backstop for pid reuse.
- [x] 3. `lastUsed` stayed a bare date for the first hours of each local day.
      Rollup writes a LOCAL day key, the overlay refines from a UTC timestamp,
      and `new Date("2026-11-13")` is UTC midnight — so at UTC+6 entries from
      00:00-06:00 compared as older than their own day key. Found because this
      session crossed midnight and three existing tests went red on an unchanged
      checkout. Fix: one `isBetterLastUsed` helper across all four buckets, plus
      byTool refined with them.
- [x] 4. `/usr/sbin:/sbin` added to the LaunchAgent PATH (defense in depth).
- [x] 5. The one log line now names which of its four causes fired.

## Evidence
Booted with `env -i PATH=<exact plist PATH>` and a stale lock in place:
    [InitApp] MITM was enabled, auto-starting...
    [MITM] 🔓 Reclaiming a stale start lock (pid 70842, age 357s)
    [MITM] 🚀 Starting server...
    [InitApp] MITM auto-started
    [InitApp] DNS restored from saved state
Port 443 up with no intervention and no sudo prompt; plain curl to
api.anthropic.com captured and answered "AUTOBOOT". ioreg noise 162 -> 1.
Reverting the derivation fails 3 of the new tests, incl. two different keys for
the two PATHs (31b0b6… vs 41c895…). 3788 tests pass, eslint clean.

## Not fixed here
- npm Trusted Publisher is still misconfigured, so every release goes through the
  NPM_TOKEN fallback and gets staged (issue #37). 0.5.183 never drained.
- `next/font` fetches Inter + Space Grotesk from Google at build time, so a
  release build depends on fonts.googleapis.com answering from a CI runner.
