# kRouter <- decolua/9router upstream-sync plan 3

Assessed: upstream **87a74e1b (v0.5.104) -> 1fe586bb (v0.5.112, 2026-10-28)** against kRouter **v0.5.166**
(branch `claude/sad-archimedes-fac8ef`, suite 3401 green).
Date: 2026-11-02. Read-only assessment except the one applied change noted in `s0-opencode-session`.

The previous plan (`tasks/upstream-sync-plan-2.md`) covered upstream v0.5.50 -> 87a74e1b and shipped as
kRouter v0.5.166. Its batch `p3-opencode-free` was never started; this plan supersedes that batch with
`s0`/`s1` below, because upstream has since rewritten the same code twice (ce060c79, 483c10f5).

## Scope and counts

- **70 commits** (`87a74e1b..upstream/master`, 2026-10-22 .. 2026-10-28), spanning upstream v0.5.105 ->
  v0.5.112, triaged into **70 rows**.
- Caveat repeated from plan-2, and it bit again: the RTK hook rewrites `git log` and **caps it at 50 lines**.
  The first pass of this range reported 50 commits; `git rev-list --count` said 70. Every listing below was
  re-read with `rtk proxy git ...`. Use `rtk proxy git ...` or `/usr/bin/git` for any range review.

| Status | Rows |
|---|---|
| needed | 38 |
| already-have | 13 |
| not-applicable | 15 |
| foundation-absent (needs a prior feature kRouter does not have) | 4 |

| Category | Rows |
|---|---|
| provider / catalog | 17 |
| bugfix | 24 |
| feature | 13 |
| security | 4 |
| infra / docker | 4 |
| release / test churn | 8 |

### The presence sweep handed to this session was wrong on 3 of its 4 claims

Each was re-checked independently. Do not trust the inherited list.

| Claim | Verdict | Evidence |
|---|---|---|
| ollama-local TTS (Phonon) already present | **WRONG — missing** | no `phonon` anywhere; `open-sse/handlers/ttsProviders/` has no `ollamaLocal.js` |
| ollama-local embeddings already present | **WRONG — missing** | `open-sse/handlers/embeddingProviders/` has no `ollamaLocal.js` |
| Kimi K3.1 Pro already present (CommandCode + OpenCode Go) | **WRONG — missing on both** | CommandCode catalog stops at `moonshotai/Kimi-K2.6`; OpenCode Go has `kimi-k3-1` *named* `"Kimi-K3"` — that is upstream's `kimi-k3`, not the new `kimi-k3.1-pro` |
| gpt-6-sol already present | **correct** | `providerModels.js:68`, `capabilities.js:156` |

The `kimi-k3-1` id is the trap: it reads like "K3.1" but is K3. Whoever ports `5cd4a756` must add
`kimi-k3.1-pro` *beside* `kimi-k3-1`, not rename it, and must re-check both alias maps.

### Architectural divergences that force adaptation (confirmed, not assumed)

kRouter is a fork without upstream's provider-registry refactor. Verified absent in this tree:

- `open-sse/providers/registry/` — **does not exist**; only `providers/capabilities.js`. Provider config lives
  in `open-sse/config/providers.js`, `open-sse/config/providerModels.js`, `src/shared/constants/providers.js`.
- `open-sse/translator/concerns/` — **does not exist** (no `thinkingUnified.js`, no `paramSupport.js`).
- `open-sse/providers/thinkingLevels.js` — **does not exist**.
- `open-sse/translator/formats/` — **does not exist** (no `formats/gemini.js`, no `formats/claude.js`);
  kRouter has `translator/{helpers,request,response,schema}/`.
- `open-sse/services/usage/<provider>.js` — **does not exist**; one monolithic `services/usage.js` (58 KB).
- `open-sse/executors/base.js` has **no `directFetch` hook**, and `proxyAwareFetch` takes no transport
  override. Any per-provider transport (the TLS client) has to add one.
- **No System One lane at all** (zero matches for `systemone`/`System One`). plan-2 classified System One as
  "feature absent here" and declined it (plan-2 line 954).
- **No `minimax-code` provider** (`minimax` exists only as a TTS provider and as model-catalog entries).
- **No Pi CLI tool** (`src/app/api/cli-tools/` has no `pi-settings`).
- **No DeepSeek PoW** of any kind (`deepseek-pow*` absent).

---

## The OpenCode Free session-id decision (answer first, as asked)

**Question put to this session:** can kRouter's digest-derived session id survive alongside the TLS fix, or
does the quota reasoning no longer hold?

**Answer: the quota reasoning still holds in full. The digest cannot survive — and it never worked.**
Those are two separate findings, and the second is the decisive one.

### The two gates are independent

kRouter's `translateSessionId` comment (`open-sse/executors/opencode.js`) says the digest exists because
"the free quota is accounted per session, so a fresh id on every request burns it ... Deriving it from a
digest gives that for free, with no store to evict". That reasoning is correct and upstream agrees with it:
ce060c79's own message says "memoize per conversation so a conversation keeps one stable session". Upstream
did **not** move the opposite way on stability. It changed only where the 36-bit time field comes from.

Determinism was the *mechanism*; stability is the *goal*. The goal is untouched.

### Why the digest was always failing

