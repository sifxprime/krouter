# kRouter ← decolua/9router upstream-sync plan

Assessed: upstream **v0.5.45 → v0.5.50** (2026-07-23 → 2026-08-05), ~60 new commits, by 5 parallel
review passes judging each against our fork (no provider-registry / `translator/concerns/` /
`usage/` refactors; two-alias-map catalog; JS; `~/.krouter` data dir).

**Frontier:** we last synced upstream at ~2026-07-10. Mid-July commits (Grok Imagine video,
Copilot `/v1/messages`, token-saver bypass header, bulk-add fix) are already our v0.5.111–v0.5.114.

**Verdict tally:** ~40 PORT · ~20 SKIP · 3 ALREADY-HAVE. Plus one **local security fix that is our own
bug, not an upstream port** (MITM) — this is Phase 0.

---

## Phase 0 — MITM token-leak fix (SECURITY — ship first, standalone)

**Not an upstream port. Our own shipped bug.**

`src/mitm/server.js:17` → `const ENABLE_FILE_LOG = true;` ("temporarily enabled for Antigravity auth
debugging") has been hardcoded `true` since the first MITM commit and is a `const` (no runtime off).

| | Before | After |
|---|---|---|
| Auth tokens | Full request headers incl. `authorization` written to `~/.krouter/logs/mitm/*.req.json` — live Google/Antigravity Bearer, Kiro AWS SigV4, Copilot, Anthropic tokens on disk (a file from today contains one) | Logging **off by default**; when explicitly enabled, sensitive headers **redacted** |
| Disk | 91 MB / 4,282 files, grows every few seconds while Antigravity polls (cleanup only runs at startup) | Zero dump files by default; pruned/size-capped when on |
| Hot path | Full response buffered in RAM + synchronous `fs.writeFileSync` per request (incl. SSE streams) | No dump work on the default path |

**Fix**
1. `src/mitm/server.js:17` → `const ENABLE_FILE_LOG = process.env.DEBUG_MITM === "1" || process.env.MITM_FILE_LOG === "1";` (reuse the `DEBUG_MITM` var already used in `src/mitm/handlers/base.js`).
2. `src/mitm/logger.js` `dumpRequest` — redact `authorization`, `x-api-key`, `api-key`, `cookie`, `x-amz-security-token`, `x-amzn-*` before write (defense-in-depth).
3. Prune/size-cap the dump dir instead of clear-at-start only.
4. **User action (I don't hard-delete):** `rm -rf ~/.krouter/logs/mitm/*`; rotate any long-lived keys (Kiro `ksk_`, Anthropic, Copilot) seen there. OAuth access tokens self-expire (~1h).

**Verify:** default build → no new dump files while Antigravity runs; chat still streams, alias-rewrite still applied (`server.js:442`). `DEBUG_MITM=1` → dumps reappear but `grep '"authorization"'` finds nothing.

---

## Phase 1 — Safe correctness fixes (LOW risk, batchable, targeted verify)

Small, additive, no auth/identity semantics. Land in 2–3 commits, each verified by one request.

| # | upstream | fix | file(s) | risk |
|---|---|---|---|---|
| 1 | `0afe9493` | Strip `stream_options` on non-stream (Google rejects it) — add to `ANTIGRAVITY_REQUEST_BLACKLIST` | `executors/antigravity.js:37` | LOW |
| 2 | `2abe8b85` | Strip 6 JSON-Schema keywords Gemini has no field for (`multipleOf`, `uniqueItems`, `contains`, `unevaluated*`, `contentSchema`) — one occurrence 400s the request | `translator/helpers/geminiHelper.js` | LOW |
| 3 | `e3e3e235` | Fill orphan `{}` left after `$ref`/`$defs` strip (Vertex/Antigravity reject empty schema node) | `translator/helpers/geminiHelper.js` | LOW |
| 4 | `a7941dda` | Don't drop an image-only user message (was Anthropic 400 "at least one message required") — add `image`/`document` to `hasValidContent` | `translator/helpers/claudeHelper.js:8` | LOW |
| 5 | `c97963c4` | Forward `service_tier` through OpenAI→Responses (was silently dropped) | `translator/request/openai-responses.js` | LOW |
| 6 | `9173c29b` | Drop `temperature` for **all** Claude models, not just opus-4 (Anthropic 400 on compat routes) | `translator/helpers/paramSupport.js:20` | LOW-MED |
| 7 | `41606a37` | Forced-SSE→JSON path lost cached prompt tokens — fold cache counters into `prompt_tokens`, re-attach `usage` | `handlers/chatCore/sseToJsonHandler.js` | MED |
| 8 | `cd13d904` | Detect current `codex-tui`/Codex Desktop (+`originator` header) as native Codex → keeps lossless passthrough | `utils/clientDetector.js:46` | LOW |
| 9 | `ae4f76c4` | Redirect already-logged-in users away from `/login` (expose `authenticated`) | `api/auth/status/route.js`, `login/page.js` | LOW |
| 10 | `4f48ab8c` | Spread params into better-sqlite3 `.run/.get/.all` — defensive/consistency (NOT an active crash on our pinned 12.10.1; verified) | `lib/db/adapters/betterSqliteAdapter.js` | LOW |
| 11 | `57b3b2c1` | Add `Cache-Control: no-transform` + `X-Accel-Buffering: no` so proxies don't buffer the console-log SSE | `api/translator/console-logs/stream/route.js` | LOW |
| 12 | `c85a5c57` | Persist exact embedding tokens (we currently save none) | `handlers/embeddingsCore.js`, `src/sse/handlers/embeddings.js` | LOW-MED |
| 13 | `02c66fe2` | Auto-provision a "Default Key" for first-time users so `/v1` works out of the box | `dashboard/endpoint/EndpointPageClient.js` | LOW |

---

## Phase 2 — Auth / identity / quota path (LIVE end-to-end verify — higher value)

These touch credentials, headers, or account selection. Each ships alone with a real curl/login proof.

| # | upstream | before → after | file(s) | risk |
|---|---|---|---|---|
| 1 | `13ed1456` **+** `6acc3bb9` | **Cross-account header leak.** A global `claudeHeaderCache` overlays the last-seen Claude Code client's identity headers (`anthropic-beta`, `user-agent`, `x-stainless-*`) onto **every later request** → one account/client's identity bleeds onto another sharing the server. After: per-request `selectAnthropicBeta(model)`, no global cache; `anthropic-version` header lowercased to avoid duplication | `utils/claudeHeaderCache.js` (del), `executors/default.js`+`base.js`, `config/providers.js`, `src/sse/handlers/chat.js` | **HIGH** |
| 2 | `35f86e58` | **AG project provisioning.** We send `X-Goog-Api-Client`/`Client-Metadata` on `loadCodeAssist`/`onboardUser`; Google fingerprints them and silently refuses to provision a `cloudaicompanionProject`. After: slim header set + real Antigravity IDE UA. **Touches the v0.5.119 rotation path** | `config/appConstants.js`, `services/projectId.js`, `src/lib/oauth/services/antigravity.js` | MED |
| 3 | `c06cc084` | **All interactive OAuth logins break on Windows** — `open` is eagerly imported and webpack breaks its `import.meta.url`. After: mark `open` external | `next.config.mjs`, `cli/scripts/build-cli.js` | LOW |
| 4 | `aa0448f7` | xAI/grok-cli issue a **new refresh_token each refresh**; retry 2/3 reuses a consumed RT → `invalid_grant`. After: thread the rotated RT through retries — **adapted to respect our v0.5.x credential-immutability** (local `workingCreds`, NOT upstream's in-place mutation) | `handlers/chatCore.js` (~L447) | MED |
| 5 | `3292dfc1` | GitHub Copilot 402 "additional usage limit" is monthly, but we only model-cooldown it. After: account-wide lock until 1st-of-month UTC. **Additive** — our v0.5.119 parking is `resetsAtMs`-driven, 6h-capped, doesn't cover this | `src/sse/services/auth.js` | MED |
| 6 | `d587b2a4` | Codex `/models` uses a static `client_version=1.0.0` below the gate → newest models silently filtered. After: current `client_version` + `originator` + OAuth-refresh-aware sync (dashboard-only) | `api/providers/[id]/models/route.js` | LOW-MED |

---

## Phase 3 — Feature additions (optional, product-driven — do after 0–2 land clean)

| upstream | adds | effort/risk | note |
|---|---|---|---|
| `8e59093d`+`6498b312`+`e41d8503` | **Capacity adapter** — per-modality (vision/audio/video) fallback pools with a mimo default; auto-infers audio/video from block mime | MED-HIGH | Highest-value feature. Needs NO registry — layers on our existing `reorderByCapabilities`/`getCapabilitiesForModel`. Adapt default `oc/mimo-v2.5-free` → our `mmf/mimo-auto`; port the 205-line adapter UI into our combos page |
| `b4808929`+`41588bea` | **TokenRouter** provider (OpenAI-compat, 300+ models) + exact pricing | LOW-MED | Wire-able in two-map model (alias `tr`) |
| `9c9dd7b1`+`d433c0b2`+`1eb37db3` | **Qoder PAT** auth (we're OAuth-device-only today) | MED | Genuine gap; new `shared/qoder/constants.js` |
| `fe547f4d` | Self-hosted OpenAI-compat **STT/TTS/embedding** + `embeddingsCore` hardening (errors→400, timeout bound, no silent OpenAI fallback) | MED | The embeddingsCore safety half is worth it standalone |
| `d06e0d26` | Restore **tool use for Codex/Responses-Lite** clients routed to chat providers (invisible on `stream:false` today) | HIGH | Largest translator adaptation — needs new `RESPONSES_ITEM`/`OPENAI_BLOCK` schema constants |
| `7c7fae39` | **Kiro fail-closed** EventStream validation — retry/502 instead of leaking incomplete responses as success | MED-HIGH | Highest-value Kiro robustness; ~1400-line diff vs our diverged `kiro.js` — **needs a deeper read before committing** |
| `cef5dd4d` | Kiro GPT-5.6 native `reasoning.effort` (supersedes `eb00222c`) | MED | Files exist, no registry dep |
| smaller | `651df2f0` OpenDesign · `8b0fcf4b` Claude-Code max-context setting · `31df0635` Poolside · `c570fe33` MiMo TTS · `27b37705` skip-inactive-bg-services · `9138c993` CodeBuddy-CN filter-dodge (CN half only) | LOW–LOW-MED | Grab-bag; do individually if wanted |

---

## SKIP list (with reason — nothing here is a silent drop)

| upstream | why skip |
|---|---|
| `72ec06a8`+`3b14bf4a` | Devin CLI — ~1,500 lines of new ACP-stdio/MCP executor infra, niche |
| `8e04fe17`, `948dd8f8` | zed/trae/windsurf + `register-session` — depend on registry refactor + executors we don't have |
| `6eaa9f83`, `f17a68aa` | Kimi/DeepSeek + SuperGrok usage — depend on `usage/` subdir; display-only |
| `dcdd4628` | Removes Qwen — **we still actively run Qwen** (would break it) |
| `41c9e6be`, `a8313cd3` | Default `opus`→`claude-opus-5` / Kiro opus-5 — we don't carry opus-5; would break the alias (catalog-currency, not a fix) |
| `53a8b5ed`, `42c691b3` | gemini-3.6-flash models/bars — we don't route that model |
| `b11be8be` | Drops gemini-3.0 tier bars — we still route those tiers |
| `783e271c` | Prod/daily cloudcode-pa 429 isolation — **already-have** via our MITM host rewrite + `antigravity429Engine` |
| `ba508f25`, `86131b9c` | `thinking:{adaptive}` / GPT-5.6 Max-Ultra — need `translator/concerns/thinkingLevels` refactor; our Claude path already enables thinking correctly |
| `eb00222c` | Superseded by `cef5dd4d` |
| `55628eea`, `646b3b9b`, `6d96e24b` | alicode split / cloudflare authType / registry catalog refresh — registry-file tuning, low value |
| `de2da19a` | 4 of 9 providers already in our tree; other 5 low-value (we curate this class hidden) |
| `e567ba80`, `3fab15ae`, `786b3013` | ALREADY-HAVE (`client_metadata` strip present; `ENABLE_REQUEST_LOGS` name already used by us for disk logging — collision; standalone asset copy in `build:deploy`) |

---

## Recommended order
1. **Phase 0** (MITM) — security, ship alone first, tag a version.
2. **Phase 1** — 2–3 batched commits, one targeted verify each.
3. **Phase 2** — one at a time, live curl/login proof each (start with `13ed1456`+`6acc3bb9` header leak, then `35f86e58`).
4. **Phase 3** — pick per product priority; capacity-adapter first if vision/audio combos matter.

Every phase: run the full suite (currently 1316 pass) + the live proof noted, before commit.
