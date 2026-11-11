# kRouter v0.5.169 dev-mode system test

Dev server http://127.0.0.1:20129 running REPO code (0.5.169). Isolated DATA_DIR =
scratchpad/devdata (copy of ~/.krouter db+auth+mitm). The installed 0.5.168 on :20128
and its MITM on :443 were left running and untouched throughout.

Live connections exercised: antigravity (ag), claude-code (cc), kiro (kr) — all paid/real.

## Verdicts

| # | Area | Verdict | Evidence |
|---|------|---------|----------|
| 1 | Boot, health, version | PASS | /api/health {"ok":true}; /api/version currentVersion 0.5.169 |
| 2 | Remote auth on /v1, /v1beta, /codex | PASS | 401 without key from 192.168.0.102 on all three |
| 3 | Host-header spoof (GHSA-pjm4-8fpg-f9p6) | PASS | `Host: localhost` and `Host: 127.0.0.1` still 401 |
| 4 | Forged proxy/trusted-peer headers | PASS | X-Forwarded-For, X-Real-IP, x-9r-trusted-peer all 401 |
| 5 | Local-only routes (sudo/child-process) | PASS | /api/mitm/, /api/mcp/, /api/pxpipe/, /api/headroom/ -> 403 remote |
| 6 | Protected API without session | PASS | /api/settings,keys,providers,combos,usage -> 401 |
| 7 | Model catalog | PASS | 67 models: cc 13, ag 24, kr 30 |
| 8 | OpenAI protocol x 3 providers x stream/non | PASS | 6/6 returned "OK7" |
| 9 | Anthropic protocol x 3 providers x stream/non | PASS | 6/6 returned "OK7" |
| 10 | Gemini protocol x 3 providers x 2 endpoints | PASS (after fix 2) | 6/6 "OK7" |
| 11 | Responses/Codex protocol streaming | PASS | 9-10 `response.*` SSE events per provider |
| 12 | Responses/Codex protocol NON-streaming | FAIL -> FIXED (fix 1) | was object=chat.completion on all 3 providers |
| 13 | /v1beta reachability | FAIL -> FIXED (fix 2) | GET /v1beta/models 404 vs /api/v1beta/models 200 |
| 14 | MITM trust lifecycle (no restart) | PASS | start writes trust on 3 platforms; stop removes nothing; uninstall removes |
| 15 | MITM not hardcoded off | PASS | 4 tools all config-driven with real mitmDomain |
| 16 | Dashboard pages | PASS | /login,/landing 200; dashboard routes 307 to login; no 500s |
| 17 | MITM port configurable | FAIL (finding 3) | src/mitm/server.js LOCAL_PORT = 443 hardcoded |
| 18 | Combos: fallback past a dead entry | PASS | test-fallback 200 "OK7" in 3.9s, skipped the bad id |
| 19 | Combos: multi-provider, nested | PASS | both 200 "OK7"; nesting resolved one level |
| 20 | Combos: all entries dead | PASS | 404 in 0.8s with the last entry's error, no hang |
| 21 | Combos listed in /v1/models | PASS | 67 -> 71 once `kind` was NULL (kind is the service kind, not the strategy — my first rows were wrong, not kRouter) |
| 22 | Tool calling, OpenAI protocol x 3 providers | PASS | 3/3 finish=tool_calls, get_weather {"city":"Dhaka"} |
| 23 | Tool calling, Anthropic protocol x 3 providers | PASS | 3/3 stop=tool_use with correct input |
| 24 | Tool RESULT round trip (2 results) | PASS | "Dhaka: 31C, Tokyo: 12C" — both results used |
| 25 | Vision, cc and kr | PASS | 96x96 solid red -> "Red" (a 1x1 PNG is rejected by Anthropic itself, not by kRouter) |
| 26 | Vision, Antigravity Claude models | FAIL -> FIXED (fix 4) | returned 200 and "no image came through" — silent, billed |
| 27 | Model lock on a 404 | FAIL -> FIXED (fix 3) | 404 then 30 min of 503 "reset after 30m" on a catalog model |
| 28 | Usage tracking | PASS | 114 requests today, per-provider cost split, 295 history + 296 detail rows |
| 29 | Lockfile/version sync | FAIL -> FIXED | their own test caught my version bump without lockfiles |

## Fixes made during this pass (continued)