kRouter's header block documents that the gate "decodes the session prefix as `~(timeMs * 0x1000 + counter)`
over 48 bits" — and then reasons only about the **counter**. It never reasons about the **time**. The digest
sets those 36 time bits from `sha256(...)[0..4]`, i.e. a uniform draw over 2^36 ms. Upstream's 2026-10-26
probes found the gate also refuses a session whose decoded time is in the future or older than the free-tier
window.

Measured in this tree (`probe-session-time.mjs`, reproducible):

```
server's own wrapped clock now : 6908441852

OLD (digest-derived time field):
  seed conversation-1   decoded= 63832916420  age=-658.8 days   <- 658 days in the FUTURE
  seed conversation-2   decoded= 59811709578  age=-612.3 days
  seed conversation-3   decoded=  7978237307  age=-12.4 days
  seed abc              decoded= 46344720654  age=-456.4 days
  seed xyz              decoded= 51999295873  age=-521.9 days
  -> inside a 7-day window: 97/10000 (0.97%)

NEW (Date.now() time field):
  decoded=  6908441873  age=-0.021 s          <- current
```

So the digest is a ~1% lottery, consistent with upstream's measured 1/10 (their window is wider than the
7 days assumed above). This is **not** a tradeoff kRouter made against upstream from an informed position:
kRouter's probes are dated 2026-10-18 and found the counter gate; upstream found the time-window gate eight
days later, on 2026-10-26. There is no conflict of judgement to adjudicate here, only a newer fact.

### Why determinism cannot be kept

Taking the time from `Date.now()` while keeping the random part deterministic does not work: the id would
change on every request because the time changes, which re-breaks stability — the very thing the digest was
protecting. Current-time and pure-determinism are mutually exclusive. **Memoization is therefore required,
and the digest must go.**

### Resolution, and why it costs kRouter nothing

kRouter is better placed than upstream for this. `resolveOpencodeSession` already memoizes the *seed*
(`resolveOpenCodeGoSeed`, plus the `NOAUTH_SEED_KEY = "opencode:noauth"` stand-in for the credential-less
case). So the seed handed to `translateSessionId` is already stable per connection/launch. Keying a memo map
on the same `(clientTool, seed)` tuple the digest hashed preserves the existing guarantee exactly, with
upstream's TTL + LRU eviction on top.

### The test file is not a decision to revisit — it already agrees

`tests/unit/opencode-free-inference-endpoint.test.js` asserts **stability and shape**, never the digest:

| Case | Survives? | Why |
|---|---|---|
| `mints ses_<12 hex><14 base62>` | yes | same shape minted |
| `keeps the encoded counter small` | yes | counter still pinned to 1 |
| `derives the same id for one conversation and different ids for two` | yes | memo hit / distinct mint |
| `namespaces by client tool` | yes | clientTool is in the memo key |
| `keeps a session that already has the gate's shape` | yes | early return untouched |
| `rewrites an OpenCode Go style ses_<32 hex>` | yes | early return rejects it, mints |

Only the word "derives" in case 3 is digest-flavoured; the assertion is `toBe` on two calls with the same
argument, which memoization satisfies. **Proven, not argued:** the change below is applied in the working
tree and `tests/unit/opencode-free-inference-endpoint.test.js` +
`tests/unit/opencode-fingerprint-tool-aliasing.test.js` run **44 passed / 0 failed**.

### Necessary but not sufficient — read this before planning live proof

The session fix alone will **not** make OpenCode Free work. Gate 1 is the TLS ClientHello, and upstream's own
code fails open to native fetch when `wreq-js` is absent — which returns 429. kRouter has no `wreq-js`, no
lazy-runtime installer and no `directFetch` hook. **Live `oc/*` proof is blocked on `s1` (the wreq-js
transport), which is itself part of the web-providers infrastructure.** Do not promise a live oc/ PONG from
`s0` alone.

---

## How to run this plan

Slices are ordered by value-per-risk, not by upstream date. `s0` is applied; `s2`-`s5` are independent of each
other and of `s1`. `s1` is the gate for anything oc/-live and for every web provider.

Per the session's ground rules: **do not touch `CHANGELOG.md` or any version field** — a v0.5.167 release is
being cut separately for the Dependabot/node-forge security fixes. Verify every slice with
`npx vitest run` **and** `npm run build` (CI runs the build only on the Node 20.9 floor job, so a build-only
break does not show up in the test jobs).

---

## Slice `s0` - OpenCode Free session timestamp (APPLIED, proven)

Files: `open-sse/executors/opencode.js`.

- **ce060c79 (part 2 of 3) - mint the session time from the clock, memoize per conversation** (risk low)
  - Fixes: the ~1% acceptance lottery measured above. Independent of the TLS gate, so it is worth taking on
    its own even though it does not by itself revive the lane.
  - Change: drop `SESSION_TIME_MASK` and the sha256 body of `translateSessionId`. Mint
    `ses_${descendingTimeHex(Date.now(), 1)}${randomSessionSuffix()}` and memoize on
    `` `${clientTool || "generic"}\0${sessionId || ""}` `` in a module-level `Map` with
    `MEMORY_CONFIG.sessionTtlMs` TTL sweep (`unref`'d interval) and a 5000-entry LRU bound.
  - Adapt: kRouter keeps its own `resolveOpencodeSession` / `NOAUTH_SEED_KEY` seed resolution in front,
    untouched — that is what makes the memo key stable. Upstream's `unstableRandom` is not exported here, so
    the 14-char base62 suffix is minted from `crypto.randomBytes(14)` against kRouter's existing
    `BASE62_CHARS`. The doc comment is rewritten to state both invariants (stability **and** a current
    timestamp) so the next person does not re-derive the digest.
  - Test: the 6 existing session cases cover it and all pass unchanged. **Add** one case asserting the decoded
    time field is within a few seconds of `Date.now()` — that is the invariant the old code violated and no
    test guarded.
  - Status: **applied in the working tree, 44/44 green.** Revert is `git checkout -- open-sse/executors/opencode.js`.

---

## Slice `s1` - web providers, browser pool and the TLS transport (the big one)

Files (new unless noted): `open-sse/services/{browserPool,browserProfileCache,lazyRuntime,obscura,virtualDisplay,webIdentity,webLogin,webLoginConfig,opencodeTlsClient,grokTlsClient}.js`,
`open-sse/executors/{deepseek-web,gemini-web,chatgpt-web,muse-web,uc-web,veoaifree-web,browserExecutableCheck}.js`
plus their subdirectories, `open-sse/executors/grok-web.js` (modify),
`open-sse/translator/{webTools,deepseekWebTools,deepseekWebToolBinding}.js`,
`open-sse/utils/{tagBlocks,webCookieAuth,geminiCookies,writableDataDir}.js`,
`open-sse/lib/deepseek-pow*.js`, `open-sse/handlers/imageProviders/*`, `open-sse/handlers/videoCore.js`,
`open-sse/executors/base.js` (modify), `open-sse/utils/proxyFetch.js` (modify), `Dockerfile`, `package.json`,
`next.config.mjs`, plus dashboard `WebLoginButton.js` and `api/providers/web-login/route.js`.

Upstream rows: **38a0c449** (89 files, +14 572), **ce060c79** parts 1 and 3, **e70ea24d**, **3b7acf72**,
**d7bb71ce**, **483c10f5**.

- **Size warning.** 38a0c449 alone is 89 files and ~14.5k added lines, written against the provider registry
  kRouter does not have. Every one of the 7 new `registry/*-web.js` files has to be re-expressed across
  kRouter's 4 catalog/routing points, and each new provider needs its own `->CLAUDE` branch in
  `nonStreamingHandler`. This is not a one-session slice. Recommend splitting:
  - `s1a` **infrastructure only**: `directFetch` hook through `base.js` (4 `proxyAwareFetch` call sites) and
    `proxyAwareFetch`; `lazyRuntime` with the e70ea24d + 1fe586bb fixes folded in from the start
    (`createRequire` fetched at runtime, `webpackIgnore` on the runtime-dir `import()`, a minimal
    `package.json` anchoring npm to the runtime dir, wipe-and-reinstall once on a partially-extracted
    package); `opencodeTlsClient`; the Dockerfile builder-stage isolated install of `wreq-js` +
    `playwright-core` (3b7acf72). **This alone unblocks live `oc/*` proof and is the highest-value part.**
  - `s1b` `browserPool` + `browserExecutableCheck` + `webLogin`/`webLoginConfig` + `webCookieAuth` +
    `webTools`/`tagBlocks`, and grok-web moved onto the TLS client.
  - `s1c` one web provider at a time, cheapest first (`veoaifree-web` 220 lines, `uc-web` 458,
    `gemini-web` ~1300, `muse-web` ~1100, `deepseek-web` ~1250 + PoW, `chatgpt-web` ~3500).
- **ce060c79 part 1 - route the free lane through a TLS-impersonating session** (risk medium)
  - Fixes: on one process and one egress IP the same body answered 429 over Node's OpenSSL ClientHello and
    200 over Bun's BoringSSL one. The gate keys on the JA4 cipher-list hash.
  - Change: `opencodeTlsClient.js` sending that cipher list via `wreq-js`; fail open to native fetch when the
    optional dep is absent. Thread it in as the executor's `directFetch`.
  - Adapt: kRouter has no `directFetch`. Add it to `base.js` and forward to `proxyAwareFetch`, keeping
    **proxies at higher priority** (upstream's note applies here too: a proxy pool or Vercel relay on this
    provider bypasses the TLS client and the lane returns 429 again — say so in the dashboard copy or a doc,
    because kRouter users do use strict pools).
  - Watch: plan-2's `p1-proxy-strict` work means kRouter throws when `strictProxy && proxyIntended` and
    nothing resolves. Make sure a `directFetch` override cannot be mistaken for "a proxy resolved" and
    silently defeat strict mode. Pin that with a test.
- **ce060c79 part 3 - pair the `<env>` CLI marker with a declared tool list** (risk low)
  - Fixes: the system prompt must carry the CLI's `<env>` marker **and** the body must declare tools; either
    half alone is answered 429.
  - Change: `applyEnvFingerprint(body, flat, {claude})` appending (never replacing) the marker across all
    three shapes — chat `messages[]` system, Responses `instructions`, Claude top-level `system`; plus
    `applyFingerprintTools(..., {claude})` so a `/messages` body gets `system` rather than a rejected
    `role:"system"`.
  - Adapt: kRouter's `applyFingerprintTools` has no `claude` option and its `noteUnavailableTools` bails when
    `body.system !== undefined`. Both need the upstream signature change.
- **d7bb71ce - DeepSeek PoW on noble-hashes** (risk low) — **re-scoped**
  - kRouter has **no DeepSeek PoW at all**, so this is *not* a standalone "removes ~430 lines" win as the
    brief framed it. The vendored implementation arrives only with `deepseek-web` (38a0c449). Port the
    **noble-hashes end state directly** in `s1c` and never introduce the vendored copy. Check whether
    `@noble/hashes` is already a dependency before adding it.
- **483c10f5 - normalize a colliding fingerprint tool in place** (risk medium) — **confirmed missing, and a
  live bug**
  - Fixes: kRouter's `opencodeFingerprint.js` only has the alias path (`let alias = `${key}_client``). OpenCode
    builds its `shell` description from `process.platform`, so on macOS/Windows a caller's own `shell` never
    matches the frozen capture, gets renamed to `shell_client`, and **the client then rejects the model's tool
    calls because it has no tool by that name** (upstream #4971, #5011). Every non-Linux kRouter host hits this.
  - Change: try in-place normalization first — when every parameter the caller declares exists in the
    fingerprint and every required fingerprint parameter is present, keep the caller's name and adopt
    OpenCode's definition. Fall back to the alias otherwise.
  - Review note to carry over: this replaces the caller's own tool description (so safety text a client embeds
    in its `shell` description stops reaching the model) and widens a subset schema on the wire. Both are
    forced by the upstream gate.
  - Test: port upstream's in-place suite (Windows wording, nested chat shape, alias-name collision with client
    plugin tools, both fallback paths) into `tests/unit/opencode-fingerprint-tool-aliasing.test.js`.