3. `open-sse/services/accountFallback.js` + `src/sse/handlers/chat.js`, `embeddings.js` —
   a parked model answered 503 "retry after 30m" to what was really a 404. Waiting cannot
   fix a wrong model id, so the client was parked on something that would never change,
   and an actionable error was replaced with an unactionable one. New `parkedAccountStatus`
   reports 404 as itself and keeps the deliberate 0.5.166 503 for 401/403/429/5xx.
   Live: 404 -> 503 -> 503  became  404 -> 404 -> 404, still 0.04s, no Retry-After.
   Three sibling handlers (image/tts/video) already did this; chat and embeddings did not.
   Test: tests/unit/parked-account-status.test.js (20).

4. `open-sse/translator/helpers/geminiHelper.js` + `open-sse/translator/request/openai-to-gemini.js`
   — wrapInCloudCodeEnvelopeForClaude converted Claude blocks to Gemini parts with branches
   for text/tool_use/tool_result and none for images, so every image sent to a Claude model
   on Antigravity was dropped and the call still returned 200. New claudeMediaBlockToGeminiPart
   handles image/document/audio/video, base64 and url.
   Live: "no image came through" -> "Red", on both protocols, tool calling unaffected.
   Test: tests/unit/antigravity-claude-image-blocks.test.js (21).

## Still open, not fixed here

7. `convertOpenAIContentToParts` sends `mimeType: "image/*"` for an http image url, and
   Antigravity 400s on a wildcard image mime. My new helper avoids it; that older path
   still has it.
8. An image inside a Claude `tool_result` is JSON-stringified into the functionResponse
   rather than carried as a media part. Degrades to useless text, does not crash.
9. `usageHistory.apiKey` is stored in plaintext (local DB, needed for per-key attribution).


## Fixes made during this pass

1. `open-sse/handlers/chatCore/nonStreamingHandler.js` — a Responses-API client got a
   `chat.completion` envelope from every provider except OpenAI. Streaming was correct.
   Fixed once as a wrapper so a future provider cannot reopen it.
   Test: tests/unit/responses-client-nonstreaming-envelope.test.js (16; 10 fail pre-fix).

2. `next.config.mjs` — no rewrite existed for `/v1beta`, so every Gemini-protocol client
   404'd even though the route works at `/api/v1beta`. Added, plus the doubled form.
   Verified the new prefix is still key-protected remotely (401), since an unguarded
   rewrite is how `/codex` became exploitable.
   Test: extended tests/unit/rewrite-prefix-coverage.test.js with the converse invariant.

## Open findings not yet fixed

3. `LOCAL_PORT = 443` hardcoded in src/mitm/server.js — a second MITM cannot be started
   for testing without displacing the running one. Testability, not a user-facing bug.
4. ag/ catalog publishes 12 Gemini ids; per the audit's live capture of Google's
   fetchAvailableModels this account is served none of them, and the roster flips with an
   experimentIds A/B, so no hardcoded list can be right. This is the Gemini 404 cause.
5. A model-naming 404 takes a 30-minute, no-failover lock on a healthy model
   (open-sse/config/errorConfig.js). Audit timed it at 30m 00.001s against the live DB.
6. An HTTP 200 whose body is a vendor retirement notice is billed and rendered as the
   model's answer; streamed text is never persisted, so it leaves no trace.

## Gates at the end of the pass

| Gate | Result |
|---|---|
| Full test suite | 3,561 passed / 3,598 (17 expected-fail, 20 skipped) |
| ESLint, changed files | exit 0 |
| ESLint, whole repo | exit 0 |
| `next build` (production) | exit 0, `/v1beta` rewrites present |
| MITM esbuild bundle | 330,328 bytes, 0 relative requires, new code inlined |
| Release | commit c6df0dc2, tag v0.5.169, NOT pushed |

## What I did NOT test, and why

- A real MITM start on :443 — needs root and would displace the MITM you have
  running. The resolver, the CA writer and the trust lifecycle are each covered
  directly instead; `LOCAL_PORT = 443` being hardcoded is what blocks the rest.
- Tunnel / Tailscale endpoints — they change host networking.
- Live MCP plugin traffic — the endpoints are local-only and I confirmed the gate
  (403 remote), not a plugin session.
- Media providers (TTS, STT, video, embeddings) — no credentials configured for
  them on this account, so there was nothing real to prove.
- What a current Claude Desktop build actually sends. Still unverified, and still
  worth settling for free: `MITM_FILE_LOG=1`, one Desktop message, then read
  `model` from `~/.krouter/logs/mitm/*_raw_*.req.json`.