- Live proof for this slice: with `s1a` in, `oc/big-pickle` non-stream + stream, `/v1/messages`, and
  `oc/deepseek-v4.1-flash-free` must each return a real completion through a local gateway. Unit-green is not
  acceptance here — this is exactly the "green tests, live 403" failure mode the repo keeps hitting.

---

## Slice `s2` - live request bugs users hit today (no new features, no new deps)

Files: `open-sse/translator/helpers/claudeHelper.js`, `open-sse/translator/request/openai-to-claude.js`,
`src/lib/db/driver.js` (+ new `src/lib/db/helpers/nullBytes.js`), `open-sse/config/errorConfig.js`,
`open-sse/providers/capabilities.js`, `src/shared/constants/monaco.js` (new),
`src/app/(dashboard)/dashboard/translator/page.js`, `package.json`.

**Recommended first slice after `s0`.** Every row is a confirmed defect in this tree, each is small and
independent, and none needs a provider credential to verify.

- **0ad0a722 - Haiku 5.5 loses adaptive thinking** (risk low) — **confirmed live bug**
  - Fixes: `claudeHelper.js:243` is `const ADAPTIVE_THINKING_UNSUPPORTED = /haiku/i;` with the comment "only
    Sonnet/Opus support it". That matches `claude-haiku-5-5`, which accepts **only** adaptive, so kRouter
    downgrades it to `enabled/10000` and Anthropic answers 400 "thinking.type.enabled is not supported for
    this model".
  - Change: read the major version out of the id and downgrade only below 5. Handle every id shape in the
    catalogs (`claude-haiku-4-5`, `claude-haiku-4.5`, `claude-4.5-haiku`, `claude-3-5-haiku-20241022`), with
    or without a provider prefix or date suffix, so a future haiku-6 is not downgraded either. An unversioned
    bare `haiku` keeps the old downgrade.
  - Test: port `tests/unit/claude-haiku-adaptive-thinking.test.js`.
- **95009651 - `image_url` inside a `role:"tool"` message reaches Anthropic verbatim** (risk low) —
  **confirmed live bug**
  - Fixes: `openai-to-claude.js:276-282` pushes `content: msg.content` straight into `tool_result`. The
    `image_url` conversion at `:298` is in the `msg.role === "user"` branch only. Anthropic answers 400
    "Input tag 'image_url' ... does not match any of the expected tags" (#5125).
  - Change: convert image parts inside `tool_result` the same way the user branch does — data URI -> base64
    image, `http(s)` -> url image, already-Claude image blocks pass through. Plain string content untouched.
  - Test: port `tests/unit/tool-result-image-url.test.js`.
- **5a4e812e - NUL bytes in bound strings** (risk low)
  - Fixes: raw binary in telemetry throws on better-sqlite3 and truncates on `node:sqlite`. Confirmed absent.
  - Change: strip NUL from bound strings across all drivers via one `helpers/nullBytes.js`.
  - Test: port `tests/unit/db-null-byte-params.test.js`.
- **b82f5c4a - combos stop instead of advancing when credits run out** (risk low)
  - Fixes: `errorConfig.js` has no "insufficient credits" / "credit balance is too low" rule, so a 400 ends
    the combo (#4713). kRouter already has the request-scoped advance machinery (5cdcddf5 is already-have),
    so this is a two-line data change plus tests.
  - Test: port `tests/unit/combo-credit-fallback.test.js` and the `account-fallback-4xx` case.
- **5883110b - Monaco's CDN copy is unpinned** (risk low; **security**)
  - Fixes: kRouter ships `monaco-editor ^0.53.0` and `@monaco-editor/react ^4.7.0`, but the react wrapper
    never imports the node_modules package — its loader fetches Monaco from jsdelivr at a version hardcoded in
    `@monaco-editor/loader` (0.55.1, bundling DOMPurify 3.2.7, which is what the DOMPurify advisories are
    about). Bumping the package alone changes nothing a user runs. kRouter has the same exposure as upstream.
  - Change: pin the CDN copy to 0.57.0 (DOMPurify 3.4.15) in a shared constant and configure the loader with
    it inside the existing `dynamic()` import so the editor stays lazy. Add the test that keeps the CDN pin,
    the `package.json` range and the installed package in step.
  - Coordinate: this touches `package.json`, and a v0.5.167 security release is in flight. Flag it to whoever
    cuts that release rather than landing it underneath them.
- **1da5b0d7 - `oc/deepseek-v4.1-flash-free` publishes a 1M window the backend refuses above ~330k** (risk low)
  - Change: provider-scoped capability entry, `contextWindow 330000` / `maxOutput 128000`. Clients size their
    compaction budget from the published number, so today a long session never compacts and hard-fails on a
    400 (#5097).
  - Adapt: upstream's note that the provider override short-circuits before the pattern table relies on its
    registry; confirm the same precedence holds in kRouter's `capabilities.js` before trusting it, and assert
    it in the test.
  - Test: port the `capabilities.test.js` case (window <= 330000, maxOutput <= contextWindow, vision/reasoning
    unchanged).
- Live proof: a Claude-shaped request to `claude-haiku-5-5` with `thinking` must return 200 (it 400s today);
  an OpenAI request carrying an image inside a tool result must translate and return 200.

---

## Slice `s3` - new providers and catalog entries

Files: `open-sse/config/providers.js`, `open-sse/config/providerModels.js`,
`src/shared/constants/providers.js`, `open-sse/providers/capabilities.js`, `open-sse/providers/pricing.js`
(if present), `src/app/api/providers/validate/route.js`,
`src/app/api/providers/[id]/test/testUtils.js`, `public/providers/*.png`,
`tests/__baseline__/{alias,providers}-baseline.json`, `open-sse/handlers/chatCore/nonStreamingHandler.js`.

**For every row here: follow the provider-wiring checklist — all 4 catalog/routing points, both token-refresh
paths, the media-kind slug map — and check `PROVIDER_ID_TO_ALIAS` and `ALIAS_TO_PROVIDER_ID` agree, or the
provider silently 401/404s. Add the `->CLAUDE` branch in `nonStreamingHandler` for each; streaming hides a
missing one and that bug has already shipped three times.**

- **b9c27225 - Runcrate (`rc`)** (risk low) — cheapest real provider in the range
  - OpenAI-compatible, so no executor or translator work; `baseUrl
    https://api.runcrate.ai/v1/chat/completions`, 6 models.
  - Must-not-miss: `validateUrl` points at the authenticated `GET /api/v1/billing/balance`, **not**
    `/v1/models`, because the public `/v1/models` answers 200 for any key and the generic probe cannot tell a
    bad key from a good one. Register the same `validateUrl` in `validate/route.js` and `testUtils.js`.
- **f7f6f5ed - nace (`drex`, `drex-v2.0`, `drex-max`)** (risk medium) — **partially foundation-absent**
  - Upstream adds nace "to the System One lane". kRouter has no System One. Port the provider on the ordinary
    chat lane and drop the System One wiring; say so in the row so nobody thinks the lane exists.
- **351b04cb - SenseNova** (risk low)
  - Registry + models (`sensenova-6.8-flash-lite`, U1.5 image models), connection validation (#5079), plus
    the OpenAI image-adapter extension for `watermark` / `prompt_extend` / `output_format` and boolean option
    support in `GenericExampleCard`.
- **a3bdaf6d - CommandCode Kimi K3.1 Pro** (risk low)
  - Id kept **verbatim and capitalized** from upstream's `GET api.commandcode.ai/provider/v1/models`
    (`moonshotai/Kimi-K3.1-Pro`); the router does not normalize model-id casing. Capabilities and pricing
    inherit from the existing commandcode branch and the `kimi-k3*` pattern. Rides the same NDJSON
    `/alpha/generate` lane.
- **5cd4a756 - OpenCode Go Kimi K3.1 Pro** (risk low)
  - `kimi-k3.1-pro` on the chat lane: vision + video input, always-on Kimi thinking
    (`thinkingCanDisable: false`), 1 048 576 context, 131 072 max output, dedicated K3 pricing
    ($2.00 in / $10.00 out / $0.20 cached / $2.00 cache-write per 1M).
  - **Add beside `kimi-k3-1`, do not rename it** (see the trap note at the top).
- **acb3c080 - Codex `gpt-6.1-terra`** (risk low) — responses-lite lane, GPT-6-Lite thinking levels.
- **fbac1220 - Codex image host moves to `gpt-6-sol`** (risk low)
  - Expose `cx/gpt-6-sol-image`, drop the superseded `gpt-5.6-{sol,terra,luna}-image` aliases, and add a
    `*gpt-6*image*` capability pattern **ahead of** the generic `gpt-6` family entry — without it
    `gpt-6-sol-image` inherits the chat caps and loses `imageOutput`, so image combos aggregate it as a
    non-image model.
- **b08f12d5 - Codex image generation dies on ChatGPT Free accounts** (risk low)
  - Free accounts get `image_generation` stripped server-side; a 400 is not fallback-eligible, so the request
    dies on the first Free account even when a paid one is available.
  - Change: adapters expose `canUseCredentials(creds)`; the codex adapter reads `chatgpt_plan_type` from the
    access token, then the id token, then stored `providerSpecificData`, and rejects `"free"`. The handler
    skips such accounts **without locking them** (they stay usable for chat) and returns 403 when none is left.
- **f172c3c4 - Antigravity `hub/2.24.0` UA + Gemini 4 Argon tiers** (risk low)
  - The old UA gets HTTP 404 on Gemini 4 Argon models. Register `gemini-4-argon-medium` / `-low` and include
    `gemini-4-argon-*` in quota monitoring.
- **b1effa03 - CommandCode headers aligned to official CLI 1.88.0** (risk low) via a shared
  `commandCodeHeaders` service.
- **3fd925ab - CodeBuddy plugin request/conversation id headers** (risk low)
  - The gateway runs a per-request channel check and rejects calls lacking the official plugin's identifiers
    with 400 / 11128 "request illegal". Add `X-Request-ID`, `X-Conversation-ID`,
    `X-Conversation-Request-ID`, `X-Conversation-Message-ID`. kRouter has `codebuddy-cn` only, so register on
    that one (`codebuddy-intl` is absent — plan-2 line 954).
- **b8331283 - `oc/mimo-v2.6-flash-free` full reasoning support** (risk medium)
  - Capability row is absent in this tree. Touches the SSE-to-JSON handler, reasoning translation and
    `utils/stream.js`. Note plan-2 made this id the capacity-adapter default, so getting it wrong is visible.
  - Adapt: upstream's half lives in `providers/thinkingLevels.js` and `translator/concerns/reasoning.js`,
    neither of which exists here — re-express against `capabilities.js` and kRouter's reasoning path.
- **32c5f30a - `glm-5.3-flash-free` must send `reasoning_effort`, not a `thinking` object** (risk low)
  - OpenCode's inference upstream rejects the zai thinking object.
- **313559f4 - `oc/deepseek-v4.1-flash-free` honours low|high|max** (risk low)
  - Generic DeepSeek rules collapse `low` to `high`. Adapt: no `thinkingLevels.js` here.
- **763fb687 - `max` effort clamped to `xhigh` for GPT-5.6/GPT-6 behind OpenAI Compatible nodes** (risk low)
  - Adapt: no `thinkingLevels.js`; find kRouter's level normalization and apply the same CODEX level set to
    `openai-compatible-*` providers serving those ids when no model/pattern row matches.
- **ced0cf6e - NVIDIA NIM duplicate-field 400** (risk low)
  - Normalize assistant `reasoning` aliases to `reasoning_content` before forwarding. Adapt: no
    `translator/concerns/paramSupport.js` in this tree.
- **4a76b8de - CommandCode quota display and connection probe** (risk medium)
  - Recognize the short plan ids the API returns (`go`, `individual-go-v1`) so the Go plan resolves its name
    and 10-credit cap; add percentage/colorPercentage/emptyMessage to quota rows; add a dedicated probe on
    `/alpha/whoami?limits=1` because the generic key probes cannot validate against this upstream.
  - Adapt: upstream's `services/usage/commandcode.js` does not exist here — the logic goes into the
    monolithic `services/usage.js`.
- **31b8439b - Ollama Cloud moved quota to `/api/balance`** (risk low)
  - `/api/usage` now only reports activity history. Fall back to `/api/balance`; support session (5h) and
    weekly (7d) remaining percentages and reset timestamps, `allowance_usd`, purchased credits, and pass
    balance metadata through to `QuotaTable`. Adapt: no `services/usage/misc.js` here.
- **8db1f4ae - Gemini protobuf type predicates on schema `items`/`properties`** (risk medium)
  - Adapt: no `translator/formats/gemini.js` in this tree. Locate kRouter's Gemini schema path first — the
    only `protobuf`-ish match is in `translator/request/openai-to-cursor.js`, so this needs a real read
    before it is scheduled, not a guessed file.
- **82aeb907 - resolve unadorned Antigravity models to tiered variants from client reasoning effort** (risk low)
- **161e3493 - reference image inputs for Gemini / Antigravity image generation** (risk low)
  - Confirmed missing: `imageProviders/gemini.js` only reads `inlineData` out of the *response*. Also parses
    `quotaResetTimeStamp` from Google errors for accurate cooldown, and auto-creates the MITM directory.

---

## Slice `s4` - features worth taking (optional, no live credential needed)

- **ca7b5401 - combos fall through on an empty-content streaming response** (risk medium) — **highest-value
  row in this slice**
  - Fixes: a streaming member that returns 200 but never produces content (Gemini
    `MALFORMED_FUNCTION_CALL`, or a stream that simply dies) is logged as "succeeded" and returned as an
    empty answer even when the combo has members left.
  - Change: `emptyFailover.js` peeks the client-format SSE stream to the first content-bearing frame —
    content seen -> replay the buffered head and stream the rest untouched; stream ends with no content ->
    advance; `content_filter` finish or last member -> return as-is; peek deadline elapsed -> commit
    (fail-open, never hold a slow stream). The signal is structural, not an enum, so future abort reasons are
    covered. Delta role, reasoning/thinking and `finish_reason` are not content.
  - Why it fits kRouter: the peek reads the stream as the client receives it, so OpenAI chat, Anthropic
    Messages and OpenAI Responses are all understood — and kRouter already has the request-scoped advance
    machinery this hangs off.
- **421f2262 + 00dd3dfc - Codex OAuth STT (`cx/transcribe`)** (risk medium)
  - Reuses existing Codex OAuth chat connections instead of an OpenAI API key. Audio -> mono 24 kHz PCM16 WAV
    via ffmpeg, file-only multipart to ChatGPT's transcription endpoint with the Codex identity headers.
  - Carry over the bounds, they are the point: input size, decoded duration, conversion, response size and
    concurrency are all bounded, and private temp files are removed on **both** success and failure. Direct
    requests use Node HTTPS/1 with normal certificate verification; proxied requests keep the shared transport.
  - 00dd3dfc gates the media-page OAuth shortcut on `kind === "stt"` so OAuth providers with API-key media
    lanes (antigravity, github, glm, kimi, xai, xiaomi-mimo) keep their Add Connection form. Take it with
    421f2262 or those pages regress.
  - Needs: `ffmpeg` on the host, and a live Codex OAuth connection to prove.
- **31a9d262 - ollama-local TTS (Phonon)** (risk low) — **missing, contrary to the inherited sweep**
  - 15 Phonon tags, 38 preset voices, format normalized to wav/pcm (the only two Ollama accepts), 404 on an
    uninstalled tag discovers other installed phonon tags via `/api/tags`, falls back to the `default` voice
    when the loaded checkpoint lacks the requested one. `serviceKinds` gains `"tts"`. Synthesizes without a
    stored connection since the server is local. `tts.js` must honour `response_format` from the body, not
    only the query string.
- **10cd6c08 - ollama-local embeddings** (risk low) — **missing, contrary to the inherited sweep**
  - Host resolved from `providerSpecificData.baseUrl` (default `http://localhost:11434`), stripping a
    trailing slash, a `/v1/embeddings` suffix or a bare `/v1` before appending, so a host saved with an
    endpoint path does not become `.../v1/v1/embeddings`. Bearer only when an apiKey is configured.
    `dimensions` forwarded only when a positive number. 14 embedding model families catalogued.
- **8a842043 - RTK user-authored custom system prompt** (risk low)
  - `customPromptEnabled` / `customPrompt` injected through the shared `injectSystemPrompt`, independent of
    the Ponytail level picker; with both on the two prompts append rather than replace. Empty/blank injects
    nothing, and the request log records only the prompt **length** so the text never reaches the traces.
- **86adae35 / 792f4719 / a440ef43 - Headroom fidelity** (risk medium, 3 rows)
  - 86adae35: a Claude request with a PDF + tool history is round-tripped through Claude -> OpenAI -> Claude
    and loses document blocks and native tool/thinking metadata. Project only compressible text leaves and
    copy validated text back.
  - 792f4719: CommandCode stores its conversation under `params.messages`, so Headroom logs "unsupported
    commandcode request shape" and never calls the proxy.
  - a440ef43: Gemini/Antigravity keep tool results under native `contents`, and Responses requests with tool
    history were skipped by the round-trip guard.
  - Take these only if Headroom is actually used here; all three are fail-open by construction.
- **9b4ea9eb - search box for the combo list** (risk low) — pure UI; `combos/page.js` has no search today.
- **a3ca2f9b - API Key Created modal copy** (risk low) — the current copy claims keys are one-time-view, which
  is wrong. Cosmetic but user-facing; upstream also updated 6 locale files.

---

## Slice `s5` - infra / Docker

- **32a064e2 - pin the Node base image and add `.nvmrc`** (risk low)
  - Upstream pins `node:22.23.4-alpine` for CVE-2026-111497 (Brotli RCE) and related October 2026 Node CVEs.
    Check kRouter's current `Dockerfile` pin and `.nvmrc` before porting the exact version; kRouter's CI
    floor is Node 20.9, so do not let a 22.x pin in the Dockerfile contradict the floor job.
- **08ef047f - undici + headroom loopback** (risk low) — **half already-have**
  - `undici` is already `^7.30.1` in `package.json`. The remaining half is binding the headroom port to
    `127.0.0.1:8787:8787` in `docker-compose.yml`. Check whether kRouter's compose already does this.
- **3b7acf72 - bake the lazy runtime deps into the Docker runner image** — belongs to `s1a`, listed there.

---

## Already-have (13 rows) — verified individually, not inherited

| sha | Why it is already here |
|---|---|
| 56dbf466 | `nonStreamingHandler.js:220-227` already rejects a mid-stream `error` frame and maps rate_limit/quota to 429, everything else to 502 |
| 5cdcddf5 | `requestScoped` advance present in `services/combo.js` and `services/accountFallback.js` |
| 95c9d03e | `utils/streamHelpers.js` exists with tool-call id synthesis; passthrough name restore present |
| 7c42d8f8 | `max_completion_tokens` rename present in the translator layer |
| 3ce2b828 | `resolveKiroModel` present in `config/kiroConstants.js` with Anthropic alias normalization |
| b0655314 | `grok-4.7` has its own row in `providers/capabilities.js` |
| dbdbb648 | `gpt-5-mini` present in the Copilot fallback catalog in `config/providerModels.js` |
| 2924e055 | `deepseek-flash` upstream-id mapping present in `config/providerModels.js` |
| 2720cd2a | Qoder `10605` queue handling present in `executors/qoder.js` |
| 08ef047f (dep half) | `undici ^7.30.1` already in `package.json` |
| gpt-6-sol | `providerModels.js:68` + `capabilities.js:156` — the one correct claim in the inherited sweep |
| f3e1f716 (partial) | `claude-opus-5.5` dotted ids already recognized in `providerModels.js` / `capabilities.js`; **re-read the thinking-rule half before closing this row** |
| b6a9ca43 | upstream's own test-suite triage against upstream's tree; kRouter's suite is green at 3401 |

## Not applicable (15 rows)

- **No Pi CLI tool** (`src/app/api/cli-tools/` has no `pi-settings`): 342ecb0d, 72cb589e, 50dcaa0c.
- **No `translator/concerns` / no `thinkingUnified` / no transports** (plan-2's standing finding):
  d07e5bc3 (transport-declared thinking format — the *mechanism* does not exist here; the OpenCode Go
  `/responses` symptom it fixes should be re-probed separately if it bites).
- **No `codebuddy-intl`** (plan-2 line 954): 3b137aa6.
- **No `modelSearchFilter.js`**: 5853a88a. If kRouter grows a model search, carry the regex-state reset with it.
- **Release and version commits**: f39d8f07 (v0.5.109), 3a978a63 (v0.5.111), 1fe586bb (v0.5.112) — and per this
  session's ground rules, `CHANGELOG.md` and version fields are off-limits anyway.
- **No `translator/formats/`**: the *file* targets of 8db1f4ae and 0ad0a722 do not exist; both are still
  **needed** (scheduled in `s3`/`s2`) against kRouter's own paths. Listed here only so the path mismatch is
  not mistaken for absence of the bug.
- **Merged-away intermediates**: e70ea24d and 3b7acf72 are folded into `s1a` rather than ported as separate
  steps; d7bb71ce is folded into `s1c`.

## Foundation-absent (4 rows) — needs a feature kRouter deliberately does not have

| Upstream row | Missing foundation | Recommendation |
|---|---|---|
| **f3f86fdd** Smart Router (System One) + adaptive session stickiness + SmartPolicyModal | **The entire System One lane.** Zero matches for `systemone` in this tree. plan-2 classified System One as "feature absent here" and declined it | **Do not take in this session.** Porting the Smart Router means first porting System One itself (`handlers/systemoneCore.js`, the provider-side decision models, the `src/sse/services` half), then the router on top. That is a feature decision, not a sync item — it reverses a call plan-2 already made. Raise it as its own piece of work |
| **bc4a3cc7** Ollama System One decision models (`clef`, `clef-flash`) | same | skip; revisit only if System One is adopted |
| **f7f6f5ed** nace "on the System One lane" | same | **partially portable** — take the provider on the ordinary chat lane (scheduled in `s3`), drop the System One wiring |
| **85d73bd6** MiniMax Code lease auth via named-pipe/unix-socket broker | **No `minimax-code` provider.** `minimax` exists only as a TTS provider and catalog model ids | skip. The lease broker is auth plumbing for a provider that does not exist here; adding the provider is the prerequisite and is not in this range |

---

## Recommended order

1. **`s0`** — applied and proven. Keep it; add the decoded-timestamp test.
2. **`s2`** — live bugs, small diffs, no new deps, no credentials needed to verify. Best value per risk in the
   whole range. Coordinate the Monaco row with the v0.5.167 release.
3. **`s3`** — providers and catalog. `b9c27225` (Runcrate) first as the cheapest end-to-end exercise of the
   wiring checklist; then the Kimi K3.1 Pro pair, the Codex rows, then the adapt-heavy capability rows.
   Every row needs a live key or it ships unverified.
4. **`s1a`** — the `directFetch` hook + lazyRuntime + opencodeTlsClient + Docker baking. This is the gate for
   live `oc/*` proof and should land before anyone claims OpenCode Free works.
5. **`s4`** — `ca7b5401` first (empty-stream failover is a real correctness win), then the ollama-local TTS /
   embeddings pair, then the rest as appetite allows.
6. **`s1b` / `s1c`** — browser pool and the web providers, one provider per change. Treat as its own project.
7. **`s5`** — Docker/Node pinning, once the floor-job question is settled.

## Open questions for the user

1. **System One** — plan-2 declined it; the Smart Router in this range depends on it. Adopt the lane, or keep
   declining and drop both rows permanently?
2. **Web providers** — 7 providers, ~14.5k lines, a browser pool, a lazy Playwright/Chromium installer and a
   Docker image change, against a tree with no provider registry. Is the whole block wanted, or only `s1a`
   (the part that revives OpenCode Free)?
3. **Monaco CDN pin** — it touches `package.json` while v0.5.167 is being cut. Land it here, or hand it to the
   release?
4. **Codex STT** — needs `ffmpeg` on the host and a live Codex OAuth connection to prove. In scope?
