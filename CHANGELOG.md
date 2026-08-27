# v0.5.147 (2026-08-27) — Windows was unusable in places, and the CLI was killing other people's processes

A feature-by-feature pass over the product as a user rather than as a test suite. Every
defect below was reachable by an ordinary person and none of them failed a test: 1727
tests pass against all of them.

**The CLI was dangerous to other software on the machine.**
`killAllAppProcesses` selected processes by command line, and one clause was
unqualified — `|| cmd.includes("next-server")`. Next renames its server to a bare
`next-server (v16.3.1)` with no path or project in it, so that matched *every* Next
server running, and starting or quitting kRouter SIGKILLed a developer's unrelated dev
server along with its unsaved state. kRouter's own server matches by that same string
and nothing else, so the two are indistinguishable by name; both platform branches now
walk the process tree from the cli.js invocation instead. Verified with two processes
whose command lines were byte-identical: ours was selected, the other left running.

`killProcessOnPort` ran `lsof -ti:PORT` and kill -9 on everything it returned, so
`krouter --port 3000` destroyed the user's own app and `--port 5432` took out their
Postgres, silently, before anything printed. It now kills only a process it has
identified as this install's server — by working directory, which survives both
orphaning and Next's rename — and otherwise names the holder and exits.

`--version` and `--help` ran the runtime self-heal first, which shells out to a blocking
npm install with a 180s timeout, so asking the program its version could print nothing
for three minutes. Now 73ms. `KROUTER_SKIP_RUNTIME_HEAL=1` opts out entirely for
air-gapped and CI machines.

The argument parser had no terminal else, so `--prot 3000`, `-P 3000` and `start` were
dropped without a word and the server came up on the default port — which the old kill
path then force-freed. `--port` used parseInt with a `|| DEFAULT_PORT` fallback, so
"3000abc" became 3000 and a typo or missing value became the default. Both now refuse.
`--flag=value` works.

Ctrl-C at the interactive menu called process.exit(0) directly. Raw mode clears termios
ISIG so Ctrl-C arrives as a keypress, and exiting there skipped cli.js's SIGINT handler
— the only thing that kills the detached server, the privileged MITM process and any
tunnel. It now re-raises the signal.

**Windows.**
The tray was dead. tray.ps1 polls stdin from a System.Windows.Forms.Timer, whose Tick
runs on the thread Application::Run() pumps, and the loop guarded on
`[Console]::In.Peek()` — which blocks on an open-but-idle pipe rather than returning -1.
The first tick after the startup burst never returned, the message pump stopped, and the
icon appeared but ignored every click: no menu, no Quit, and since `hide` spawns a
detached --tray process, Task Manager was the only way out. Measured against a live pipe
in PowerShell 7: the old loop sat inside one tick from 212ms until the pipe closed at
2024ms; the new one returns in 0-39ms and still receives a message sent two seconds
later. An EOF branch exits instead of leaving an orphaned powershell.exe.

PXPIPE could never install: `where npm` lists the extensionless shell script first and
spawning it without a shell fails ENOEXEC. Kilo Code wrote to `~/.config/Code/User/` on
every platform — a directory VS Code never reads on Windows or macOS — and reported
success anyway. The stale-DNS recovery message printed a macOS-only `sed -i ''` against
a hosts path Windows does not have, so the single instruction offered to a user whose
provider traffic was blackholed did not work on two platforms out of three.
`krouter backfill-tokens` shelled out to a sqlite3 CLI Windows does not ship; the same
backfill already runs in pure JS at every server start.

**Security.**
`REQUIRE_API_KEY` was catalogued in envVars.js and documented in both READMEs as
"Enforce Bearer API key on /v1/* routes" — and no code read it. Remote callers already
required a key (a LAN neighbour never could spend your quota), but the loopback
exemption was unconditional, which is exactly what an operator on a shared machine is
asking to remove. The flag now gates it.

Three privileged routes were missing from LOCAL_ONLY_PATHS despite meeting its stated
bar: `/api/mitm/*` runs sudo against the OS trust store, `/api/pxpipe/*` shells out to
npm install, `/api/headroom/*` spawns a long-lived child. They fell back to the ordinary
/api gate, satisfied by holding a session rather than by being local.

"Tunnel dashboard access" only ever covered the HTML. The host test lived inside the
/dashboard branch and /api/* returns before reaching it, so with requireLogin=false a
user who enabled a tunnel for /v1 and switched dashboard access off got exactly that on
/dashboard and plaintext API keys from /api/keys over the same public hostname.

Tunnel activation's safety interlock lived only in React, so the CLI's Enable Tunnel
produced a public Cloudflare URL with the default password live. Both routes now
evaluate the same condition server-side.

`POST /api/import` took `body.sourceDir` straight into existsSync/readdirSync/readFileSync
with no allow-list or containment check, and the 404 echoed the path back as an
existence oracle. No caller passed it and GET already hardcoded the constant.

`importDb` validated only that the payload was a non-array object, so `{}` — or any
unrelated JSON picked in the file dialog — wiped settings, providerConnections,
providerNodes, proxyPools, apiKeys and combos and inserted nothing, behind a modal whose
only text was "Enter your current password to import the database." It now rejects a
payload with no recognised section and snapshots the database first.

**The dashboard reported success it had not verified.**
Enabling Presidio bricked every request on an npm install: the sidecar URL defaulted to
a Docker Compose service name, and docker-compose.yml sets that variable explicitly — so
the default only ever applied where the hostname cannot resolve. Redaction is fail-closed
by design, so flipping the toggles returned 503 on every /v1 call with nothing connecting
the two. Default fixed, and the settings route now probes the sidecar and refuses with
the URL it tried.

The MITM certificate card's sudo field was gated on `busy`, which is only set while a
request is in flight — so it appeared *after* the request had already been sent empty,
the API answered 400 "Sudo password required", and it vanished again. It could never be
typed into.

The provider master toggle awaited Promise.allSettled and discarded the results, so the
switch stayed flipped even when every write failed. The MITM DNS toggle threw an error
with the server's reason and caught it with `catch { /* ignore */ }`, leaving an open
modal with nothing to explain it. saveMappings neither checked res.ok nor reported a
throw, so a model mapping could fail to save while the field still showed it.
Bulk-deleting connections removed every attempted row regardless of outcome, so a failed
delete vanished from the list while still existing on the server.

GET /api/settings/presidio answered 404 when the config file was absent — but it is
written on first save, so a fresh install opened the page on an error quoting an absolute
filesystem path while the toggle state, readable all along, never arrived.

/v1/models fell back to the full static catalogue whenever `connections.length === 0`.
The comment said "DB unavailable", but that is equally true for a first-run user with
nothing connected, whose coding CLI then listed hundreds of models where every choice
fails. The fallback now keys on the query having failed.

**Also:** the type-hierarchy pass in 0.5.146 set secondary text to `text-text-muted/80`,
which measures 3.20:1 against the 4.5 WCAG AA minimum. Dropped, along with eleven
pre-existing sites at /50-/70. Antigravity's healthy non-streaming responses were being
filed as `empty_completion_no_output`, because the detector runs before translation and
did not know the Gemini envelope — every one of them put a false "empty" on ordinary
successful traffic in the request log and usage stats.

**Verification:** full suite **1727 passed**, 20 expected-fail, 20 skipped, stable across
four consecutive runs; production build clean. The tray fix was measured in a PowerShell
7 container against a real pipe. The process-selection fix was proven against two
byte-identical command lines. The port fix was proven in both directions — a foreign
listener survives and is named, a second kRouter instance still reclaims the port. The
security fixes were each confirmed live over the LAN interface or a simulated tunnel Host
header, with /v1 verified still reachable in every case.

# v0.5.146 (2026-08-27) — MITM setup was unusable, Antigravity broke Claude clients, Kiro leaked its reasoning

Six user-facing defects, all found by working through the product as a user rather
than by running the suite: 1691 tests passed against every one of them.

**MITM could never be set up.** The PATCH guard on `/api/cli-tools/antigravity-mitm`
required both `tool` and `action`, but `trust-cert` is a global action that correctly
sends no tool, so its own branch further down was unreachable and Trust Cert always
returned `400 "tool and action required"`. Trust Cert is step one of MITM setup, so on
a clean install the MITM server could not be started at all.

**Then it failed for a reason it would not name.** With the guard fixed, a mistyped
sudo password surfaced as `Certificate install failed`. `installCertMac` captured
sudo's stderr and threw it away, collapsing every failure into one string — the one
thing it never said was "retype your password". `describeSudoFailure` now separates a
wrong or empty password, a cancellation, and an account that cannot sudo, and passes
anything else through with its real stderr. sudo is invoked with `-p ''` so its prompt
stops being concatenated into the message.

Two more surfaced while reproducing that: the keychain can hold a stale certificate
with the same CN but a different key from an earlier run, and `delete-certificate`
removes one match per call, so a single call could leave older copies behind — it now
loops. And the install reported success purely because the command exited 0;
`add-trusted-cert` can exit 0 without the certificate becoming trusted, so the
dashboard could show green over an unchanged keychain. It now re-checks fingerprints
and fails with what to fix in Keychain Access.

**Antigravity returned bodies Claude clients cannot read.** Antigravity normalises
every model it serves — Gemini, Claude and GPT alike — to the Gemini envelope, so all
of its traffic takes the Gemini branch of `translateNonStreamingResponse`, which ended
by returning an OpenAI completion regardless of what the client spoke. A Claude client
on `/v1/messages` received `{object:"chat.completion", choices:[...]}` with no
`content` array. Same defect class as 0.5.109 (openai) and 0.5.117 (kiro); Antigravity
was never covered because its payload is nested a level deeper. Streaming was correct
throughout, so it only ever showed up on non-streaming requests.

**Truncation was invisible.** That branch also lower-cased Gemini's `finishReason` and
passed it off as an OpenAI value. Gemini says `MAX_TOKENS`; OpenAI says `length`. The
result, `"max_tokens"`, is not an OpenAI finish_reason, so `convertFinishReason` fell
through to its default and a cut-off answer reached the client as a clean `end_turn`.
Fixed on the non-streaming path first and then found still present on the streaming
one, so the mapping now lives in `open-sse/utils/geminiFinishReason.js` and both paths
import it.

**Kiro leaked its reasoning into every answer.** Kiro has no native reasoning field —
thinking is enabled by injecting `<thinking_mode>enabled</thinking_mode>` into the
system prompt, so the model returns `<thinking>` tags inside ordinary assistant text.
The stripper scanned one chunk at a time with `indexOf`, but the tags are not
chunk-aligned: a real stream opens with the delta `"<thinking"` and completes the tag
only in the next one, so neither half matched and the entire reasoning block streamed
through as visible content on every `-thinking` model. Extracted into
`open-sse/executors/kiroThinking.js`, which carries a partial tag across chunk
boundaries and flushes at end of stream. Discard semantics are unchanged.

**MITM vanished from the sidebar.** v0.5.111 added the Token Saver page by overwriting
the MITM line rather than inserting beside it. The page was untouched and still served
200, so nothing failed — MITM was simply unreachable unless you typed the URL.

**What else landed:**
- Page titles rendered smaller than the section headings inside them, so on Providers the heading read louder than the word "Providers" above it. Titles now sit at 28px with subtitles at 13px and card titles at 15px — three steps instead of one flat band. `Card` gained a `variant` (primary / default / inline); `elev` maps onto primary, so the 24 call sites already using it gain hierarchy with no page edits.
- The "Add OpenAI Compatible" button forced white-on-black through Tailwind's important modifier, which the dark theme could not override. `theme-safe-styling` now fails on any important-flagged hardcoded colour in dashboard or shared UI.
- The sidebar wordmark carried `uppercase`, rendering "KROUTER" while the login screen rendered "kRouter".
- `docs/REDACTION_SETUP.md` was excluded by `.gitignore`, so eight README links 404'd on GitHub and npm. Its npm section also pointed at an image no workflow builds and a directory the tarball does not ship — both dead ends for exactly the readers that section is for.
- llm7 Test Connection support (upstream `b57c0413`).

**Packaging:** the tarball carried the build's isolated HOME — a generated jwt-secret,
a machine-id and five SQLite databases. The databases are empty (`providerConnections`
has no rows, so no credentials were exposed) but the jwt-secret would have been
identical for everyone who installed the package. Excluded, with 187 unused `.nft.json`
trace manifests. Because reading a tarball is what let v0.5.143 ship broken, the build
now *fails* on it: `assertNothingSensitiveShipped` exits non-zero on a jwt-secret,
machine-id, `.build-home` or any SQLite file, and was confirmed to fail against the
pre-fix output. `sync-readme.js` would also have reverted the README fix at publish
time, since its rewrite rules only matched links beginning with `./`.

**Verification:** every fix was confirmed against live providers, not only in tests.
All 43 connected models answered correctly across both API surfaces — Antigravity 9/9,
Kiro 34/34, zero thinking leaks. Truncation was checked on all four combinations of
endpoint and stream, and healthy completions still report `stop` / `end_turn`. The
certificate fix was confirmed in the operator's own keychain: the stale `BEAEAE…` entry
was removed, the remaining certificate matches `rootCA.crt` at `790C96…`, and
`security verify-cert` reports success where it previously reported
`CSSMERR_TP_NOT_TRUSTED`. Full suite **1651 passed**, 20 expected-fail, 20 skipped.

# v0.5.145 (2026-08-26) — Presidio PII redaction middleware (community contribution)

Redacts personally identifiable information from requests before they reach any
provider. Contributed by **[manindersarao](https://github.com/manindersarao)** in
[PR #1](https://github.com/sifxprime/krouter/pull/1) — the feature, the design and
the sidecar are his work; this release merges it with review fixes on top.

Opt-in and off by default: both `presidioEnabled` and `presidioPiiRedaction`
default to false, and the published Docker image behaves exactly as before for
anyone who does not turn it on.

**What landed:**
- `src/middleware/redaction/middleware.js` — wraps the six LLM entry points, extracts text, sends it to a Presidio sidecar, and substitutes the redacted result before the request continues. Fail-closed by default: if redaction cannot be completed the request is rejected rather than forwarded unredacted. `REDACTION_FAIL_OPEN=true` opts out, `REDACTION_TIMEOUT_MS` tunes the sidecar timeout (default 15s).
- `presidio-sidecar/` — FastAPI service wrapping presidio-analyzer/anonymizer, with a watchdog-based hot reload so pattern edits apply without a restart.
- Dashboard page at `/dashboard/presidio` — toggles plus a YAML editor for custom regex patterns, validated server-side before it is written.
- `src/app/api/settings/presidio/route.js` — GET/PUT for the configuration, behind the existing deny-by-default `/api/*` guard.
- Coverage spans `messages`, the Anthropic top-level `system` prompt, Responses-API `input`/`instructions`, and tool traffic — `role:"tool"` results, `tool_calls[].function.arguments`, `tool_result` blocks, and tool descriptions. Tool arguments are only replaced when the redacted string still parses as JSON, so a redaction can never turn a valid tool call into a malformed one.

**Review fixes merged on top:**
- `docker-compose.yml` pinned `INITIAL_PASSWORD=123456` to bypass the default-password restriction. That restriction is the v0.5.136 remote-auth-bypass fix, which keys on `!storedHash && !process.env.INITIAL_PASSWORD` — setting the variable to the public default satisfies the guard while keeping the known password. Now required from the operator via `${KROUTER_INITIAL_PASSWORD:?...}`.
- Redaction was a silent no-op on `/v1/responses` and `/v1/responses/compact` and skipped the Anthropic `system` prompt, because the middleware returned early without `body.messages`. PII reached providers while the dashboard reported redaction as active.
- The fail-closed guarantee did not hold on `/v1beta/models/[...path]`: the middleware's error Response was passed to `handleChat()` where a Request was expected, so the rejection never reached the client.
- `getSettings()` is an uncached SQLite read; calling it per request put the database back on the hot path the in-memory HealthCache exists to keep it off. The enablement decision is now cached for 10s, and a settings-read failure no longer returns 500 to users who never enabled the feature.
- `PRESIDIO_CONFIG_PATH` defaulted to the container path `/app/redaction_config.yaml`, so saving patterns on an npm install always failed with ENOENT. Falls back to `DATA_DIR` (`~/.krouter`).
- The YAML write is a real `rename()`. The original had an `if/else` with two byte-identical branches and a cleanup step that overwrote the temp file with an empty string, so nothing was ever renamed.
- `hot_reload.py` tested the reload lock with `acquire(blocking=False)` and never released it, so one `/status` call killed hot reload for the life of the process.
- The container ENTRYPOINT ran a new root-owned init script on every start of the published image. Now gated on `PRESIDIO_CONFIG_PATH`.
- `requirements.txt` pinned exactly; pytest/pytest-asyncio/httpx moved to `requirements-dev.txt`, since the sidecar Dockerfile copies `/usr/local` out of the builder and was shipping test frameworks into a service that sees prompt text. Base image pinned to `python:3.11.16-slim`.
- `ToggleSwitch` rendered `<button role="switch">` whose only child was a decorative span, so it had no accessible name (WCAG 4.1.2).

**Verification:** full suite **1609 passed**, 20 expected-fail, 20 skipped, 0 failures; production build clean. The 20 tests the PR shipped failing were repaired — most were fixture escaping (YAML regex patterns need four backslashes, not two, so js-yaml threw and the route correctly returned 400), not defects in the handler. `PresidioSettingsCard.e2e.test.js` was removed: it collected zero tests and running it would need four new devDependencies plus a vitest environment change affecting 146 other files.

# v0.5.144 (2026-08-22) — v0.5.143 crash-loop fix, empty-completion diagnosis, MITM packaging and container gating

v0.5.143 was unusable: `app/custom-server.js` is the CLI's entry point and its first statement is `require("./server-peer-patch.js")`, but the build copied only `custom-server.js` into the package, so every install crash-looped with MODULE_NOT_FOUND. This release fixes that, ships the module the MITM child process requires inside the Docker image, and stops a provider that returns HTTP 200 with no output from being filed as an ordinary success.

**What landed:**
- `cli/scripts/build-cli.js` now copies an explicit `ENTRY_FILES` list (`custom-server.js`, `server-peer-patch.js`) and aborts the build with `process.exit(1)` if any member is missing, instead of warning and shipping a broken package. `tests/unit/cli-package-entry.test.js` parses `ENTRY_FILES` out of the build script and asserts every relative `require()` of `custom-server.js` appears in it; it was verified to fail against the 0.5.143 build definition.
- `Dockerfile` runner stage copies `src/shared/constants/mitmToolHosts.js`. `src/mitm/dns/dnsConfig.js` requires it from outside `src/mitm`, and the MITM server is spawned as a separate Node process that reads real files from disk, so Next's file tracing never covered it — the file was in no layer of the image, and MITM had been unable to start in Docker since the initial release (492ded60). `tests/unit/docker-mitm-packaging.test.js` resolves every relative require in `src/mitm`, keeps the ones landing outside it, and asserts each is covered by a runner-stage `COPY`; it fails against the pre-fix Dockerfile.
- `open-sse/utils/emptyCompletion.js` — `detectEmptyCompletion()` classifies a 200 carrying no usable output as `empty_completion_reasoning_budget`, `empty_completion_truncated`, or `empty_completion_no_output` with an actionable message; `readCompletionShape()` normalises OpenAI Chat Completions and Claude Messages bodies so the handlers do not branch on format; `EMPTY_COMPLETION_STATUS()` maps a diagnosis to a log status.
- Wired into `nonStreamingHandler.js`, `sseToJsonHandler.js` (both the Responses-stream and the buffered-JSON path), and `streamingHandler.js`. Each now saves `status: "empty"` with `warning` / `warningDetail` instead of `status: "success"`.
- The discriminator is `completion_tokens` minus `reasoning_tokens`, not accumulated text: in passthrough streaming the router forwards bytes without parsing, so content is empty even on a good response and the first version flagged every passthrough stream. The reasoning-budget branch also does not require a `finish_reason`, because the streaming path has none to give.
- `buildRequestDetail()` in `open-sse/handlers/chatCore/requestDetail.js` and the record built in `requestDetailsRepo.flushToDatabase()` both carry `warning` / `warningDetail` — two separate field allowlists were dropping the diagnosis before it reached storage. `appendLog` was deliberately not used, since `appendRequestLog` is an intentional no-op.
- `src/mitm/isContainer.js` — `detectContainer()` checks `KUBERNETES_SERVICE_HOST`, `/.dockerenv`, `/run/.containerenv`, and `/proc/1/cgroup` markers (docker, containerd, kubepods, podman, lxc, crio), with `KROUTER_FORCE_MITM=1` as an explicit escape hatch and non-Linux platforms treated as not containerized. `getMitmStatus()` returns `containerized` / `containerKind`, `GET /api/cli-tools/antigravity-mitm` forwards them, and `MitmServerCard.js` replaces the action buttons with an explanation in that case — interception rewrites the OS hosts file and terminates TLS on :443, both container-scoped, while the IDEs being intercepted run on the host. Covered by `tests/unit/mitm-container-detect.test.js`.

**Verification:** the empty-completion work was verified live on `ag/gemini-3.5-flash-low` with the same prompt — `max_tokens 40 -> completion 37, reasoning 37 => 0 output tokens, empty reply` and `max_tokens 400 -> completion 214, reasoning 212 => 2 output tokens, "AG OK"` — plus 23 new unit tests including both real live bodies as fixtures. The Docker fix was reproduced and fixed against real images: before, `/app/src/shared/constants/mitmToolHosts.js` was missing and requiring `dnsConfig.js` reproduced the user's error verbatim; after, the file is present, `dnsConfig` loads all 5 tools / 8 hosts, and `server.js` gets past module resolution to fail on "Root CA not found". The packed CLI tarball was smoke-tested by installing it into a clean prefix and booting it: `require.resolve('./server-peer-patch.js')` RESOLVES, `GET /` -> 307, `GET /v1/models` -> 200, process stays alive, 0 MODULE_NOT_FOUND, `cli.js --version` -> 0.5.144. Full suite at the end of the release: **1496 passed**, 20 expected-fail, 20 skipped, 0 failures.

# v0.5.143 (2026-08-21) — dedup concurrent Claude quota calls

The dashboard renders several widgets that each request Claude quota, so N concurrent calls fired N real requests to Anthropic and tripped the very 429 the cooldown exists to recover from. Callers arriving while a fetch is already in flight now share that promise. Ported from upstream `cd4003bc`, but adapted rather than copied — upstream restructures around a `usage/claude.js` module this fork doesn't have, and its version would have replaced the existing 429 cooldown + last-good cache (which upstream lacks), so only the missing piece was taken.

**What landed:**
- `open-sse/services/usage.js` — new `claudeUsageInFlight` Map keyed by `accessToken`. `getClaudeUsage` returns the existing entry if one is present, otherwise starts the fetch, registers the promise, and clears the entry in `.finally()` so a later call refetches.
- The original body was renamed to a private `async _getClaudeUsage(accessToken, proxyOptions)`; the exported `getClaudeUsage` is deliberately **not** `async` — an async function wraps its return value in a fresh promise, so each caller would get a distinct wrapper and the sharing would be silently lost while the `finally` bookkeeping still looked correct. The commit notes the first attempt had exactly that bug and the promise-identity test caught it.
- The existing 429 cooldown path (`CLAUDE_USAGE_COOLDOWN_MS`, `claudeUsageCooldownUntil`) and last-good cache (`claudeUsageLastGood`, `CLAUDE_USAGE_GOOD_TTL_MS`) are untouched — dedup sits in front of them, not in place of them.
- `tests/unit/claude-usage-dedup.test.js` — new file, 4 tests.
- `package.json` version bumped 0.5.142 -> 0.5.143.

**Verification:** +4 tests asserting concurrent callers for the same token receive the same promise, that different tokens are not shared, that the entry is released after settle so a later call refetches, and that the return shape is still awaitable. Full suite **1458 pass**.

# v0.5.142 (2026-08-21) — upstream batch 5: wider vision detection, Kiro cache tokens

Two cherry-picks from upstream. `detectRequiredCapabilities` only understood OpenAI/Claude content blocks, so a vision request from an Ollama/Hermes or Vercel-AI-SDK client read as text-only and the capacity adapter never swapped in a vision-capable model. Separately, `kiroToClaudeResponse` dropped the cache token counts the Kiro executor already computes, so every Claude-format client mispriced a cached turn.

**What landed:**
- `open-sse/services/combo.js` — `detectRequiredCapabilities` now runs a `scanMessage` helper over `body.messages` instead of calling `scanContent(m.content)` directly. It adds `vision` for a non-empty Ollama/Hermes `images[]` array, walks `experimental_attachments`/`attachments` and infers the modality from `contentType`, `mediaType`, or the mime in a `data:` URL (falling back to `vision` when an attachment has a `url` or `data` but no mime), adds `vision` for a message-level `image_url`/`image` and `audioInput` for `audio_url`/`audio`, and scans plain string content for embedded `data:image/` and `data:audio/` URIs. The existing block scan still runs, and the `body.input` / `body.contents` paths are untouched.
- `open-sse/translator/response/kiro-to-claude.js` — `kiroToClaudeResponse` now carries `cache_read_input_tokens` and `cache_creation_input_tokens` onto `state.usage`. Both spellings are accepted: the Chat shape the executor emits (`usage.cache_read_input_tokens` / `usage.cache_creation_input_tokens`) and the nested passthrough form (`usage.prompt_tokens_details.cached_tokens` / `.cache_creation_tokens`). Only numeric values are copied.
- `tests/unit/vision-detect-clients.test.js` — new file, 7 cases: `images[]`, `experimental_attachments`, a data-URL-only attachment, message-level `image_url` and `audio_url`, a `data:image/` URI inside string content, the standard OpenAI `image_url` block, and a plain-text message asserting no capabilities are added.
- Two upstream hunks were deliberately left out. The strip half of 345cdcf6 has no home in this fork — there is no `translator/concerns/modality.js` here. The rest of b44bb09f relaxes the fail-closed terminal gate shipped in v0.5.133 and needs the stop-disposition hunks landed with it, so it stays its own change.

**Verification:** the commit states +7 tests covering each client shape, the standard OpenAI block (no regression), and plain text (no false positives), with the full suite at 1454 pass.

# v0.5.141 (2026-08-21) — upstream batch 4: Alibaba Token Plan + Fish Audio TTS

Two new providers ported from upstream (b04c03c6 and 8af5e752). Upstream ships both as provider-registry entries this fork doesn't have, so each was wired by hand with the two alias maps kept in agreement. Alibaba Token Plan is an LLM provider and went through all four points kRouter actually uses — transport, catalog, UI branding, and `ALIAS_TO_PROVIDER_ID`. Fish Audio is a TTS provider, so it has no transport or catalog entry; it is wired through UI branding + `ttsConfig`, `ALIAS_TO_PROVIDER_ID`, and its own format handler, which it needs because it puts the model id in an HTTP header rather than the request body.

**What landed:**
- `open-sse/config/providers.js` — `alitp-intl` transport entry pointing at `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions` with `format: "openai"`. It is a separate product from the existing `alicode-intl`: a prepaid token plan on the Singapore host with its own catalog.
- `open-sse/config/providerModels.js` — six models under `alitp-intl`: `qwen3.8-max-preview`, `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-flash`, `glm-5.2`, `deepseek-v4-pro`.
- `src/shared/constants/providers.js` — `APIKEY_PROVIDERS["alitp-intl"]` (name "Alibaba Token Plan", textIcon `ATP`, `serviceKinds: ["llm"]`) and `APIKEY_PROVIDERS["fish-audio"]` (textIcon `FA`, `serviceKinds: ["tts"]`) with a `ttsConfig` — `baseUrl` `https://api.fish.audio/v1/tts`, `authType: "apikey"` / `authHeader: "bearer"`, `format: "fish-audio"`, four models (`s2.1-pro-free`, `s2.1-pro`, `s2-pro`, `s1`).
- `open-sse/handlers/ttsProviders/genericFormats.js` — new `fishAudio` handler registered in `FORMAT_HANDLERS` under the key `"fish-audio"`. It sends the model id as a `model` HTTP header (defaulting to `s2.1-pro-free`), adds the voice as a `reference_id` body field when one is supplied, requests `format: "mp3"`, and returns the raw binary response via `responseToBase64(res, "mp3")`; non-2xx goes through `throwUpstreamError`.
- `open-sse/services/model.js` — `ALIAS_TO_PROVIDER_ID` gains self-mapping entries `"alitp-intl"` and `"fish-audio"`, so routing agrees with the catalog aliases declared in `APIKEY_PROVIDERS`.

**Verification:** the commit states it verified per provider that the alias resolves, `parseModel` splits correctly, the transport is present, the catalog is populated, the UI entry is present, and `ALIAS_TO_ID` agrees; that Fish Audio's handler is registered and its `ttsConfig` resolves; and that the full suite is **1447 pass**. Live chat against either service needs the user's own API key, so it was not exercised.

# v0.5.140 (2026-08-21) — upstream batch 3: Gemini cached tokens, Hermes api_key

Two upstream ports. Gemini usage extraction had grown two branches — the original top-level `usageMetadata` reader and a second one added in 0.5.51 for the wrapped `{ response: { usageMetadata } }` envelope that Antigravity / Cloud Code Assist / gemini-cli send — and neither branch read `cachedContentTokenCount`, so cached prompts were logged as fresh tokens. Separately, Hermes ignores `OPENAI_API_KEY` from `.env` unless the YAML model block names it, so generated Hermes configs sent unauthenticated requests.

**What landed:**
- `extractUsageFromResponse` in `open-sse/handlers/chatCore/requestDetail.js` (upstream 59d858b6): one Gemini branch now resolves `responseBody.usageMetadata || responseBody.response?.usageMetadata` and reads both shapes through the same mapping. The duplicated 0.5.51 branch below it is deleted — it was unreachable once the unified branch landed above it.
- That unified branch now emits `cached_tokens: usageMetadata.cachedContentTokenCount || 0` for both envelope shapes, and `reasoning_tokens` picks up a `|| 0` so every counter defaults to 0 rather than `undefined`.
- `src/app/api/cli-tools/hermes-settings/route.js` (upstream e2a4fe04): the generated model block gains `api_key: ${OPENAI_API_KEY}` alongside `default`, `provider: "custom"`, and `base_url`.
- `src/app/(dashboard)/dashboard/cli-tools/components/HermesToolCard.js`: the same `api_key: ${OPENAI_API_KEY}` line added to the dashboard card's copy-paste YAML. The card's `sk_krouter` fallback for the non-cloud case is unchanged (upstream's string is `sk_9router`).
- `tests/unit/gemini-usage-envelope.test.js` — new file, 4 cases: bare `usageMetadata`, the wrapped Antigravity payload, `cached_tokens` surviving the wrapped shape (asserts 900, the counter previously dropped), and missing counters defaulting to 0.

**Verification:** the commit states +4 tests covering both envelope shapes, the cached_tokens gap specifically, and zero-defaulting, with the full suite at 1446 pass. No live provider check is claimed.

# v0.5.139 (2026-08-21) — upstream batch 2: Docker sql.js, Antigravity 429 marker, fusion, probe, headroom

Four upstream commits ported as five changes in one commit, each fixing a path that failed for a different reason: a container with no database at all, an Antigravity 429 that had nothing to do with quota, a DeepSeek rejection in the Fusion panel, a connection probe that starved reasoning models, and a Headroom toggle you could not turn back on once the proxy went down.

**What landed:**
- `Dockerfile` — `COPY --from=builder /app/node_modules/sql.js ./node_modules/sql.js` into the runtime image. sql.js loads `dist/sql-wasm.wasm` by path at runtime and module tracing only follows JS imports, so the last-resort pure-JS DB driver aborted with ENOENT and a container that fell back to it had no working database at all. (upstream 27f3710c)
- `open-sse/executors/antigravity.js` — strip the competitor agent marker `"You are a Claude agent, built on Anthropic's Claude Agent SDK."` out of every `requestWithoutTools.systemInstruction.parts[].text`. Antigravity flags requests carrying it and answers 429 "Quota Exhausted" immediately regardless of real quota. Applied at our `ANTIGRAVITY_REQUEST_BLACKLIST` anchor (we have no `stripBlacklisted()`), and complementary to `obfuscateBodyStrings`, which only rewrites `contents` and never touches `systemInstruction`. (upstream b566b20a)
- `open-sse/services/combo.js` — `handleFusionChat` now destructures `stream_options` out of `body` alongside `tools`/`tool_choice` before building `panelBody` with `stream: false`. Panel calls run non-streaming and DeepSeek rejects the field with "stream_options should be set along with stream=true". (upstream 6d30ce6d)
- `src/app/api/models/test/ping.js` — `pingModelByKind` raises the probe from `max_tokens: 1` to `1024`, and soft-passes a reasoning-only reply: when a choice is present and the first choice has `finish_reason: "length"`, empty `content`, and a non-empty `reasoning` / `reasoning_content` / `thinking` / `thinking_content`, it returns `ok: true` with `note: "reasoning-only response (length-limited)"` instead of the "no choices" failure. Trade-off stated in the diff: a manual Test click can now bill up to 1024 output tokens. (upstream 6d30ce6d)
- `src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js` — the Headroom `Toggle` is now `checked={headroomEnabled}` with the `disabled={!headroomRunning}` gate removed; it reflected sidecar liveness rather than the saved setting, so it rendered OFF and unclickable whenever the proxy was down, leaving no way to re-enable it. Not-running is still shown by the status label and the Setup button beside it. (upstream 71dcdc10)
- `package.json` — version 0.5.138 to 0.5.139.

**Verification:** full suite 1442 pass, every touched file parse-checked, and a full production build compiles (including /dashboard/token-saver — the unit suite never compiles dashboard components, and an earlier draft of the toggle comment was invalid JSX that only the build caught).

# v0.5.138 (2026-08-21) — upstream batch: token limits on /v1/models, empty tool_calls truncation, prompt cache key, glm-5.3

Four upstream commits ported in one release. The headline fix is `/v1/models` never publishing token limits under the snake_case names the OpenAI/OpenRouter convention uses — clients found nothing, guessed the window from the model name, and guessed HIGH, so a 372k model read as 1.05M never hit its compaction threshold and hard-failed upstream.

**What landed:**
- `src/app/api/v1/models/route.js` (upstream 30fec431) — `buildModelsList` now imports `getCapabilitiesForModel` from `open-sse/providers/capabilities.js` and, for LLM-kind entries (`kind === LLM_KIND || allowAsLlm`), emits `context_length` and `max_completion_tokens` at the top level of each model object when the resolved value is finite. The existing nested `capabilities` object (service-kind flags such as `vision`) is left untouched for compatibility. Adapted from upstream: our route has a single connected-provider loop rather than upstream's capability chain, so the limits are sourced from `getCapabilitiesForModel` there.
- `open-sse/translator/response/openai-responses.js` (upstream 10a923da) — `openaiToOpenAIResponsesResponse` guarded `delta.tool_calls` on truthiness alone, but an empty array is truthy, so a provider emitting `tool_calls: []` called `closeMessage` and truncated the assistant text. The check is now `delta.tool_calls && delta.tool_calls.length`.
- `open-sse/translator/request/openai-responses.js` (upstream 70ba0024) — `openaiToOpenAIResponsesRequest` copies `body.prompt_cache_key` onto the result when defined, so upstream prompt caching keys on the same value across turns. The opposite-direction `delete` in `openaiResponsesToOpenAIRequest` is correct and was left untouched.
- `open-sse/config/providerModels.js` (upstream 8ed9da71) — `glm-5.3` added to both the `glm` and `glm-cn` catalogs. The commit notes it inherits capabilities from the existing `*glm-5*` pattern (200k context / 128k output, same as glm-5.2 resolves to under these providers) and pricing from `glm-5*`, so the catalog entry was all that was needed.

**Verification:** per the commit message, verified live on :20128 — `/v1/models` went from 0 to 69/75 models carrying real `context_length` + `max_completion_tokens`. Full suite 1442 pass, 0 regressions.

# v0.5.137 (2026-08-21) — Kiro MITM interception broken on IDE 1.0.228+ (5b417f9b)

Kiro IDE 1.0.228+ moved `GenerateAssistantResponse` off the `/generateAssistantResponse` path onto `POST /` with an `x-amz-target: KiroRuntimeService.GenerateAssistantResponse` header. The MITM matcher was path-only, so every chat turn failed the `isChat` test and was passed straight through to AWS — MITM showed as enabled, the model mapping was configured, and nothing was actually routed, silently and with no error anywhere.

**What landed:**
- `src/mitm/config.js`: new exported `isChatRequest(tool, req)` — keeps the existing `URL_PATTERNS` path match and adds the `x-amz-target` header form for `kiro` only. Non-chat calls on the same host (e.g. `ListAvailableModels`) still pass through, and the header rule does not apply to other tools.
- `src/mitm/server.js`: the interception branch now calls `isChatRequest(tool, req)` instead of matching `req.url` against `URL_PATTERNS` inline.
- `src/mitm/handlers/kiro.js`: Kiro's `SmithyMessageDecoderStream` requires an initial-response frame at stream start or it rejects the stream before the first token renders. `buildEventStreamFrame()` now takes a content-type (default `application/json`), `buildInitialResponseFrame()` emits an `initial-response` event carrying `{ conversationId }` as `application/x-amz-json-1.0`, and `withInitialFrame()` prepends it exactly once per stream — tracked by a new `initialSent` field in `initKiroState()`, and emitted even when the first chunk carries only a role/empty delta and produces no frames of its own.
- `src/shared/constants/cliTools.js`: `MITM_TOOLS.kiro.mitmDomain` changed from `q.us-east-1.amazonaws.com` to `runtime.us-east-1.kiro.dev` (already present in `TARGET_HOSTS`/`getToolForHost`, so routing was consistent already).
- `handlers/kiro.js` exposes the framing helpers through a `__test__` export rather than loosening `module.exports`; upstream's Persian inline comment on the frame-count branch was rewritten in English.

**Verification:** +8 tests in `tests/unit/kiro-mitm-1.0.228.test.js` — the new header form is intercepted, the legacy path still is, `ListAvailableModels` and other tools are unaffected, and the initial-response frame is decoded byte-for-byte to confirm the three Smithy system headers (`:message-type=event`, `:event-type=initial-response`, `:content-type=application/x-amz-json-1.0`), that it is emitted exactly once per stream ahead of the first real event, and that regular frames keep `application/json`. Full suite **1442 pass**, 0 regressions; app boots clean and the MITM status API is healthy.

# v0.5.136 (2026-08-19) — SSRF on /v1/search, default-password remote login, conversation-history leak

Three confirmed vulnerabilities, ported from upstream 8a527fec and each verified against a running instance before and after. This lands on top of v0.5.135 because the second fix depends on `isLocalRequest()` being trustworthy, which it now is.

**What landed:**
- **SSRF on `/v1/search`** — `resolveBaseUrl()` in `open-sse/handlers/search/callers.js` returned the client-supplied `providerOptions.baseUrl` verbatim and fed it to all 11 outbound search request builders, so a caller could point `/v1/search` at `169.254.169.254` (cloud metadata), a loopback admin port, or any host on the private network and read the response back through us. An override is now parsed as a `URL`, rejected unless the protocol is `http:`/`https:`, and passed through `assertPublicUrl()` from `src/shared/utils/ssrfGuard.js` — the same allowlist the fetch tool already enforced, which was sitting unused on this path. The no-override case is unchanged.
- **Default-password remote login** — in `src/app/api/auth/login/route.js`, `setDashboardAuthCookie()` ran *before* `mustChangePassword` was computed, so a remote caller who tried the public default `"123456"` received a valid dashboard JWT and could ignore the advisory flag, then `PATCH /api/settings` to turn auth off. The check now runs first: `usingDefaultPassword = !storedHash && !process.env.INITIAL_PASSWORD`, and a non-local caller is refused with `403` and no `Set-Cookie`, with a message saying the password must be set from the machine running kRouter. Local login is untouched; the success body now returns `mustChangePassword: false`.
- **Conversation-history disclosure** — `src/app/api/usage/request-details/route.js` returned stored `request` / `providerRequest` / `providerResponse` / `response` bodies unmodified, and `/api/usage` is in the "allow through when `requireLogin` is disabled" group, so with auth off any caller reaching the port could read every prompt and completion. Adapted rather than copied: upstream redacts unconditionally, which would also blind the dashboard's own request inspector (`RequestDetailsTab` renders these bodies). We redact those four fields to `{ redacted: true }` only when the caller is not provably the owner — `trusted = isLocalRequest(request) || await hasRealDashboardSession(request)`. Metadata (model, tokens, latency, status) is never redacted.
- `hasRealDashboardSession()` added to `src/dashboardGuard.js` — wraps `hasValidToken()` and deliberately ignores the `requireLogin: false` escape hatch that `isAuthenticated()` honours, since that hatch makes every caller look authenticated.
- `tests/unit/security-trio-0.5.136.test.js` — 5 SSRF cases against `resolveBaseUrl`: metadata IP, loopback/private ranges (`127.0.0.1`, `localhost`, `192.168.1.1`, `10.0.0.5`, `[::1]`), `file://`, a legitimate public override that still resolves, and the no-override default.

**Verification:** verified live on the machine over the LAN interface — remote login with `"123456"` returns 403 with zero `Set-Cookie` headers (was: valid JWT); remote history with `requireLogin=false` returns all 4 body fields as `{"redacted":true}` with metadata kept; local history with `requireLogin=false` returns all 4 bodies intact (inspector still works); remote history with `requireLogin=true` returns 401. Plus the 5 new SSRF unit tests. Full suite **1434 pass**, 0 regressions.

# v0.5.135 (2026-08-19) — remote auth bypass via spoofed Host header (CRITICAL)

`isLocalRequest()` decided "is this caller on loopback?" from the `Host` header — a value the caller chooses. Any remote client sending `Host: localhost` was treated as local, and local means API-key-less access to `/v1` plus exemption from the auth rate limiter. The fix stops trusting headers and trusts the TCP socket instead, with a per-process secret proving the peer metadata was stamped by our own wrapper.

**What landed:**
- `server-peer-patch.js` (new, extracted out of `custom-server.js`) — mints a per-process `PEER_TOKEN` into `process.env.KROUTER_PEER_TOKEN`, wraps `http.createServer`, **deletes** any client-supplied `x-9r-real-ip` / `x-9r-peer-token` / `x-forwarded-for` / `x-9r-via-proxy`, then stamps the true `req.socket.remoteAddress` plus the token. Sets `x-9r-via-proxy: 1` when the request arrived carrying `x-forwarded-for` or `x-real-ip`, since the loopback socket is then the proxy hop, not the end user.
- `src/lib/auth/trustedPeer.js` (new) — `hasTrustedPeerHeaders()` / `getTrustedPeerIp()` return the peer IP only when the header token matches the env secret (length-checked constant-time-ish compare); `isLoopbackIp()` handles `127.0.0.0/8`, `::1`, `0:0:0:0:0:0:0:1` and `::ffff:127.0.0.1`. The old check was a three-entry `Host` allowlist (`localhost` / `127.0.0.1` / `::1`) fed through `split(":")[0]`, which collapsed IPv6 forms such as `::1` and `::ffff:127.0.0.1` to `""` and had no notion of `127.0.0.0/8` at all — so genuine loopback callers were turned away while `Host: localhost` from anywhere was waved through.
- `src/dashboardGuard.js` — `isLocalRequest()` now uses the proven IP. With no proof it fails **closed** in production instead of falling back to `Host`; under `next dev` (no wrapper) the `isLoopbackHostname` heuristic is kept so local development still works.
- `src/lib/auth/loginLimiter.js` — `getClientIp()` goes through `getTrustedPeerIp()`. Previously a client could send `x-9r-real-ip` itself and rotate it per attempt for a fresh lockout bucket, defeating the progressive lockout entirely.
- `package.json` — `start` and `start:bun` now boot through `custom-server.js` (they ran `.next/standalone/server.js` directly, so the header stripping never ran in production at all), `dev` preloads the patch via `NODE_OPTIONS='--require ./server-peer-patch.js'`, and `build:deploy` copies `custom-server.js` and `server-peer-patch.js` into the standalone output.
- `custom-server.js` — resolves the Next entry from `server.js` or `.next/standalone/server.js` and errors out if neither exists, instead of `require("./server.js")`, which does not exist at repo root.
- Dependency bump reported in the commit message but not visible in the diff, since no lockfile is tracked in this repo and the `package.json` range is unchanged at `^7.19.2`: undici 7.28.0 -> 7.29.0 (undici backs proxy testing and image fetching), reported as taking `npm audit` from 7 vulnerabilities (6 high) to 0.

**Verification:** proven end-to-end against a running instance on this machine (server listens on 0.0.0.0; Docker sets `HOSTNAME=0.0.0.0` by default) — before the fix, remote LAN + honest Host + no key returned 401 while remote LAN + `Host: localhost` + no key returned 200 with a real Claude completion ("PWNED") billed to the victim's credits; after the fix both return 401, including when the attacker also forges `x-9r-real-ip` and `x-9r-peer-token`. Regression-checked live: loopback with key, loopback without key, CLI-token route, and remote WITH a valid key all still return 200. dashboard-guard 15/15, full suite 1429 pass.

# v0.5.134 (2026-08-19) — detect and surface the orphaned-MITM-DNS blackhole

Reported as "some users can't enable MITM", but the real failure is quieter and worse: kRouter could leave `/etc/hosts` redirects pointing the intercepted provider hosts at `127.0.0.1` while the MITM server was down, so every Antigravity/Kiro/Copilot request died as a bare "fetch failed" that looks like a network fault. The cleanup needs root — on exit it is best-effort and silently fails when sudo is password-gated, and auto-start then bailed for the same reason without ever checking DNS, so the redirects outlived both the server and the `mitmEnabled` setting. This release detects that state, reports it, and tries to heal it — while refusing to claim success it cannot prove.

**What landed:**
- `getMitmStatus()` in `src/mitm/manager.js` returns two new fields: `staleDnsTools` (`running ? [] : Object.keys(dnsStatus || {}).filter((t) => dnsStatus[t])`) and `staleDns` (true when that list is non-empty) — DNS redirects active while the server is down.
- `src/mitm/manager.js` now re-exports `removeAllDNSEntries` (defined in `src/mitm/dns/dnsConfig.js`) alongside the existing `removeAllDNSEntriesSync`, so the init path can call the async cleanup.
- `GET /api/cli-tools/antigravity-mitm` passes `staleDns` and `staleDnsTools` through in its JSON response (defaulting to `false` / `[]`), so the dashboard can show a fixable warning instead of leaving the user hunting a phantom network error.
- `autoStartMitm()` in `src/shared/services/initializeApp.js` hoists the stale-DNS check **above** the `if (!settings.mitmEnabled) return`, `if (mitmStatus.running) return`, and `loadEncryptedPassword()` early-returns — the MITM-disabled path is how most users get stuck, and it previously returned before any DNS check ran.
- The self-heal verifies its own result: `removeAllDNSEntries()` only logs per-tool failures and never throws, so a successful return proves nothing. The block re-reads `getMitmStatus()` afterwards and only logs success when `after.staleDns` is false; otherwise it names the still-affected tools and prints the exact fix — toggle MITM on in the dashboard, or `sudo sed -i '' -E '/(cloudcode-pa|kiro\.dev|codewhisperer|githubcopilot|cursor\.sh)/d' /etc/hosts && sudo dscacheutil -flushcache`.
- `package.json` version bumped 0.5.133 → 0.5.134.

**Verification:** verified live on macOS on a real broken machine (this Mac): status went from a silent `{running:false, dnsStatus:{antigravity:true,kiro:true}}` to `staleDns:true` / `staleDnsTools:[antigravity,kiro]`; startup now logs the warning, the self-heal attempt, and the truthful "Could NOT remove ... FIX: `<command>`" when sudo blocks it — confirming the false-success path was real and is now gone. Full suite **1429 pass**, 0 regressions. No test files were touched by this commit.

# v0.5.133 (2026-08-09) — Kiro stream fail-closed: terminal integrity gate (7c7fae39)

The stream half of upstream 7c7fae39; the non-stream half shipped in v0.5.130. Kiro's stream handler no longer forwards bytes to the client as they arrive — it buffers all semantic output privately behind an SSE heartbeat and releases it only after a clean AWS EventStream EOF is confirmed. An incomplete, corrupt, or malformed stream now fails closed with an error SSE instead of collapsing into a false `finish_reason:"stop"`.

**What landed:**
- `KiroExecutor.execute` now calls `attachIntegrityGate` on every OK response, replacing `result.response` with a new `Response` that wraps a `ReadableStream` (carrying `SSE_HEADERS`). The stream emits `: kiro-validation\n\n` comment frames every `KIRO_REPAIR_HEARTBEAT_MS` (10s) while validation runs, then enqueues the buffered bytes in one shot on success. Client abort is forwarded to an internal `AbortController` and `cancel()` tears the gate down.
- `parseEventFrame` in `open-sse/executors/kiro.js` validates the AWS EventStream binary framing before trusting a frame: 16-byte minimum, prelude `total_length`/`headers_length` agreement, bounds against `EVENTSTREAM_MAX_MESSAGE_BYTES` (24 MB) and `EVENTSTREAM_MAX_HEADERS_BYTES` (128 KB), prelude CRC32 and whole-message CRC32, duplicate-header rejection, per-header-type bounds checks, and a JSON-parse guard on the payload.
- `stopDisposition(stopReason, hasToolCalls)` classifies the terminus into `complete` / `tool_use` / `length` / `retryable_protocol_failure` / `terminal_incomplete` / `terminal_refusal` / `unknown_failure`. `malformed_model_output` and `invalid_model_output` are retryable; `cancelled`, `pause_turn`, `model_context_window_exceeded` and `max_tokens`-with-tool-calls are terminal; content-filter/guardrail/safety/policy/blocked reasons map to refusal.
- `runIntegrityRecovery` retries **once** for any recoverable non-terminal outcome — including a `missing_terminal` from a transport read failure or TTFT timeout. Only the appended prompt hint is kind-specific: a malformed `tool_call` wrapper, ellipsis-only output, and a short future-action final (`isShortFutureAction`, English + Chinese patterns with result-clause counter-checks so completed findings are not retried) get a `REPAIR_INSTRUCTIONS` sentence appended to `body.systemPrompt` via `appendRepairInstruction`; every other kind retries with an unmodified body. No model-controlled parser detail is fed back into the prompt.
- `encodeSSEError` emits a `data: {error:{...}}` + `data: [DONE]` pair whose `details` carry a diagnostics object (`terminal_provenance`, `transport_state`, `stop_reason`, `stop_disposition`, `response_state`, `event_counts`, `incomplete_frame_bytes`) under codes including `kiro_terminal_incomplete`, `kiro_terminal_refusal`, `kiro_unknown_stop_reason`, `kiro_upstream_eventstream_error`, `kiro_integrity_buffer_exceeded`, `kiro_integrity_retry_upstream_error`, and the four `*_retry_failed` codes.
- Bounds are env-overridable: `KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES` (default 8 MB), `KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS` / `_STALL_TIMEOUT_MS` (falling back to `KIRO_TOOL_CALL_REPAIR_TIMEOUT_MS`, then the new `STREAM_FIRST_CHUNK_TIMEOUT_MS`). The tool-call repair specifically can be switched off per-connection via `providerSpecificData.kiroToolCallRepair === false` or globally via `KIRO_TOOL_CALL_REPAIR=false` — with it off, a malformed wrapper short-circuits to an `invalid_kiro_tool_call` SSE instead of retrying, while the other retry paths are unaffected.
- `open-sse/config/runtimeConfig.js`: new `STREAM_FIRST_CHUNK_TIMEOUT_MS` export — 200000 ms default, `STREAM_FIRST_CHUNK_TIMEOUT_MS` env override with a positive-integer guard.
- `open-sse/utils/sseConstants.js` (new, deliberately import-free): `SSE_DONE`, `SSE_HEADERS` (Content-Type / Cache-Control / Connection), `SSE_HEADERS_NO_BUFFER` (Content-Type / Cache-Control / `X-Accel-Buffering: no`, without keep-alive), `SSE_HEADERS_CORS`. Only `kiro.js` consumes it at this commit, importing `SSE_DONE` and `SSE_HEADERS`; the other two exports are staged for later consumers.
- Ported by adopting upstream's rearchitected `kiro.js` (1201 lines) as the base. The fork divergences were already present in it — thinking-tag strip, `reasoningContentEvent` -> `reasoning_content`, multi-URL fallback (a superset of ours), `refreshCredentials`/`transformRequest`. The one thing upstream lacked, the `x-request-source: local` MITM anti-loop header in `buildHeaders`, was re-integrated.
- Tests: new `tests/unit/kiro-terminal-integrity.test.js`; `tests/unit/kiro-thinking-strip.test.js` mock frames now compute real prelude and message CRC32s (the new parser rejects them otherwise) and gained two cases — stop is withheld until clean EOF after `messageStopEvent`, and a tool-only stream finishes with `tool_calls`.

**Verification:** +72 Kiro cases — `kiro-terminal-integrity` (25-case synthetic-frame integrity spec) plus thinking-strip and non-stream-error -> 76 pass. Full suite **1429 pass**, 0 new failures. Live on `:20128` against a real Kiro account (`kr/claude-sonnet-4.5`): non-stream -> 200 "OK"; stream -> content deltas ("one"/" two three", "Hello.") with a clean `finish_reason:"stop"` and `[DONE]`. Happy path intact through the new private-buffer-until-EOF gate, and the primary endpoint's fetch-fail fell back correctly.

# v0.5.132 (2026-08-09) — Claude Code max-context setting (8b0fcf4b)

Adds a "Max context" dropdown to the Claude Code tool card that writes `CLAUDE_CODE_MAX_CONTEXT_TOKENS` into the generated `~/.claude/settings.json`. Adapted from upstream `8b0fcf4b`, which builds the control around an `exaMcpEnabled` scaffold this fork does not have — here the value is threaded into the `env` object that `/api/cli-tools/claude-settings` already persists wholesale, so no route change was needed.

**What landed:**
- `CONTEXT_OPTIONS` in `src/app/(dashboard)/dashboard/cli-tools/components/ClaudeToolCard.js` — five presets whose labels are round numbers but whose values sit 2K under the upstream hard cap: Default (`""`), 200K (`198000`), 300K (`298000`), 500K (`498000`), 1M (`998000`).
- New `maxContextTokens` state plus a `<select>` in the expanded card, laid out on the same `sm:grid-cols-[8rem_auto_1fr_auto]` row pattern as the surrounding settings, with a `Tooltip` noting the value applies on Apply Settings.
- Apply path: `if (maxContextTokens) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = maxContextTokens;` before the `POST /api/cli-tools/claude-settings` call — the key is omitted entirely when the preset is Default.
- `getManualConfigs()` sets the same key on its `env` object, so the copy-paste `~/.claude/settings.json` block matches what Apply writes.
- Restore-from-status init reads `env.CLAUDE_CODE_MAX_CONTEXT_TOKENS || ""` back into the dropdown; the reset handler clears it to `""`.
- `package.json` version bumped `0.5.131` -> `0.5.132`.

**Verification:** the commit states JSX parses clean under esbuild and the app compiles with no error. It also states the dropdown was not visually checked — the dashboard password login was not entered — and asks for a glance post-pull.

# v0.5.131 (2026-08-09) — OpenDesign cli-tools catalog entry (upstream 651df2f0)

Phase 3c of the upstream port: OpenDesign, an agent-native design skills pack that installs into the host agent (Claude Code, Cursor, OpenAI Codex CLI, Gemini CLI, OpenCode) rather than running as its own process. It is a guide-only catalog card — no executor, no env vars — so `/opendesign` inherits the host agent's model config and rides whatever kRouter routing the host is already pointed at. Upstream's 9Router branding was adapted to kRouter in the card copy.

**What landed:**
- `CLI_TOOLS.opendesign` in `src/shared/constants/cliTools.js` (+38 lines, purely additive) — `configType: "guide"`, `docsUrl` `https://github.com/manalkaff/opendesign`, color `#7C3AED`.
- Two `notes` entries explaining that OpenDesign inherits the host agent's model config (so no extra env vars are needed once the host points at kRouter) and that it is invoked as `/opendesign <brief>`.
- Three `guideSteps` — install the plugin, no config needed, start designing — with the third carrying a `copyable: true` example invocation. These render through `DefaultToolCard.js`, which falls back to "Coming soon..." for any tool without `guideSteps`.
- A bash `codeBlock` with the per-host install commands: `/plugin marketplace add manalkaff/opendesign` + `/plugin install opendesign@opendesign` (Claude Code), `/add-plugin opendesign` (Cursor), `/plugins` search (Codex CLI), `gemini extensions install <repo-url>` (Gemini CLI), and the `.opencode/INSTALL.md` path for OpenCode.
- The card points `image` at `/providers/opendesign.png`; the commit ships no PNG — only `package.json` (version bump to 0.5.131) and `cliTools.js` changed.

**Verification:** the commit states that `CLI_TOOLS.opendesign` is present with `configType "guide"`, that existing entries are intact, and that `cliTools.js` parses. No test count or live check is claimed — the commit argues the change is safe because an additive catalog card cannot touch the chat path.

# v0.5.130 (2026-08-09) — Kiro non-stream fail-closed (7c7fae39, safe half)

The forced-SSE-to-JSON path used by non-streaming clients parsed every `data:` line into a chunk list and threw away anything that wasn't a semantic chunk. An explicit `error` chunk in an upstream Kiro stream was therefore dropped, and the partial content that arrived before it collapsed into a 200 response with `finish_reason: "stop"` — an errored generation presented to the client as a complete answer.

**What landed:**
- `parseSSEToOpenAIResponse` (`open-sse/handlers/chatCore/sseToJsonHandler.js`): tracks a `streamError` while scanning `data:` lines — a chunk with an `error` field sets it instead of being pushed onto `chunks`, and the function returns `{ error }` up front. A terminal error wins over earlier semantic chunks.
- `handleForcedSSEToJson`: on `parsed.error`, returns `createErrorResult(HTTP_STATUS.BAD_GATEWAY, parsed.error.message || "Upstream SSE stream failed")`. The early return sits above the `onRequestSuccess` call, so a failed stream is no longer recorded as a success.
- `tests/unit/kiro-nonstream-error.test.js` — two cases: a terminal error chunk preferred over a preceding `delta.content` chunk, and `handleForcedSSEToJson` returning `success:false` / status 502 with no `choices` key on the body.
- `package.json` bumped to 0.5.130.

This is deliberately the contained half of upstream `7c7fae39`: it fails closed only on an **explicit** error chunk, so it cannot false-positive on a legitimate response. The commit records that the 1,429-line stream rewrite (AWS EventStream frame/CRC validation, stop-disposition classification, retry-once on malformed-tool/ellipsis/short-sentence) was deferred — it is a diverged `kiro.js` rewrite that needs upstream's 778-line synthetic-frame suite to port safely.

**Verification:** +2 unit tests (terminal error preferred; 502 not collapse), full suite **1357 pass**. Live on `:20128`: a real Kiro non-stream chat (`kr/claude-sonnet-4.5`) still returns 200 through the changed handler — happy path intact.

# v0.5.129 (2026-08-09) — embeddings request-build hardening (Phase 3c of fe547f4d)

The embeddings request-build in `open-sse/handlers/embeddingsCore.js` ran bare: `adapter.buildUrl` / `buildHeaders` / `buildBody` were called with no guard, so an adapter that rejects a misconfigured connection — e.g. a self-hosted embedding endpoint with no `baseUrl`, which throws rather than silently falling back to `api.openai.com` — escaped uncaught as a 500 or a request that never settled. Upstream `fe547f4d` also adds self-hosted STT/TTS/embedding providers; those are deliberately not ported, only this standalone safety half, which protects every embedding adapter.

**What landed:**
- `handleEmbeddingsCore` wraps the three adapter calls (`buildUrl`, `buildHeaders`, `buildBody`) in a `try/catch`; on throw it logs `Request build failed: <message>` under the `EMBEDDINGS` tag and returns `createErrorResult(HTTP_STATUS.BAD_REQUEST, "[<provider>/<model>] <message>")` — a config mistake is the caller's 400, not a server 500.
- The upstream `fetch` is bound with `AbortSignal.timeout(FETCH_CONNECT_TIMEOUT_MS)` (60_000 ms, from `open-sse/config/runtimeConfig.js`), spread in conditionally on `typeof AbortSignal?.timeout === "function"` so older runtimes that lack it still build a valid init object. An abort throws into the existing `catch`, which already maps fetch failures to `HTTP_STATUS.BAD_GATEWAY` via `formatProviderError` — so a dead endpoint now fails fast as a 502 instead of hanging.
- `FETCH_CONNECT_TIMEOUT_MS` added to the existing `runtimeConfig.js` import alongside `HTTP_STATUS`.
- `package.json` version bumped 0.5.128 -> 0.5.129.

**Verification:** the commit states "full suite green, 0 regressions" — no test count, benchmark, or live check is claimed.

# v0.5.128 (2026-08-09) — poolside provider (Phase 3c, upstream 31df0635)

Adds Poolside Laguna as a free-tier provider. Upstream ships Poolside as an entry in a provider registry this fork does not have, so it was wired by hand into kRouter's two-alias-map catalog instead. Poolside's own model ids are namespaced (`poolside/<model>`), which means the routable name carries a second slash — `ps/poolside/<model>` — and `parseModel` splitting on the first slash only is what makes that work.

**What landed:**
- `open-sse/config/providers.js` — `PROVIDERS.poolside` transport entry: `baseUrl` `https://inference.poolside.ai/v1/chat/completions`, `format: "openai"`.
- `src/shared/constants/providers.js` — `poolside` added to `FREE_TIER_PROVIDERS` with `alias: "ps"`, `passthroughModels: true`, a live `modelsFetcher` against `https://inference.poolside.ai/v1/models` (`type: "openai"`, `authType: "apikey"`, bearer auth header), `serviceKinds: ["llm"]`, and a notice pointing at `https://platform.poolside.ai/api-keys`.
- `open-sse/services/model.js` — `ALIAS_TO_PROVIDER_ID` gains both `ps -> poolside` and `poolside -> poolside`, so either prefix resolves.
- `tests/unit/poolside-provider.test.js` — new file covering alias resolution for both prefixes, `parseModel("ps/poolside/laguna-s-2.1")` yielding provider `poolside` / model `poolside/laguna-s-2.1`, and agreement between the transport entry, `FREE_TIER_PROVIDERS`, `AI_PROVIDERS`, and the derived `ALIAS_TO_ID`.
- `package.json` bumped 0.5.127 -> 0.5.128.

**Verification:** the commit states +3 unit tests (both prefixes route; slash-in-model-id preserved; alias maps agree) and a green full suite. A live 200 was not obtained — it requires a user-supplied Poolside API key added as a connection.

# v0.5.127 (2026-08-09) — TokenRouter provider (upstream b4808929)

TokenRouter is an OpenAI-compatible gateway to 300+ models. Upstream ships it as an entry in a provider registry this fork does not have, so it was wired by hand into our two-alias-map catalog instead — transport, UI catalog entry, and both routing prefixes.

**What landed:**
- `open-sse/config/providers.js` — `tokenrouter` transport entry: `baseUrl` `https://api.tokenrouter.com/v1/chat/completions`, `format: "openai"`. No static model catalog; model ids are passthrough and fetched live.
- `src/shared/constants/providers.js` — `APIKEY_PROVIDERS.tokenrouter` entry (alias `tr`, name "TokenRouter", `icon: "hub"`, `textIcon: "TR"`, color `#6366F1`, `serviceKinds: ["llm"]`, notice text plus `apiKeyUrl` `https://www.tokenrouter.com`), so it shows up in the api-key connect list.
- `open-sse/services/model.js` — two `ALIAS_TO_PROVIDER_ID` rows, `tr -> tokenrouter` and `tokenrouter -> tokenrouter`, so both prefixes resolve to the same provider id.
- `tests/unit/tokenrouter-provider.test.js` — 4 new tests: both prefixes resolve through `resolveProviderAlias` and `parseModel` (`tr/gpt-5` -> provider `tokenrouter`, model `gpt-5`), the transport `baseUrl`/`format` are present, `APIKEY_PROVIDERS`/`AI_PROVIDERS` carry the entry, and `PROVIDER_ID_TO_ALIAS.tokenrouter` + `ALIAS_TO_ID.tr` agree — guarding the "the maps must agree" rule that otherwise makes a provider silently 401/404.
- Deferred: upstream 41588bea's TokenRouter pricing/thinking — display-only pricing data plus a `reasoning_effort` enum that depends on `translator/concerns/thinkingUnified`, which this fork does not carry.
- `package.json` version bumped 0.5.126 -> 0.5.127.

**Verification:** +4 unit tests; full suite **1348 pass**, 0 regressions. Live on :20128, `tr/gpt-5` routed to `tokenrouter/gpt-5` and the picker recognized the provider, returning the clean "No active credentials for provider: tokenrouter" (503) — i.e. wired end-to-end and only awaiting a user API key for the final chat 200.

# v0.5.126 (2026-08-09) — capacity adapter dashboard UI (upstream 8e59093d)

Phase 3a of the capacity adapter. The v0.5.125 backend already reroutes a request to a fallback model when the target model or combo can't handle the requested input modality, but the pools it reads out of `settings.capacityAdapter` had no editor. This adds a "Vision Adapter" section to the Combos page so those pools can be configured from the dashboard, completing the feature.

**What landed:**
- `src/app/(dashboard)/dashboard/combos/page.js`: new `CapacityAdapterSection` + `CapacityAdapterCap` components rendered under the combos list. `CAPACITY_ADAPTER_CAPS` exposes two caps — `vision` (images) and `audioInput` (audio input); `pdf` and `videoInput` stay in the state shape but are hidden from the UI, since no translator supports those blocks yet.
- Each cap card carries a master enable `Toggle`, a round-robin `Toggle` (disabled while the cap is off), model chips with up/down reorder and remove buttons, and an "Add Model" button. Chips render the first three models with a `+N more` counter.
- State round-trips through settings: `fetchData` reads `settingsData.capacityAdapter` and normalizes it; `handleSetCapacityAdapter` sets local state then `PATCH /api/settings` with `{ capacityAdapter: next }`.
- `normalizeCapEntry` accepts the legacy stored shape (an array of `{model, enabled}`) and converts it to the current `{ enabled, roundRobin, models }` object, defaulting `enabled` to true when the field is absent.
- `handleRemove` auto-refills with `DEFAULT_FALLBACK_MODEL` when the last model is deleted, so an enabled pool is never empty. The default was adapted to this fork's free vision-capable `mmf/mimo-auto` rather than upstream's choice.
- `src/shared/components/ModelSelectModal.js`: new `capFilter` prop (added to propTypes). When set, the model list keeps only `provider/model` values where `getCapabilitiesForModel(providerId, modelId)?.[capFilter] === true`, and `filteredCombos` returns `[]` — a capacity pool needs a concrete model, not a combo. The Add-Model picker passes `capFilter={cap.key}` and `closeOnSelect={false}` so several models can be added in one pass.
- Dropped upstream's cosmetic `CapacityBadges` on the chips: this fork has no client-side `useModelCaps` hook.
- `package.json`: version bump to 0.5.126.

**Verification:** full suite 1348 pass, 0 regressions. Browser-verified live on :20128 — the Vision Adapter section renders (Vision enabled / Audio opt-in per our default), 4 switches + Add-Model buttons wired, and toggling a pool fires PATCH /api/settings -> 200 OK.

# v0.5.125 (2026-08-08) — capacity adapter: per-modality fallback pools (upstream 8e59093d + 6498b312 + e41d8503)

Phase 3a of the upstream sync. When a request carries a modality the target model can't handle — an image sent to a text-only model, say — the media used to be silently dropped. Now a capable model from a global per-modality pool is floated in as the priority candidate and the original model follows as fallback.

**What landed:**
- `open-sse/services/capacityAdapter.js` (new, 180 lines) — `getCapacityAdapterConfig` / `getCapacityAdapterModels` / `getCapacityAdapterStrategy` / `getActiveAdapterStrategy` over the four hard caps (`vision`, `pdf`, `audioInput`, `videoInput`). `normalizeCapEntry` accepts both the `{enabled, roundRobin, models}` object form and the legacy `[{model, enabled}]` array form; an enabled pool with no models resolves to `DEFAULT_FALLBACK_MODEL = "mmf/mimo-auto"` so the toggle is never a no-op (upstream shipped `oc/mimo-v2.5-free`, which this fork doesn't run).
- `augmentModelsWithCapacityAdapter` prepends pool models **only** when no original model satisfies the required hard caps — if a combo member already covers the capability the list is returned untouched, leaving `reorderByCapabilities` to handle it.
- `stripHistoryForContext` + `withCapacityAdapterStripping` — when a call lands on an adapter model, history is trimmed to 80% of that model's `contextWindow` (4 chars/token estimate, no tokenizer dependency) by dropping the **middle**: system/developer messages and the trailing user turn carrying the media are always kept, `HEAD_KEEP = 6` leading turns are kept verbatim and popped from the end only if head plus tail still overflow. Handles `messages`, `input`, and `contents` array shapes.
- `combo.js` `detectRequiredCapabilities` — new `addByMime` maps `image/*` → vision, `application/pdf` → pdf, `audio/*` → audioInput, `video/*` → videoInput. Adds `input_audio`/`audio_url`/`audio` and `input_video`/`video_url`/`video` block types, and for generic `file`/`document`/`input_file` blocks infers the mime from `input_audio.format`, a `file.file_data` data-URI, `source.media_type`, or a `source.data` data-URI, falling back to `pdf` only when none is present.
- `src/sse/handlers/chat.js` — computes `requiredCapabilities` once per request, augments both combo member lists and single-model targets, and wraps `handleSingleModel` in `withCapacityAdapterStripping`. A solo request that gains an adapter model is routed through `handleComboChat` with the strategy from `getActiveAdapterStrategy`.
- `capabilities.js` — the `*mimo*v2.5*` pattern now declares `audioInput: true, videoInput: true`.
- `settingsRepo` `DEFAULT_SETTINGS.capacityAdapter` — `vision` enabled by default, `pdf`/`audioInput`/`videoInput` off (opt-in). This deviates from upstream's audio-on default because the free fallback here, `mmf/mimo-auto`, is vision-only — an enabled pool should always have a model that can actually satisfy it.
- `tasks/upstream-sync-plan.md` (new, commit `9c0e8129`) — the phase 0-3 sync plan against decolua/9router v0.5.45-v0.5.50: MITM token-leak fix first, 13 batched correctness fixes, 6 auth/identity items each needing live proof, then the phase 3 feature list, plus a SKIP list with a stated reason per commit.

**Verification:** +15 unit tests (capacity-adapter); full suite **1348 pass**, 0 regressions. Live on `:20128`: an image sent to text-only `ag/gpt-oss-120b` engaged the adapter — `Capacity adapter for [vision] on "ag/gpt-oss-120b" → trying mmf/mimo-auto, ag/gpt-oss-120b` — and routed `mmf/mimo-auto` first (COMBO 1/2). Normal and already-capable requests are untouched (unit-proven no-ops). Dashboard UI for configuring the pools is not in this release.

# v0.5.124 (2026-08-08) — Antigravity provisioning fingerprint + rotating refresh_token

Phase 2b of the upstream sync, both items adapted to this fork. Antigravity was sending SDK-identifying headers on the Cloud Code provisioning calls, which made Google silently refuse to create a `cloudaicompanionProject` — so a fresh Antigravity account never got a project id and every chat failed. Separately, providers that rotate their refresh token on each refresh (xAI/grok-cli) were getting `invalid_grant` on retry because the second and third attempts replayed the already-consumed token.

**What landed:**
- `ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS` in `open-sse/config/appConstants.js` — only `Content-Type: application/json` plus a real Antigravity IDE User-Agent (`antigravity/1.107.0 <platform>/<arch>`). It drops `X-Goog-Api-Client` and `Client-Metadata`, which identify the google-api-nodejs-client SDK rather than the IDE (upstream 35f86e58).
- `loadCodeAssistHeadersFor(provider)` in `open-sse/services/projectId.js` selects the slim header set only when `provider === "antigravity"`; gemini-cli keeps the original `LOAD_CODE_ASSIST_HEADERS`. `projectId.js` is shared by both, so the swap is gated rather than unconditional.
- `provider` is threaded through the provisioning chain: `getProjectIdForConnection(connectionId, accessToken, provider = null)` → `fetchProjectId(accessToken, signal, provider)` → `onboardUser(accessToken, tierID, externalSignal, provider)`, with both call sites updated — `handleSingleModelChat` in `src/sse/handlers/chat.js` and `_refreshProjectId` in `src/sse/services/tokenRefresh.js`.
- New exported `rotateWorkingCreds(workingCreds, result)` in `open-sse/handlers/chatCore.js` — a pure helper that folds a rotated `refreshToken` (and any new `accessToken`) into a fresh copy of the credentials, and returns the same object untouched when the token did not rotate.
- `handleChatCore`'s refresh path now calls `refreshWithRetry(..., 3, log)` with a closure over a local `workingCreds`, reassigned via `rotateWorkingCreds` after each `executor.refreshCredentials` call, so attempt N+1 sends the live refresh token. This replaces upstream's in-place mutation (aa0448f7) and preserves the fork's credential-immutability rule — the caller's shared credentials object is never mutated.

**Verification:** +6 unit tests in `tests/unit/upstream-sync-0.5.124.test.js` — the Antigravity headers drop the SDK fingerprint and keep the IDE UA while the gemini-cli headers keep it; `rotateWorkingCreds` folds a rotated RT into a new object leaving the caller pristine, returns the same object when unchanged, and across 3 retries each attempt sends the latest RT and never a consumed one. Full suite 1333 pass. The commit states final live confirmation is user-side and not yet done — it needs a fresh Antigravity account and a forced xAI refresh retry.

# v0.5.123 (2026-08-08) — remove the cross-account Claude header leak (fc2611cb; upstream 13ed1456 + 6acc3bb9)

A module-level singleton, `claudeHeaderCache`, captured the last-seen Claude Code client's identity headers — `user-agent`, `anthropic-beta`, the full `x-stainless-*` set, and `x-claude-code-session-id` — and overlaid them onto every subsequent request through the claude `buildHeaders` path. On a shared server that meant one account's client identity, session id included, rode along on another account's request to api.anthropic.com. The cache is gone; the executor falls back to the static per-provider CLI fingerprint, and `anthropic-beta` is now computed per model instead of replayed from whoever called last.

**What landed:**
- Deleted `open-sse/utils/claudeHeaderCache.js` along with the `cacheClaudeHeaders(clientRawRequest.headers)` call in `src/sse/handlers/chat.js` and the ~30-line overlay/merge block in the `claude` case of `DefaultExecutor.buildHeaders` (`open-sse/executors/default.js`).
- The claude executor now uses the static `CLAUDE_CLI_SPOOF_HEADERS` fingerprint from `open-sse/config/providers.js` (user-agent, `X-App`, full stainless set), so the spoofed client identity is unchanged — only the per-client carry-over is gone.
- New `selectAnthropicBeta(model)` in `open-sse/config/providers.js`: `ANTHROPIC_BETA_BASE` (nine flags, including `claude-code-20250219`, `oauth-2025-04-20`, `interleaved-thinking-2025-05-14`) ships for every Claude model; `ANTHROPIC_BETA_HEAVY_AGENT` (`advanced-tool-use-2025-11-20`, `effort-2025-11-24`) is gated behind `/claude-(opus|sonnet)/i`, so haiku and fable no longer receive them. `CLAUDE_CLI_SPOOF_HEADERS` seeds its static `Anthropic-Beta` from `selectAnthropicBeta("claude-opus")`.
- Threaded `model` through the header path: `base.js` now calls `this.buildHeaders(effectiveCredentials, stream, url, model)` and `DefaultExecutor.buildHeaders` takes `(credentials, stream = true, url = null, model = null)`. Only DefaultExecutor reads the extra args — antigravity has its own `execute()`, and codex/grok call `super` with two args, so there is no positional collision.
- 6acc3bb9: lowercased the `anthropic-version` header key in both `CLAUDE_API_HEADERS` and `CLAUDE_CLI_SPOOF_HEADERS`, so a client-forwarded lowercase copy on `/v1/messages` cannot duplicate against a Title-Case key.

**Verification:** `tests/unit/claude-header-forwarding.test.js` was rewritten against the real `DefaultExecutor` — covering the static fingerprint, per-model beta (opus gets the heavy flags, haiku does not), and the absence of shared state across calls so two clients cannot cross-contaminate — plus 4 new tests in `tests/unit/upstream-sync-0.5.123.test.js`, which extend the per-model beta assertions to sonnet and fable. Full suite **1327 pass**, 0 regressions. Live on `:20128`: `cc/claude-sonnet` and `cc/claude-haiku` issued from two different User-Agents both routed to the claude provider and reached api.anthropic.com with the new header/beta shape accepted — a 401 stale-account-token, not a 400 header rejection; that account needs re-auth before a 200 is reachable.

# v0.5.122 (2026-08-08) — phase 2a auth fixes: Windows OAuth, codex model list, GitHub monthly cap

Three upstream auth/identity fixes ported as the safe subset of the batch — the commit states the HIGH-risk header-leak fix lands separately. The Windows one is the serious one: a macOS-built release could not run *any* interactive OAuth login on Windows, because bundling `open` baked the build machine's absolute path into the artifact.

**What landed:**
- `next.config.mjs` — added `"open"` to `serverExternalPackages` (upstream c06cc084). `open` derives its own directory from `import.meta.url`; webpack replaces that with the BUILD machine's absolute path as a string literal, so a macOS-built release ships `file:///Users/.../open/index.js`, which `fileURLToPath` rejects on Windows at module scope and takes down every importer — xAI/Grok/Codex/Gemini/Antigravity/Qwen/iflow OAuth. Keeping it external preserves the real `import.meta.url` at runtime.
- `cli/scripts/build-cli.js` — `ensureModuleInBundle("open")`, the same belt-and-braces guard already used for `sql.js`. Because `open` is now external it must physically exist in the bundle's `node_modules` or every importer throws `MODULE_NOT_FOUND`.
- `src/app/api/providers/[id]/models/route.js` — the codex entry in `PROVIDER_MODELS_CONFIG` moved from `client_version=1.0.0` to `client_version=0.144.6` and now sends an `originator: codex_cli_rs` header (upstream d587b2a4). The `/backend-api/codex/models` endpoint gates each entry by `minimal_client_version`, so the stale value was silently filtering out the newest models. Dashboard-only path.
- `src/sse/services/auth.js` — new exported `githubMonthlyResetMs(status, errorText, provider)` (upstream 3292dfc1): returns `Date.UTC(year, month + 1, 1)` only when the provider resolves to `github`, the status is `402`, and the body contains "you've reached your additional usage limit for your plan"; `null` otherwise.
- `markAccountUnavailable` now checks that first, ahead of the 0.5.119 `resetsAtMs` branch, so the monthly hold wins over the 6h cap. On a match it sets `cooldownMs` to the full time until 00:00 UTC on the 1st of next month, `newBackoffLevel = 0`, `permanent = false`, and takes the `buildModelLockUpdate(null, ...)` branch — `modelLock___all`, the whole account — with no `banCount` escalation, since the cap is a quota and not abuse. Other GitHub 402s keep the model-scoped 2-min cooldown.
- `tests/unit/upstream-sync-0.5.122.test.js` — new file covering `githubMonthlyResetMs`: the 1st-of-month UTC result, a different 402 error text, a 429 with the monthly text, non-github providers (`openai`, `antigravity`), and null/numeric-string input.

**Verification:** the commit states +5 unit tests (githubMonthlyResetMs: 402+monthly to 1st-of-month UTC; other 402 / 429 / non-github to null), full suite 1335 pass, 0 regressions. No live check of the Windows OAuth or codex-models paths is claimed.

# v0.5.121 (2026-08-08) — upstream sync phase 1: safe correctness batch (13 ports)

Phase 1 of the decolua/9router sync — thirteen low-risk correctness ports, no new provider or endpoint surface. The two highest-value ones close hard 400s that killed whole requests: a single unsupported JSON-Schema keyword in a tool definition, and `temperature` on any Claude model over an OpenAI-compatible route.

**What landed:**
- `geminiHelper.js` — added `multipleOf`, `uniqueItems`, `contains`, `unevaluatedProperties`, `unevaluatedItems`, `contentSchema` to `UNSUPPORTED_SCHEMA_CONSTRAINTS`. Gemini's proto schema has no field for these and one occurrence 400s the whole request ("Unknown name ... Cannot find field"). Upstream 2abe8b85.
- `cleanJSONSchemaForAntigravity` — an orphan `{}` left behind after `$ref`/`$defs` are stripped is now promoted to `type:"object"` with a `reason` string property and `required:["reason"]`; Vertex/Antigravity reject the empty node. Upstream e3e3e235.
- `claudeHelper.hasValidContent` — accepts `image` and `document` blocks as valid content. A vision turn whose only block was an image got dropped, leaving `messages[]` empty, and Anthropic 400'd "at least one message is required". Upstream a7941dda.
- `paramSupport.js` — the temperature-drop rule broadened from `/claude-opus-4/i` to `/claude/i`. Anthropic 400s `temperature` for all Claude models on OpenAI-compatible routes; this trades fine temperature control for not hard-400ing. Upstream 9173c29b.
- `openaiToOpenAIResponsesRequest` — forwards `service_tier` (priority/default/flex) instead of dropping it on the OpenAI->Responses conversion. Upstream c97963c4.
- `sseToJsonHandler.handleForcedSSEToJson` — two fixes in the same function, on different paths. On the Responses-API SSE path, `cache_read_input_tokens`/`cached_tokens` and `cache_creation_input_tokens` are folded into `prompt_tokens` for both the DB row and the client response, and `prompt_tokens_details` is emitted when either counter is non-zero (on the OpenAI `chat.completion` shape; the Gemini/Antigravity branch keeps its own `usageMetadata` totals). On the standard Chat Completions SSE path, `parsed.usage` is re-attached explicitly — a cached Claude reply was reaching the client with no usage field at all. Upstream 41606a37.
- `executors/antigravity.js` — `stream_options` added to `ANTIGRAVITY_REQUEST_BLACKLIST`; Google `generateContent` rejects it. Blacklisted outright rather than upstream's `stream !== true` guard. Upstream 0afe9493.
- `clientDetector.detectClientTool` — recognizes `codex-tui`, `codex_cli_rs`, `Codex Desktop`, and an `originator` header starting with `codex_` as native Codex. The current Codex clients were falling through to `null` and losing lossless passthrough. Upstream cd13d904.
- `/api/translator/console-logs/stream` — `Cache-Control: no-cache, no-transform` plus `X-Accel-Buffering: no` so nginx/Cloudflare stop buffering the log SSE. Upstream 57b3b2c1.
- `betterSqliteAdapter` — `run`/`get`/`all` now spread bind params (`prepare(sql).run(...params)`) to match the node and bun adapters and guard array-binding drift under better-sqlite3 `^12.6.2`. Upstream 4f48ab8c.
- `/api/auth/status` returns `authenticated`, and `src/app/login/page.js` redirects to `/dashboard` on `authenticated === true` as well as `requireLogin === false`. Upstream ae4f76c4.
- `/v1/embeddings` usage persistence — `handleEmbeddingsCore` surfaces `normalized.usage`, and `src/sse/handlers/embeddings.js` gains `exactEmbeddingUsage()` which only records provider-reported usage that is exact (positive integer prompt tokens, zero completion, `total_tokens === prompt_tokens`, not `estimated`) before calling `saveRequestUsage`. We previously recorded no tokens for embeddings. Upstream c85a5c57.
- `EndpointPageClient` — when `/api/keys` returns an empty list, POSTs a `"Default Key"` and reloads, so `/v1` works out of the box for first-time users without a manual dashboard step. Upstream 02c66fe2.

**Verification:** +14 unit tests in `tests/unit/upstream-sync-0.5.121.test.js`, full suite 1330 pass, 0 regressions. Live on :20128: `ag/claude-sonnet-4-6` with `temperature:0.9` AND a tool schema using `uniqueItems`+`multipleOf` returned HTTP 200 with a correct tool call — both the Claude temperature strip and the Gemini schema-keyword strip exercised end-to-end.

# v0.5.120 (2026-08-08) — MITM stops writing live auth tokens to disk

`src/mitm/server.js` shipped `const ENABLE_FILE_LOG = true` — a hardcoded constant with no runtime off switch, marked "temporarily … for Antigravity auth debugging" and present since the first MITM commit. It made the MITM proxy an always-on recorder that wrote full request headers verbatim to `~/.krouter/logs/mitm`, including `Authorization` Bearer tokens, API keys, and AWS SigV4 credentials. The directory grew unbounded because the only cleanup runs at startup while Antigravity polls every few seconds — the commit records 91 MB across 4,282 files, with a same-day dump holding a live Google/Antigravity token.

**What landed:**
- `src/mitm/server.js`: `ENABLE_FILE_LOG` is now `process.env.MITM_FILE_LOG === "1" || process.env.DEBUG_MITM === "1"` — off by default, opt-in per run. `clearDumpDir()` on start is unchanged.
- `src/mitm/logger.js`: new `redactHeaders()` replaces the value of any header matching `SENSITIVE_HEADER_RE` — `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `api-key`, `x-goog-api-key`, `x-aws-*`, `x-amz-*`, `x-amzn-*`, `x-stainless-api-key`, `openai-api-key`, `anthropic-api-key` — with `[REDACTED]`. Applied in `dumpRequest` and in the response dumper returned by `createResponseDumper`, so dumps keep request/response shape and body but never archive auth material, even when logging is explicitly enabled.
- `src/mitm/logger.js`: new `maybePruneDumpDir()` size-caps the dump dir at `MITM_MAX_DUMP_FILES` (default 1000), sorting by mtime and deleting everything past the cap. Amortized — it only `readdir`s every 100th write. Called after each request and response dump.
- `tasks/lessons.md` deduped from 564 lines to 26 (commit `736ba913`): the capture-correction Stop hook re-appended the same handful of raw prompts every session, leaving ~95% duplicates. Collapsed to the 6 unique entries, each kept under its earliest date — pure dedupe, no entry text changed.

**Verification:** the commit states that a default build writes ZERO dump files while Antigravity runs (chat and alias rewrite unaffected), and that with `DEBUG_MITM=1` dumps reappear but `grep '"authorization"'` returns nothing — the value shows `[REDACTED]` while the body is preserved for debugging. Unit-proven per the commit: `dumpRequest` with `Authorization` / `x-api-key` / `x-amz-security-token` writes no secret into the file, 3 `[REDACTED]`, body and non-sensitive headers intact. Full suite **1316 pass**. The diff itself adds no test file.

# v0.5.119 (2026-07-23) — antigravity rotation robustness + retired opencode model error

Multi-account Antigravity was stuck in a loop: a daily-exhausted account kept getting re-selected every 30 minutes while fresh accounts sat idle, and when every account was locked the router returned a bare 503 "No active credentials" with no retry hint. Five fixes so rotation actually drains all accounts and fails informatively. Also intercepts OpenCode's retired free-tier model ids instead of forwarding them upstream.

**What landed:**
- `MAX_QUOTA_RESET_COOLDOWN_MS` (6h) in `open-sse/config/errorConfig.js` — when a 429 carries a precise `resetsAtMs` (e.g. Antigravity "Resets in 104h"), `markAccountUnavailable` now parks the per-model lock against the real reset bounded at 6h instead of the old 30-min `MAX_RATE_LIMIT_COOLDOWN_MS` cap. Per-model only; the TPM (per-minute) downgrade to ~90s still overrides it for minute-window 429s.
- `isConnectionSelectable` extracted in `src/shared/services/healthCache.js` and used by `getCachedConnections` — it gates on the existing `isPermanentlyBanned` flag as well as the model lock, so a banned Google account ("Verify your account", suspended, deactivated) is no longer silently re-admitted when its 24h `modelLock___all` expires. `bypassModelLock` (Test connection) still probes banned accounts; `clearAccountError` clears the flag on a successful request.
- New `open-sse/config/providerStrategy.js` with `PROVIDER_DEFAULT_STRATEGY` (`antigravity: "round-robin"`) and `getEffectiveFallbackStrategy(settings, providerId)`. Precedence: explicit per-provider dashboard override > per-provider default > global `fallbackStrategy` > `fill-first`. Wired into the picker in `src/sse/services/auth.js` and into the conversation-stickiness bypass in `src/sse/handlers/chat.js`, so fill-first no longer pins one account until it trips Antigravity's per-minute limit and cascades the whole pool into locks.
- `deriveUnavailableResult(allConns, provider, model)` (pure) plus its I/O wrapper `buildUnavailableResult` in `src/sse/services/auth.js`. The old in-place filter ran after `getCachedConnections` had already dropped locked accounts, so it always saw an empty set and could never compute a retry time. The failure path now re-fetches the full active list and returns `allRateLimited` with `retryAfter`/`retryAfterHuman`, or — when nothing is model-locked but a permanently-banned account is present — a re-verify hint carrying `lastErrorCode: 403`, instead of a bare `null`.
- New `open-sse/config/retiredModels.js` with `RETIRED_MODELS` and `getRetiredModelError(model)`; `handleSingleModelChat` in `src/sse/handlers/chat.js` returns a 400 that names the live replacement where one exists and otherwise points at the paid `opencode-go` (API key) tier. Covers `qwen3.6-plus-free` and `minimax-m2.5-free` (which map to `qwen3.6-plus` and `minimax-m2.5`) plus `nemotron-3-super-free`, `trinity-large-preview-free`, and `big-pickle` (no direct replacement) — previously forwarded upstream and echoed OpenCode's opaque `ModelError: Model <x> is not supported`. Matching strips a provider prefix, so `oc/qwen3.6-plus-free` resolves too.

**Verification:** the commit states full suite **1316 passed, 0 regressions**, with **+20 unit tests** in `tests/unit/rotation-fixes-0.5.119.test.js` covering the reset cap, the ban gate, strategy precedence, the unavailable derivation, and the retired-model error. Live on `:20128`: `ag/claude-sonnet-4-6` returned 200 with traffic spread across 2 accounts (round-robin working end-to-end including the stickiness bypass), the banned account was excluded from the pool (10/11 selectable), and a retired model returned a clear 400. Honest split per the commit: exhausted-account parking and the all-unavailable derivation are unit-proven only — a real multi-day 429 could not be forced live.

# v0.5.118 (2026-07-18) — Kiro API-key (ksk_) headless auth (the last half of 706e6513)

Completes the Kiro headless commit. Kiro can now authenticate with a long-lived API key (`ksk_…`) instead of an OAuth/social login — no refresh token, no browser flow.

**What landed:**
- `KiroService.validateApiKey` + `listAvailableProfiles` — validate a key by calling CodeWhisperer `ListAvailableProfiles` (the only way to check a keyless bearer credential) and resolve its account-specific `profileArn`. Accepts both `arn` and `profileArn` response fields (the API-key JSON-1.0 surface returns `arn`).
- `POST /api/oauth/kiro/api-key` — validates + imports the key, stores it as a `kiro` connection with `authMethod:"api_key"`, `refreshToken:null`, and a 1-year expiry so the proactive-refresh path (which needs a refresh token) is skipped.
- Executor: sends `Authorization: Bearer <key>` **plus** `tokentype: API_KEY` for api-key connections, and reorders base URLs to try the `*.amazonaws.com` CodeWhisperer hosts FIRST (the `runtime.*.kiro.dev` gateway rejects an `API_KEY` token with 401/403, which BaseExecutor returns immediately). OAuth keeps the default order.
- profileArn guard: for api-key connections, never fall back to the shared builder-id/social *default* placeholder ARN (it 403s — it isn't owned by the key's account); send only the ARN resolved at import.
- UI: an "API Key" method in the Kiro connect modal (paste `ksk_…` + region → validate → import).

**Verification — honest split:**
- **Verified live (regression / inertness):** on a real Kiro **OAuth** account, all four paths still work with these changes in place — streaming and non-streaming, Claude and OpenAI clients (each returned "Mango."). The api-key branches are gated on `authMethod === "api_key"`, so for every existing connection they are provably inert: `buildHeaders` falls to the OAuth branch, `getOrderedBaseUrls` returns the default order, and the profileArn guard doesn't change anything. Grok-CLI (which shares Kiro's account) also still chats.
- **NOT live-verified:** the api-key path itself — there is no `ksk_` key available on this instance to exercise `validateApiKey` / the `API_KEY` request end-to-end. It is a faithful port of upstream's verified feature and is covered by unit tests (tokentype header, AWS-first host ordering, profileArn field parsing, OAuth-unchanged), but a real `ksk_` request was not sent. When a key is available, the flow is: dashboard → Kiro → "API Key" → paste → Import.

**Verification:** full suite **1296 pass** (+8: 5 executor + 3 profile-arn), production build clean, `/api/oauth/kiro/api-key` route registered, and the whole recent-session surface re-checked live (all API endpoints 200, video listing, headroom, providers) — nothing regressed.
# v0.5.117 (2026-07-18) — Kiro direct claude↔kiro route (the half of 706e6513 that was deferred)

Completes the direct-route half of the Kiro headless commit I deferred in v0.5.116. Claude clients on Kiro now translate **straight** to/from Kiro's CodeWhisperer format instead of pivoting through OpenAI (`claude→openai→kiro` and back), which is lossy for tool-use and thinking blocks.

**Why it was safe to do now (the deferral concern, resolved):** I deferred this overnight worried the response-side direct dispatch would collide with the common `openai:claude` path. Re-reading the full `translateResponse`, the short-circuit is **provably equivalent** for every existing pair: whenever either side is OpenAI the two-step pivot already collapses to exactly one translator call on the same chunk — the same call the direct route makes. Only a genuinely-new two-hop registration (`kiro:claude`) changes behavior. The full suite (1288) confirms no regression across all translators.

**What landed:**
- `translator/request/claude-to-kiro.js` + `translator/response/kiro-to-claude.js` — the direct translators (with the two 400-guards that fold orphaned/toolless `tool_result` blocks back to text so Kiro's schema validator doesn't reject follow-up turns).
- `translator/schema/index.js` — the three constants (`ROLE`, `CLAUDE_BLOCK`, `DEFAULT_IMAGE_MIME`) the translators need, rather than porting upstream's whole schema subsystem.
- `translator/index.js` — additive direct-route dispatch on both request and response sides, registered the two translators.
- **Non-streaming fix**: `translateNonStreamingResponse` now converts a buffered Kiro (OpenAI-shaped) body to a Claude message for Claude clients. This was a **pre-existing gap** the direct-route work surfaced — a non-streaming Claude client on Kiro was getting the raw `{choices:[]}` OpenAI body it can't parse. The streaming path is handled by the new `kiro:claude` route; non-streaming buffers to JSON separately, so it needed its own case.

**Verified live against a real Kiro OAuth account — all four paths:**
- Streaming Claude client → Kiro: proper Claude SSE (`message_start` → `content_block_delta` "mango"), 0 OpenAI leaks.
- Non-streaming Claude client → Kiro: proper Claude message, `stop_reason: end_turn`, reply "mango" (was an empty OpenAI body before the fix).
- Streaming OpenAI client → Kiro (Cline/Cursor path): unchanged — clean OpenAI chunks, 0 Claude leaks.
- Non-streaming OpenAI client → Kiro: unchanged — clean OpenAI completion.

**Still deferred:** the Kiro **API-key (`ksk_`) auth** half of 706e6513 — there's no Kiro API key on this instance to verify the `ListAvailableProfiles` validation, and shipping unverified auth is the anti-pattern that bit PXPIPE. That half is a clean task for whenever a `ksk_` key is available.

**Verification:** full suite **1288 pass** (+10: 8 upstream direct-route tests + 2 non-streaming), production build clean, and all four Claude/OpenAI × streaming/non-streaming paths verified live on a real Kiro account.
# v0.5.116 (2026-07-18) — Fix a backwards arg order in v0.5.114; defer the Kiro headless port

Two things: a real bug fix in the v0.5.114 GitHub Copilot port, and an honest deferral of the Kiro headless port after its risk surfaced during the work.

## Bug fix: GitHub Copilot /v1/messages response translation was backwards

v0.5.114 routed Claude models through Copilot's `/v1/messages` shim and translated the Claude SSE back to OpenAI for the client with `translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, …)`. That is backwards.

Verified against the production streaming path (`chatCore` sets `sourceFormat = detectFormat(body)` = the **client** format, `targetFormat = getTargetFormat(provider)` = the **provider** format, and calls `translateResponse(targetFormat, sourceFormat, …)`): `translateResponse` is `(targetFormat = PROVIDER, sourceFormat = CLIENT)`. The shim returns CLAUDE (provider) to an OPENAI client, so the call must be `translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, …)`.

With the backwards args, step 1 (`target → openai`) was skipped because target was OPENAI, and step 2 then applied `openai → claude` to an already-Claude chunk — so a Copilot+Claude response would have reached the client un-converted (double-wrong). v0.5.114 shipped it because there was no GitHub Copilot connection to live-verify against, so the mistake rode in on static-only verification. Both call sites are fixed and the test now pins the correct order.

## Deferred: Kiro headless API-key auth + direct claude↔kiro route (upstream 706e6513)

This 1437-line, 20-file commit bundles two features, and both hit a wall that makes an unattended overnight port irresponsible:

- **API-key (`ksk_`) auth** — validates a key via CodeWhisperer `ListAvailableProfiles`. There is no Kiro API key on this instance, so the positive path is unverifiable. Shipping unverified auth code is exactly the anti-pattern that bit PXPIPE.
- **Direct claude↔kiro translation route** — the request side is safely additive, but the *response*-side dispatch key (`${targetFormat}:${sourceFormat}`) can collide with the common `openai:claude` response translator, i.e. it changes behavior for **every** OpenAI-format provider with a Claude client, not just Kiro. It also needs a `translator/schema/` module this fork lacks and reroutes existing Kiro+Claude traffic. Whether the short-circuit is truly equivalent to the two-step pivot needs careful, attended verification across providers — not a rushed overnight change.

After finding one backwards-arg bug tonight from exactly this kind of subtle translator reasoning, forcing a second, broader-blast-radius change into the same release would be reckless. The Kiro headless port is a clean, self-contained task for an attended session (with a `ksk_` key for the auth half). The exploratory changes were reverted; the tree is clean.

**Verification:** full suite **1278 pass** (stable across two runs), production build clean.
# v0.5.115 (2026-07-18) — Headroom token saver (completed the half-ported feature)

Our fork already shipped the Headroom **UI** (a card in the Token Saver page calling `/api/headroom/*`), but the entire **backend was missing** — those routes 404'd and the compression never ran. This release adds the backend and wires it into the request pipeline, completing the feature end to end.

Headroom is an external Python proxy (`pip install headroom-ai[proxy]`, or with the `[ml]`/`[code]` compression extras) that de-duplicates and compresses conversation context — repeated file contents, large tool outputs, long histories — before the request reaches the provider. It joins RTK / Caveman / Ponytail / PXPIPE as a fail-open token saver.

**What was added (ported from upstream b55cf36d + f1f9d270 + 74d5fedf):**
- `src/lib/headroom/{detect,process}.js` — binary/interpreter detection and proxy lifecycle (start/stop/restart, extras install/uninstall).
- `open-sse/rtk/headroom.js` — `compressWithHeadroom`, which POSTs the conversation to the proxy's `/v1/compress` and swaps in the compressed messages. Fails open (returns the request untouched) on any error, timeout, or missing proxy.
- 6 API routes (`status`, `start`, `stop`, `restart`, `extras`, and a dashboard `proxy/[...path]` passthrough) — the endpoints the existing UI was already calling.
- `chatCore` runs headroom in the token-saver block (mutates the body in place, logs before/after tokens); `chat.js` threads the settings to both dispatch paths; settings default it off.

**Verified end-to-end on a live proxy — the proof is in the token counts:**
- Installed `headroom-ai[proxy][ml]` (v0.32.0, Python 3.13), started the proxy, confirmed our `detect` finds the binary.
- Fail-open confirmed: headroom enabled + proxy down → the request still succeeds untouched.
- A real code-heavy request through krouter with headroom enabled logged:
  `[HEADROOM] reported token delta=25131 before=27187 after=2056 (92.4%)`
  — 27,187 → 2,056 tokens, **92.4% saved**, and the provider accepted the compressed body (correct reply). The direct `/v1/compress` probe showed the same: 99,776 chars → 7,263 (92.7%).
- The compression magnitude depends on content and the installed extras (repeated-code context compresses ~92%; plain prose barely moves) — the base `[proxy]` extra alone reports 0% and the `[ml]`/`[code]` extras do the real work, which is exactly what the extras install/uninstall manages.

**Note on this machine:** the local Python is pipx-isolated, so `getHeadroomStatus` reports `version:null`/`canStart:false` even though the binary runs — a probe quirk of this specific setup, not the port; a standard `pip install headroom-ai` puts the console script on PATH normally.

**Verification:** full suite **1278 pass** (+11), production build clean, all 6 headroom routes registered, and a real 92.4% compression proven through the full request pipeline.
# v0.5.114 (2026-07-18) — GitHub Copilot: route Claude through the native /v1/messages shim

Port of upstream 542a088c. Claude models on GitHub Copilot now go to Copilot's Anthropic-native `/v1/messages` endpoint instead of `/chat/completions` — the only Copilot endpoint that surfaces prompt-cache token counts for Claude, and the path that lets `cache_control` actually get injected.

**How it works:**
- `execute()` detects Claude models by name (`/claude/i`) — not a static registry field, because Copilot's live catalog regularly exposes `claude-*` variants ahead of our static list — and routes them to the new `executeWithMessagesEndpoint`.
- Claude requests arrive OpenAI-shaped (chatCore targets `openai` for github), so the method translates OpenAI→Claude for the shim, forces `stream:true` upstream (chatCore buffers to JSON when the client asked for non-streaming), strips the internal `_toolNameMap` before dispatch (Anthropic 400s on the extra field), and translates the Claude SSE back to OpenAI for the client.
- `buildHeaders` now sends `anthropic-version` (a no-op on the other endpoints, required by `/v1/messages`), and the backend config gains `messagesUrl`.
- gpt / gemini / grok models are unchanged — they stay on `/chat/completions` (or `/responses`).

**Fork adaptation:** upstream's `translateResponse(source, target)` is the reverse of ours — our signature is `translateResponse(targetFormat, sourceFormat, …)`. Verified against our translator's actual signature and existing call sites (`bypassHandler`, `stream.js`), so the response call reads `(OPENAI, CLAUDE)` here, not upstream's `(CLAUDE, OPENAI)`. Getting this backwards would have silently corrupted every Copilot+Claude response.

**Verification:** full suite **1271 pass** (+4), production build clean (all imports resolve, executor compiles). Routing, headers, config, and the arg-order are covered by tests. **Not live-verified:** there's no GitHub Copilot connection on this instance, so a real `/v1/messages` round-trip couldn't be exercised — the verification here is static (build + logic + translator-signature match), not an end-to-end request.
# v0.5.113 (2026-07-18) — Upstream quick-wins batch

Six small upstream features/fixes we were missing, verified together.

- **SearXNG `SEARXNG_URL` env** (upstream e79f9edd) — the built-in unauthenticated SearXNG provider was pinned to `http://localhost:8888/search`. Self-hosters can now point at their own instance (`SEARXNG_URL=http://searxng:8080/search`). The override lives in `runtimeConfig` + `buildSearxngRequest`, and only kicks in when the env is set, so the manifest default is unchanged.
- **Bulk-delete connections** (upstream 644bff4c) — a "Delete Selected (N)" action on the provider page that removes every checked connection in one confirm. The selection infrastructure already existed here; this adds the handler + button.
- **Kiro GPT-5.6 family** (upstream b94685b8) — `gpt-5.6-sol/terra/luna` added to the Kiro fallback catalog (272k context). A Kiro account with access serves them via the live catalog; the `*gpt-5.6*` capability pattern already routes them.
- **Strip `client_metadata` on responses→openai** (upstream e567ba80) — the Responses-API `client_metadata` field is now dropped when converting to plain Chat Completions, which rejects it.
- **Gate the auto-ping scheduler at startup** (upstream 27b37705) — the quota auto-ping interval no longer spins up on a fresh install where no connection opted in; it starts only when `claudeAutoPing`/`codexAutoPing` has an enabled connection.

**Deferred:** the Kiro direct-session-cache change (upstream 9c58ba64) is 400+ lines of Kiro translator internals — a perf optimization, not a correctness fix — and doesn't belong in a quick-wins batch. It gets its own careful pass.

**Verification:** full suite **1267 pass** (+8), production build clean, provider page + `/v1/models` serve with no regression. New regression tests cover all five changes.
# v0.5.112 (2026-07-18) — PXPIPE was inert for real traffic; now it actually compresses

A correction to v0.5.111. PXPIPE shipped wired and fail-open, but **it never compressed a real request** — and the v0.5.111 verification missed it because the checks only exercised fail-open paths and the package's own self-test.

**The gap:** `pxpipe-proxy@0.9.0` images **only `claude-fable-5`** by default. Every real model — `claude-opus-4-8`, `claude-sonnet-4-6`, and every claude-format provider — returns `unsupported_model` and passes through untouched. The package exposes `setAllowedModelBases()` to widen the allowlist, but nothing called it: not the upstream commit, not our port. A user could enable PXPIPE, send their normal Claude Code request, and get exactly zero compression with no error — the dashboard's own "Model not in allowlist" status was the only hint.

**The fix:**
- New `configureModelBases()` in the pxpipe loader pushes the operator's allowlist into the package (via `applicability.js`, which `library.js` imports internally — same module instance, so the transform actually reads it).
- New `pxpipeModels` setting, defaulting to vision-capable Claude bases (`claude-fable-5`, `claude-opus-4`, `claude-sonnet-4`, `claude-haiku-4`). The list is an explicit allowlist, never "all models" — imaging only works for models that can read images.
- `chat.js` configures the allowlist before loading the transform on every enabled request.

**Verified end-to-end on a live Claude connection — the proof is in the billing:**

Sent a real `/v1/messages` request to `cc/claude-opus-4-8` with a 123,634-char system prompt and PXPIPE enabled:

```
[PXPIPE] imaged 124593ch → 5 image(s) | est 31289→6964 tokens (-77.74%) | 402ms
```

- Claude **accepted** the 5-PNG body (no error) and streamed a response.
- Actual provider-billed `input_tokens: 8726` — that raw system prompt would bill ~30k tokens; as PNGs it billed 8,726. The saving is real, confirmed by billing, not just the pre-send estimate.
- Claude **read** the imaged content (it answered about what was in the images), proving vision-decode of the compressed context worked.

Before this fix, the identical request returned `unsupported_model` and compressed nothing.

**Why v0.5.111's verification missed it:** every check I ran was either fail-open (works whether or not compression happens) or used the package's default `claude-fable-5` self-test. I never sent a real model through the full path, so "inert for all real traffic" looked identical to "working." The lesson is now a standing test: the allowlist must be configured, asserted against the real transform with a real model id, not just against the package loading.

Full suite: **1259 pass** (+3), production build clean.
# v0.5.111 (2026-07-18) — Grok Imagine video + PXPIPE, plus two bugs the live tests caught

Two Tier B features land together, each verified against real endpoints on a live account, plus two real bugs surfaced along the way.

## Grok Imagine video (upstream d6761c6f) — verified end-to-end on a real account

A new `/v1/videos` surface (generations / edits / extensions + status polling) proxying xAI's async Grok Imagine jobs.

- `videoCore.js` is a transparent proxy: forwards the body byte-for-byte, passes `request_id` / `status` / `video.url` back verbatim, refreshes once on 401/403 and retries once, never re-sends a creation POST on a network error (the job may already exist). Upstream reads its endpoint from a `PROVIDER_MEDIA` registry this fork doesn't have; ours keeps a small self-contained `VIDEO_CONFIG` instead.
- 4 routes, the sse handler, `grok-imagine-video` (kind `video`), the `video` serviceKind on xai, and the Sidebar entry — all wired.

**Proven live against your xAI account:** submitted a real job → `request_id: f00c3438…` → polled → status `done` → a playable video URL at `https://vidgen.x.ai/…`. The token was expired in storage (8h TTL); our server refreshed it and xAI accepted the job. Full round trip, not a mock.

**Bug found while wiring it:** the `[kind]` media route's slug map had no `video` entry, so `/v1/models/video` returned "Unknown model kind" even though the Sidebar links a video page and xai publishes a video model. Upstream's own port missed this. Fixed — `/v1/models/video` now returns exactly `xai/grok-imagine-video`, and the main `/v1/models` correctly keeps video out of the LLM list.

## PXPIPE (upstream dcf1927f) — context-to-PNG token saver, verified with the real package

Renders bulky Claude-format context as dense PNGs via the `pxpipe-proxy` library (images bill by pixels, not encoded length). It joins RTK / Caveman / Ponytail as a fail-open token saver — runs last in the pipeline, and any error, timeout, or missing install returns the request untouched.

- The `pxpipe-proxy` package is **never bundled**: it installs on demand into the data dir (same lazy pattern as our sqlite/systray runtime deps) and loads via dynamic import. No new hard dependency in `package.json`.
- 8 management routes (status / health / install / start / stop / restart / logs / stats), a dashboard page, settings (off by default, 25k-char threshold), and per-request savings threaded into the request-detail log.

**Verified live end-to-end:**
- Before install: status `installed:false`, health cleanly reports "not installed", and a real Claude request still succeeds (fail-open).
- Installed the real `pxpipe-proxy@0.9.0` into the data dir → health goes green (all three checks: installed ✓, module loads ✓, transform runs ✓).
- Enabled it, sent a real request → still 200 (the package made its own profitability decision and passed the request through — fail-open, exactly as designed). Stats and logs routes functional.

The package's v0.9.0 profitability heuristic is conservative and opaque about which payloads it images; what this release guarantees is that our integration invokes it correctly and never lets it break a request.

## Bug: grok-cli OAuth tokens never refreshed (regression from 0.5.110)

`grok-cli` shipped last release with **no case in `refreshTokenByProvider`**, so it fell to the default `refreshAccessToken`, which needs a `clientId` grok-cli's backend config doesn't carry — refresh always failed, and OAuth connections died after xAI's ~8h token TTL. This was a real 401 hit on a day-old grok-cli connection.

grok-cli tokens **are** xai tokens (same public client `b1a00492…`, same `auth.x.ai/oauth2/token`), so the fix routes grok-cli through the exact same `refreshXaiToken` path as xai. **Verified live:** `refreshTokenByProvider("grok-cli", …)` returned a fresh token (was `null` before), and a grok-cli chat that had been 401-ing came back with `"mango"` (431 in / 349 out). A scan confirmed grok-cli was the only provider on that refresh path with the gap.

## Verification

Full suite **1256 pass** (+49 across the two features and their regressions). Production build clean, all new routes registered. New guards: the `[kind]` route must recognize `video`, chat.js must thread the pxpipe transform to both chatCore calls, and grok-cli refresh must route through the xai path.
# v0.5.110 (2026-07-17) — Tier C complete: Grok CLI (Grok Build) + two routing bugs it exposed

Adds the fourth and largest Tier C provider, and fixes two silent routing bugs that only a real request could surface. Both were found by chatting through a live Grok Build account — the unit tests passed the whole time.

**Grok CLI / Grok Build** (upstream a11937cd + 7dfb3466 + 59b78282)

A third Grok-family provider, distinct from the two we already had:

| provider | endpoint | pays with |
|---|---|---|
| `xai` | api.x.ai | xAI API credits |
| `grok-web` | grok.com | web SSO cookie |
| `grok-cli` (new) | cli-chat-proxy.grok.com | **Grok Build subscription** |

- OAuth is a **device code** flow on auth.x.ai — same public client as `xai`, plus `conversations:read/write` scope and `referrer=grok-build`. No loopback proxy, unlike our xai PKCE flow. Verified live: xAI's discovery advertises `urn:ietf:params:oauth:grant-type:device_code`, and our flow returns a real user code against `accounts.x.ai`.
- Ported upstream's executor with our fork's paths. Upstream's `resolveSessionId()` does not exist here, so `resolveGrokCliSessionId` walks the same precedence by hand. Our `deriveSessionId` emits `uuid + Date.now()` (another provider's binary format); since these headers exist to match the CLI's fingerprint, we hash to a **well-formed UUID** instead — which also stays stable across process restarts, as an in-memory map cannot.
- Published models come from the **live catalog read off a real account**: `grok-4.5` at 500k context with low/medium/high efforts, high default. The `-low`/`-medium`/`-high` entries are virtual — the executor strips the suffix and maps it to `reasoning.effort` — so any client that only speaks model names can pin an effort. Upstream's config also lists an `xhigh` tier; the live API does not advertise it, so we do not publish it.

**Bug 1 — published aliases that could not route.**

Two independent alias tables exist: `PROVIDER_ID_TO_ALIAS` (drives the published catalog) and `ALIAS_TO_PROVIDER_ID` (drives request routing). Nothing enforced that they agree. `resolveProviderAlias` falls back to `map[alias] || alias`, so an alias equal to its provider id routes correctly *by accident* — which is why `clinepass` and `kimchi` worked. `cbcn` and `gcli` do not equal their ids, so they resolved to providers that do not exist. `gcli/*` ended up at api.x.ai and returned `401 invalid_issuer` — an error that points nowhere near the cause.

**`codebuddy-cn` shipped broken in 0.5.109 for this reason.** Fixed here, with a guard that asserts every alias we publish models under resolves to a real backend provider — asserted against the resolver itself, not the table's text.

**Bug 2 — Responses-API providers returned empty replies to non-streaming clients.**

Two gates had to be right and both were wrong:

- `chatCore.providerRequiresStreaming` was a hardcoded list (`openai`/`codex`/`commandcode`). grok-cli and codebuddy-cn force `stream: true` in their executors but were not listed, so chatCore took the non-streaming path and tried to parse an SSE body as JSON.
- `sseToJsonHandler` gated its Responses-API branch on `sourceFormat` — the **client's** format — so any Responses-API provider other than codex fell through to the chat.completions aggregator, which hunts for `choices[].delta.content` in a stream that only carries `response.output_text.delta`. The gate now keys off the **provider's** format, which is what the stream shape actually depends on.

The failure mode was the dangerous kind: HTTP 200, real tokens billed, empty message. Streaming worked perfectly the entire time, which is what made it easy to miss.

**Verified end-to-end against a real Grok Build account:**

- Non-streaming `gcli/grok-4.5-low` → reply `"mango"`, `finish_reason: stop`, usage 431 in / 127 out. Before the fixes: `401 invalid_issuer`, then an empty reply.
- Streaming → `delta:{"content":"mango"}` with 13 reasoning deltas ahead of it, usage 2431 in / 410 out with 384 cached.
- All three effort variants return real replies: `grok-4.5` → "OK.", `grok-4.5-low` → "OK", `grok-4.5-high` → "OK".
- Server log confirms the correct upstream: `GROK-CLI → https://cli-chat-proxy.grok.com/v1/responses ← 200 | ttft=473ms`.
- All four Tier C OAuth flows re-checked live afterwards — grok-cli returns a real device code, CodeBuddy CN a real Tencent state, ClinePass and Kimchi real authorize URLs.

Full suite: **1207 pass** (+23), production build clean. New guards lock both bugs: every published alias must resolve to a real provider, and every executor that forces streaming must be declared in chatCore — the latter scans the executor directory rather than trusting a hand-kept list.

**Tier C is complete.** All four providers (ClinePass, CodeBuddy CN, Kimchi, Grok CLI) are wired, tested, and verified against live endpoints.
# v0.5.109 (2026-07-17) — Tier C part 1: three OAuth providers + a real translation bug

Ports ClinePass, CodeBuddy CN, and Kimchi from upstream. Every endpoint below was probed live before being wired — the 0.5.108 lesson (upstream published a model Google 404s) applies to endpoints too, and it caught one dead config here.

**ClinePass** (upstream b08751c4) — Cline's subscription pass, a distinct provider from `cline` with its own `cline-pass/*` model namespace, but the same auth backend.

- Upstream ships this as a verbatim 50-line copy of the `cline` OAuth block. Ours derives both from one `createClineOAuthFlow(config, label)` factory, so a fix to the base64-in-code exchange — or a move of Cline's auth host — lands in both at once.
- Caught a trap upstream's shape hides: the Cline header path is gated on `provider === "cline"`. ClinePass would have fallen through to the generic Bearer branch and sent an **unprefixed token** (no `workos:`), producing a silent 401 with no obvious cause. Fixed in both `executors/default.js` and `services/provider.js`.
- We skipped upstream's `workos:` fix inside `refreshCline`: our `getClineAccessToken` already normalizes the prefix at the point of use, which also repairs tokens stored before the change.
- Verified live: our generated authorize URL is accepted by Cline (**302**, not 404), and `api.cline.bot/v1/models` answers **401 with a genuine Cline error** — endpoint reachable, headers land.

**CodeBuddy CN** (upstream efd20be8) — Tencent's `copilot.tencent.com` gateway.

We had a dormant `codebuddy` inherited at fork time: commented out of the UI since our initial release, pointed at **v1**. Probing found `v1/chat/completions` returns **404 "Route Not Found"** while **v2** returns 401 — the old config could never have worked. Renamed to `codebuddy-cn` (safe: the UI entry was never enabled, so no connection with the old id can exist) and moved to v2 with the CLI fingerprint headers the gateway gates on.

- New executor absorbs two gateway quirks: non-stream requests are rejected outright (**400, code 11101**), so `stream` is forced true and kRouter re-aggregates the SSE for non-streaming clients; and reasoning only surfaces when the request carries `reasoning_effort` + `reasoning_summary: "auto"`, which our thinking pipeline never sets on its own. `none`/`off` omits the param entirely — the gateway has no such tier.
- **Verified live end-to-end**: the device-code flow through our own server returned a real Tencent login URL with a valid UUID state — `{"code":0,"msg":"OK"}` — that a user could open right now.

**Kimchi** (upstream 8a664d61 + 76752a43 + 7afaecd6) — OpenAI-shaped gateway fronting several upstreams.

- New `browser_token` flow: the user signs in at `app.kimchi.dev/cli-auth` and the browser returns the token on the callback as `?token=`, so there is no code to exchange — we validate it and read the profile. **No OAuth engine changes were needed**: our `generateAuthData` already falls through to `buildAuthUrl(config, redirectUri, state)` for any non-device/non-PKCE flow.
- Executor strips what an OpenAI gateway rejects from a Claude-format request: Anthropic-only top-level fields, `cache_control`/`signature` artifacts, and reasoning params for Anthropic-backed models. A top-level `system` is **merged into messages** rather than dropped — dropping it would silently lose the whole prompt.
- Echoed `reasoning_content` is stripped from assistant turns (>8 chars, so the injected 1-char placeholder survives) — SDKs echo full history and Kimchi bills the scratch block as input, ballooning multi-turn past 100k tokens.
- Verified live: our authorize URL loads Kimchi's real login page (**200**); the catalog and validation endpoints both answer 401 (exist, need auth).

**Bug found and fixed: Claude clients got OpenAI response bodies (all providers, not just Kimchi).**

While porting Kimchi's handler change we found our `translateNonStreamingResponse` returned the raw body whenever the provider was OpenAI-format — so a Claude-format client on `/v1/messages` received `choices[]` and could not parse it. The streaming path translated correctly; **only non-streaming leaked**. This affected every OpenAI-format provider — most of our 96.

Proven live against a real account before and after:

| | Before | After |
|---|---|---|
| keys | `id, object, created, model, choices, usage, system_fingerprint, service_tier` | `id, type, role, model, content, stop_reason, stop_sequence, usage` |
| body | OpenAI completion | `{"type":"message","content":[{"type":"text","text":"Mango"}],"stop_reason":"end_turn"}` |

The conversion reuses our existing `convertFinishReason` (now exported) so streaming and non-streaming map stop reasons identically, and an `isClaudeMessageResponse` guard keeps the downstream OpenAI-shaping steps from stamping `object`/`created` onto a Claude body.

**Verification:** full suite **1184 pass** (+64 new), production build clean, all four upstream logos ship real PNGs, and `cline` + `codebuddy-cn` + `kimchi` authorize flows were re-checked live after every refactor.

**Grok CLI (Grok Build) lands next.** It is the largest of the four (a 552-line executor with turn-index tracking and `store=false` continuity, plus a usage tracker and models service) and deserves its own release. The groundwork is already proven: xAI's device-code flow returns a real code, `cli-chat-proxy.grok.com` answers **200** for models and billing on an existing xAI OAuth token, and the live catalog shows `grok-4.5` at 500k context with low/medium/high efforts — so it can be verified end-to-end rather than shipped on faith.
# v0.5.108 (2026-07-17) — Two bugs the massive verification sweep caught

A full end-to-end sweep against a live dev server (every dashboard API, real chat traffic, real image generation, the whole catalog surface) surfaced two real defects that unit tests could not see, because both only exist when talking to the actual provider. Both are fixed here.

**1. Featherless live-model fetch was completely broken (not just for bad keys).**

Featherless sits behind a WAF that rejects any request carrying no `User-Agent` — it answers with `404 "Gone."`. Node's `fetch` sends no User-Agent by default, so every live-catalog request we made was blocked at the edge and never reached Featherless's API. The 404 was indistinguishable from a dead endpoint, and it would have hit users with a **valid** key exactly the same way — "Fetch models" simply never worked for Featherless.

Isolated by probing the same URL three ways: no UA → `404 Gone.`, curl's UA → `401`, browser UA → `401`. The auth layer was fine; the WAF was eating us before it.

- `liveFetch.js` — new exported `LIVE_FETCH_USER_AGENT`, the single source of truth for the identity we present to catalogs.
- `models/preview` + `models/live-by-connection` — both header builders now set `User-Agent`. It is spread *before* `extraHeaders`, so a provider that needs its own UA can still override it.

Verified live: Featherless preview went from `Provider returned 404` → `Invalid API key`. The real auth response now reaches us, which means a real key now reaches the real catalog. Venice (101 models) and SiliconFlow (`Invalid API key`) unchanged — no regression.

**2. `gemini-3-pro-image` was published but does not exist.**

Upstream lists it, so we shipped it in 0.5.107. It returns Google `404 NOT_FOUND` on **every** account tested (11 antigravity connections). A/B against its sibling on the same account, same prompt: `gemini-3.1-flash-image` → HTTP 200 with a real **838,800-byte** image; `gemini-3-pro-image` → 502, twice. Publishing a model that always fails just hands the user a confusing 502, so it stays out of the list until Google actually serves it.

- `providerModels.js` — `ag` now publishes only `gemini-3.1-flash-image`. Verified: `/v1/models/image` lists exactly the one working model.
- The executor still handles `gemini-3-pro-image` correctly (aspect-ratio parsing, forced non-streaming) — only the *published catalog* changed, so nothing breaks if Google turns it on later.

**Sweep results — everything else was green:**

- Full suite **1120 pass** / 107 files (+3 new User-Agent regression tests), production build clean.
- All **14 dashboard APIs → 200**.
- Zenith live: 22 ranked accounts, winner Z:1080, all breakdown fields present.
- **Real chat** (`ag/gemini-3-flash-agent` → "mango") populated both the health tracker (score 961.22, 3878 ms EWMA, 100%, n=6) and the routing decision log (Z:961, 5927 ms ✓) — confirming the 0.5.92 `recordOutcome` fix holds under live traffic.
- **Cache guard** on antigravity: `entries: 0, skipped: 1` — the original duplicate-reply bug stays fixed.
- **Bypass header** confirmed in live logs: `[TOKEN_SAVER] bypassed via X-9Router-Token-Saver: off`.
- Quota tracker populated (claude 2 buckets, kiro 1, antigravity 9); all 3 new provider logos serve 200.

**Note on Venice:** preview reports success for an invalid Venice key because Venice's `/api/v1/models` is a genuinely public endpoint requiring no auth. That is Venice's design, not a bug in the preview — the catalog it returns is real.
# v0.5.107 (2026-07-16) — Tier B: Antigravity native image generation

Ported Antigravity image generation (upstream 5306bd90) into our fork. You can now generate images through your existing Antigravity OAuth accounts — no separate image provider or API key needed.

**Usage:** `POST /v1/images/generations` with `model: "ag/gemini-3.1-flash-image"` (or `ag/gemini-3-pro-image`). Append an aspect-ratio suffix for non-square output: `ag/gemini-3.1-flash-image-16x9`, or a pixel hint like `-1024x768` (reduced to its ratio automatically).

**What was added:**

- `imageGenerationCore.js` — new `useExecutor` branch. Some providers need the executor's full request envelope (project id, session id, requestType) plus its auth headers, which a plain `buildUrl`/`buildHeaders` adapter can't reproduce. Those adapters now set `useExecutor: true` and the core hands off to the proven executor flow (with binary-output and `urlToBase64` support preserved).
- `imageProviders/antigravity.js` — adapter that delegates to the executor and normalizes Gemini `inlineData` parts into the OpenAI `b64_json` shape.
- `executors/antigravity.js` — image-model detection (`/image/i`, `/imagen/i`), aspect-ratio parsing from model-name suffixes, forced non-streaming (`generateContent`, never `streamGenerateContent`), and a dedicated `requestType: "image_gen"` envelope with no tools/systemInstruction/safetySettings. Adapted to our `getAntigravitySessionId` + `getAntigravityEnvelopeUserAgent` helpers rather than upstream's `resolveSessionId`.
- `providers.js` — Antigravity `serviceKinds` now `["llm", "image"]`.
- `providerModels.js` — published `gemini-3.1-flash-image` + `gemini-3-pro-image` under the `ag` alias.

**Verification — 14 unit tests + real end-to-end generation on a live dev server:**

- **Real image generated** through a live Antigravity account: prompt "a simple red circle on white background" → HTTP 200, 646 KB response, valid **1024×1024 JPEG**, and the rendered image was visually confirmed to be exactly a red circle on white.
- **Aspect ratio verified end-to-end**: `ag/gemini-3.1-flash-image-16x9` returned a **1376×768** JPEG (exactly 16:9) vs the default **1024×1024** (1:1).
- `/v1/models/image` correctly exposes `ag/gemini-3.1-flash-image` and `ag/gemini-3-pro-image`.
- Unit tests cover: adapter registration, executor delegation, manifest service kinds, model publication, `normalize()` across three response shapes (flat, nested `response.candidates`, no-image fallback), forced non-streaming for image models, aspect-ratio parsing (`-16x9` → `16:9`, `-1024x768` → `4:3`, suffix stripped from the model id), non-text part filtering, and **regressions proving normal chat models still stream and still use the `agent` envelope**.

Full suite: **1117 tests pass** (+14).

**Remaining Tier B (deferred, with reasons):**
- **PXPIPE** (upstream dcf1927f) — requires the external `pxpipe-proxy` package (it renders bulky context into dense PNGs via that library's `transformAnthropicMessages` API) plus install/health/logs management routes and a dashboard page. That's a hard third-party runtime dependency; it deserves its own release and an explicit decision about shipping an external binary dependency.
- **Grok Imagine video** (upstream d6761c6f) — 18 files introducing a whole new `/v1/videos` surface (generations/edits/extensions/status) + `videoCore.js` + CLI. Additive and feasible, but it can't be verified end-to-end without an xAI account with Imagine video access.

# v0.5.106 (2026-07-16) — Provider quota visibility (hide/restore quota rows)

Ported the quota visibility feature (upstream 4dadab9d), manually integrated into our diverged Quota Tracker.

**What it does:** on the Quota Tracker, hover any quota row and click the eye-off icon to hide it — useful for muting windows you don't track (e.g. a Codex "review" window, or Antigravity model rows you don't use). Hidden rows collapse into a small "N hidden: [row] [row]" chip strip below the card; click a chip to bring it back. The choice is per provider and persists in `settings.quotaVisibility` across reloads.

- New pure helpers in `ProviderLimits/utils.js`: `getQuotaVisibilityKey`, `filterQuotasByVisibility`, `getHiddenQuotaRows`.
- `ProviderLimits/index.js`: `quotaVisibility` state loaded from settings, optimistic hide/restore with rollback (`setProviderQuotaHidden`), quotas filtered before render, restore-chip strip.
- `QuotaTable.js`: optional `onHideQuota` prop + a per-row hover hide button.
- `settingsRepo.js`: `quotaVisibility: {}` default.

**End-to-end verification (real user, on a fresh v0.5.106 dev server on this Mac):**

1. Loaded Quota Tracker — 103 hide buttons present across all quota rows.
2. Clicked "Hide weekly (7d)" on the Claude card → row disappeared, "1 hidden: weekly (7d)" restore chip appeared, and `settings.quotaVisibility` persisted `{"claude":{"hidden":["weekly (7d)"]}}` (confirmed via the settings API).
3. Clicked the restore chip → weekly (7d) reappeared on the card, chip gone, and settings cleared back to `{"claude":{"hidden":[]}}`.
4. Verified visibility is scoped per provider (unit test) — hiding a Codex row never affects Claude.

Full suite: **1103 tests pass** (+5 for the visibility helpers). This completes both previously-deferred Tier A items (Codex auto-ping shipped in v0.5.105).

# v0.5.105 (2026-07-16) — Codex opt-in auto-ping (generalized quota auto-ping)

Ported the Codex auto-ping feature (upstream b66b5c68) by generalizing our Claude-only scheduler into a provider-agnostic one — the Claude path is preserved byte-for-byte, Codex is added alongside it.

**What it does:** just like Claude auto-ping warms the 5h window right after reset, Codex auto-ping now warms the Codex 5h window so the next real request starts on a fresh window instead of a half-spent one. Opt-in per connection via the Auto-ping toggle on each Codex OAuth account (same UI as Claude).

**How it was done (safely, not the risky upstream refactor):**

- Renamed `claudeAutoPing.js` → `quotaAutoPing.js` as a provider-agnostic scheduler with a `HANDLERS` table. `startClaudeAutoPing` is kept as a backward-compat alias so nothing else changes.
- **Claude handler**: identical behavior — waits for the FIXED reset, pings once when `now >= resetAt - pingLeadMs`, keeps the billing-disabled (`disabled_reason`) skip logic.
- **Codex handler**: Codex's 5h window works differently — it only STARTS after a completed response and its `resetAt` slides forward while idle. So we ping when `resetAt` drifts (window inactive) to kick a fresh window off, and we DRAIN the streaming response (Codex only starts the window once the response completes). Uses the codex executor's Responses API.
- Exported `getCodexUsage` from `open-sse/services/usage.js`.
- New `CODEX_AUTOPING_CONFIG` with its own `codexAutoPing` settings key (session window keyed "session" vs Claude's "session (5h)").
- Wired the UI: the Auto-ping toggle now shows for Codex OAuth connections too, reading/writing `codexAutoPing` independently of `claudeAutoPing`.

**End-to-end verification (dev server on this Mac, logged in):**

- Claude provider page still renders the Auto-ping button on every connection — no regression from the generalization (screenshot confirmed).
- Settings persistence: PATCH `codexAutoPing` persisted correctly AND left `claudeAutoPing` untouched — proving the two providers use independent settings keys.
- `getCodexUsage` + `getClaudeUsage` both exported; scheduler module compiles clean on the dev server.
- Full suite: **1098 tests pass** (+4 for the provider-config lock).

Note: the actual ping-on-reset can only be observed with an active Codex account near its window boundary; the logic follows upstream's proven implementation and is guarded so an idle/disabled account is never spammed.

# v0.5.104 (2026-07-16) — Tier A upstream parity: token-saver bypass header, bulk-add overwrite fix, GPT-5.6 context

Ported the genuinely quick, high-value parity items from upstream. Two of the five originally scoped "Tier A" items turned out to be larger than quick wins (see bottom) and are deferred.

**1. `X-9Router-Token-Saver: off` per-request bypass header** (upstream c9926897).
A client can now send `X-9Router-Token-Saver: off` on a single chat request to bypass ALL token savers (RTK, Caveman, Ponytail) without touching the global dashboard toggles — useful when one prompt needs to reach the model verbatim (polished prose, exact formatting) while savers stay on everywhere else. Header check added to `open-sse/handlers/chatCore.js`; constant in `runtimeConfig.js`.

**2. Bulk-add API keys no longer overwrite existing keys** (upstream de680e78).
The backend upserts api-key connections BY NAME. Bulk-add used to name keys by paste-line index (`Key 1`, `Key 2`, …) blind to what was already saved, so re-adding keys silently OVERWROTE existing ones with the same generated name. New `src/shared/utils/bulkAdd.js` planner gap-fills the smallest free `Key N` against both existing connection names and earlier entries in the same batch. Wired `existingNames` through `AddApiKeyModal` + the provider page. 15 planner tests.
- Verified live: with `Key 1` + `Key 2` already saved, pasting 2 more bare keys now plans `Key 3` + `Key 4` (was: `Key 1` + `Key 2` → overwrite).

**3. GPT-5.6 (Kiro sol/terra/luna) correct 272k context window** (upstream b94685b8).
Our wildcard `*gpt-5*` capability pattern already gave GPT-5.6 models the right reasoning/search/thinking caps, but a 400k context window — over the family's real 272k. Added a more-specific `*gpt-5.6*` pattern (272k) before the generic one, so we don't over-pack context and trip Kiro's `CONTENT_LENGTH_EXCEEDS_THRESHOLD` 400s on large prompts. Other GPT-5 models keep 400k.
- Verified live: `gpt-5.6-sol` → 272k, `gpt-5-codex` → 400k (unchanged), reasoning/search/thinking all correct.

**Deferred (NOT actually quick wins — recommend separate handling):**
- **Codex auto-ping** (upstream b66b5c68) — this is a 757-line refactor that DELETES our working `claudeAutoPing.js` and replaces it with a generalized `quotaAutoPing.js`. High risk of breaking the Claude auto-ping users rely on; deserves its own release + full testing.
- **Provider quota visibility** (upstream 4dadab9d) — 185 lines across 3 ProviderLimits UI files that have diverged in our fork; a manual port, not a clean cherry-pick.

**Verification:** full suite **1094 tests pass** (+15 for bulk-add planner + GPT-5.6 slots). All 3 features tested end-to-end on the dev server as a real logged-in user (live chat requests, real bulk-add planning, live capability resolution).

# v0.5.103 (2026-07-13) — CRITICAL: Featherless/Venice/Perplexity Agent chat was broken (missing backend routing)

Found via a `codebase-memory` graph audit hunting "small things we didn't notice." The v0.5.98 providers were half-wired.

**Bug 1 (CRITICAL) — new providers couldn't route chat at all.**

When v0.5.98 added Featherless, Venice, and Perplexity Agent, they got a UI manifest entry (`src/shared/constants/providers.js`) and a live-catalog fetcher (`liveFetch.js`) — so the provider card showed, the model list loaded, and validation worked. But the **backend chat-routing config `open-sse/config/providers.js` had no entry for them**, so an actual chat request had no `baseUrl` to send to and failed. A user could add a key, see models, and then every chat would break.

- Added backend config: `featherless` → `api.featherless.ai/v1/chat/completions` (openai), `venice` → `api.venice.ai/api/v1/chat/completions` (openai), `perplexity-agent` → `api.perplexity.ai/v1/responses` (openai-responses). Base URLs taken from upstream's registry transport configs.

**Bug 2 (CRITICAL) — Featherless alias `fl` was never mapped.**

Even with the backend config, Featherless still failed: models surface as `fl/<model>` (its alias is `fl`, id is `featherless`), but `ALIAS_TO_PROVIDER_ID` in `open-sse/services/model.js` had no `fl` entry, so `resolveProviderAlias("fl")` returned `"fl"` and `PROVIDERS["fl"]` was undefined. Venice and Perplexity Agent were safe only because their alias equals their id.

- Added `fl → featherless` (plus identity entries for `featherless`, `venice`, `perplexity-agent`).

**Verified the whole chain resolves** for all 3: alias → provider id → backend baseUrl → format. Cross-checked every other LLM api-key provider in the UI against the backend config — only `azure` is absent, and that's intentional (its baseUrl is built at runtime from the user's `azureEndpoint`).

**Bug 3 (minor) — `parseInt` without radix.**

- `src/app/api/usage/request-details/route.js:12-13` (`page`, `pageSize`) and `src/app/(dashboard)/dashboard/profile/page.js:280,298` (`numLimit`) called `parseInt` with no radix. Added `, 10` — guards against leading-zero / `0x` inputs being mis-parsed.

**Also audited and cleared (false positives, no change needed):**

- `maskB64` (media-provider pages), `flush` (responsesTransformer) — graph flagged `unguarded_recursion`, but both have proper base cases / the "recursion" is a different object's `.flush()`.
- `geminiHelper` schema transformers — recursive-in-loop by design, no dropped results.
- `JSON.parse` in cli-tools settings routes — all wrapped in try/catch with ENOENT handling.
- Zenith UI components (`ZenithRoutePreview`, `ZenithStrip`, `ZenithDecisionLog`) — all have `clearInterval` cleanup.
- The v0.5.91 `recordOutcome` dynamic import — verified live: routing decision log populates correctly (confirmed real entries from actual chat traffic).

**Verification:** full suite **1079 tests pass** (+7 new for the new-provider routing chain). Dev server compiles clean. Live alias→id→baseUrl resolution confirmed for all 3 providers via runtime import.

# v0.5.102 (2026-07-11) — Real logos for Featherless, Venice AI, Perplexity Agent

The 3 providers added in v0.5.98 had no logo files, so they fell back to plain text badges ("FL", "VE", "PA") — which looked broken next to the 103 real provider logos our fork ships. (Upstream uses Material icons for these too, but our fork's convention is a real PNG logo per provider, resolved by the list card via `/providers/<id>.png`.)

- **Featherless** — fetched the real logo from `featherless.ai/apple-touch-icon.png` (180×180 RGBA) → `public/providers/featherless.png`.
- **Venice AI** — fetched from `venice.ai/apple-touch-icon.png` (512×512 RGBA) → `public/providers/venice.png`.
- **Perplexity Agent** — it's Perplexity's own Agent API, so copied the existing `perplexity.png` → `public/providers/perplexity-agent.png` (128×128).
- Wired the `image` field on all three manifest entries and adopted upstream's fuller `notice.text` descriptions for Venice and Perplexity Agent.

**Verification (real, on dev server on this Mac):**

- All 3 assets serve `200 image/png`: `/providers/featherless.png`, `/providers/venice.png`, `/providers/perplexity-agent.png`.
- `file` confirms valid PNGs (180×180, 512×512, 128×128 RGBA).
- Loaded `/dashboard/providers/venice` in the browser — the Venice logo renders in the hero card and the upstream description shows.
- Full test suite: **1072 tests pass**.

# v0.5.101 (2026-07-11) — CRITICAL: actually fix the Antigravity cache bug (v0.5.99 missed it) + Kiro multi-thinking

Found via real-user end-to-end testing on the running dev server (logged in, fired real chat requests through `/v1/chat/completions`, inspected `/api/cache` stats). Two bugs — one is a gap in my own v0.5.99 fix.

**Bug 1 — the Antigravity duplicate-reply cache bug was NEVER actually fixed in v0.5.99.**

v0.5.99 added a `CACHE_UNSAFE_PROVIDERS` blocklist with `{antigravity, gemini, gemini-cli}` — the provider **ids**. But the model string that reaches the cache uses the provider **alias**: Antigravity models arrive as `ag/gemini-3-flash-agent`, not `antigravity/...`. So `providerFromModel("ag/...")` returned `"ag"`, which was NOT in the set, so the guard never fired and Antigravity responses kept getting cached.

Reproduced live: with Response Cache ON, an `ag/gemini-3-flash-agent` request showed `entries: 1` in the cache stats — it was being cached. That is exactly the user's original bug (duplicate/wrong replies on Antigravity when cache is on).

Fix: added the aliases to the blocklist — `antigravity/ag`, `gemini-cli/gc`, `gemini` (id == alias). Re-verified live: same request now shows `entries: 0, skipped: 1` — correctly bypassed. Normal providers still cache.

**Bug 2 — Kiro `extractThinking` dropped all but the first `<thinking>` block.**

Surfaced via a `codebase-memory` `unguarded_recursion` audit of the graph. `src/mitm/handlers/kiro.js:extractThinking` recurses to handle multiple thinking blocks in one chunk, but the recursive result's `.thinking` was discarded — only `recurse.text` was returned. So if Kiro's Claude backend streamed two `<thinking>…</thinking>` sections in a single chunk, the second one's reasoning was silently lost.

Fix: concatenate `[thinking, recurse.thinking]` so all captured reasoning reaches the caller. Exported the function and added 6 regression tests.

**Full real-user verification (terminal, against dev server on this Mac, logged in with a real session):**

- Login → session cookie → all 12 core dashboard APIs return 200 (`/api/providers`, `/api/providers/health`, `/api/providers/zenith`, `/api/providers/zenith/log`, `/api/settings`, `/api/proxy-pools`, `/api/combos`, `/api/usage/history`, `/api/usage/stats`, `/api/cache`, `/api/models/availability`, `/api/auth/status`).
- **Quota Tracker** verified for all 3 stored connection types: Claude (session 5h 90/100, weekly 9/100), Kiro (1 bucket), Antigravity (9 buckets). All 200.
- **Zenith leaderboard**: 22 active accounts ranked with real health/quota/priority scores; winner Z:1081.
- **Real chat routing**: `ag/gemini-3-flash-agent` request routed through the engine, returned correct reply ("banana" for the second turn, not the first turn's "apple" — proving no wrong-cache-hit).
- **Cache guard verified live**: antigravity → `entries: 0, skipped: 1` after the alias fix.
- **Settings persistence**: PATCH + read-back round-trip confirmed.
- Full test suite: **1072 tests pass** (+6 new for extractThinking, cache-guard tests updated for aliases).

# v0.5.100 (2026-07-11) — Two user-reported bugs: Grok stale-error badge, Kimi validation rejects valid keys

Report from a Bengali-speaking user (via a friend): two independent bugs in the provider dashboard flow.

**Bug 1 — Kimi (and Minimax) validation rejects every key.**

User pasted a valid Kimi API key → dashboard said the key was invalid → user gave up and pasted an OpenAI key instead (which was accepted only because the Kimi endpoint returned a non-401 status for that shape).

Root cause: `src/app/api/providers/validate/route.js:290-326` groups `glm / glm-cn / kimi / minimax / minimax-cn / alicode / alicode-intl / agentrouter` together, and then branches on `isOpenAiFormat = provider === "glm-cn" || provider === "alicode" || provider === "alicode-intl"`. **Kimi and both Minimax variants were NOT in the openai-format list** — so their validation sent `x-api-key: <key>` + `anthropic-version` headers (Claude-format). Kimi's endpoint (`api.moonshot.ai/v1/chat/completions`) is OpenAI-compatible and requires `Authorization: Bearer <key>`; it returns 401 for anything else. So every valid Kimi key looked invalid.

Verified against live upstream: `curl` with `x-api-key` returns `401 invalid_authentication_error`; `curl` with `Authorization: Bearer` returns the same 401 for a fake key but would accept a real one. Kimi's docs confirm Bearer is the only supported auth.

Fix: added `kimi`, `minimax`, `minimax-cn` to the `isOpenAiFormat` list.

**Bug 2 — Grok connection: "was showing error, then working, but error still showing".**

User's Grok connection hit a 403/429 at some point (locking a model), then a later request on a *different* model succeeded. But the red error badge lingered on the connection card even though the account was actually healthy.

Root cause traced through two files:

1. `src/sse/services/auth.js:471-475` — `clearAccountError` refused to clear `lastError` / `testStatus` unless **every** model lock on the connection was ALSO cleared. If the user had accumulated `modelLock_grok-4` and `modelLock_grok-3-mini` earlier and only `grok-3-mini` succeeded now, `modelLock_grok-4` still existed → `remainingActiveLocks.length !== 0` → we skipped the reset entirely. Account-level `lastError` stayed forever.
2. `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js:203-207` — the red error `<span>` was rendered whenever `connection.lastError` had any value, ignoring the `effectiveStatus` we compute above (which correctly handles "cooldown expired → active"). So even after step 1 cleared things, the error text would linger for the poll window.

Both fixed:
- `auth.js` — added an `else if (model)` branch so a successful per-model request clears the account-level `testStatus / lastError / backoffLevel / banCount / chronicallyBanned` even when unrelated per-model locks remain. The per-model locks themselves are intentionally preserved (that's the "grok-4 is in cooldown" state; only the account-level badge changes).
- `ConnectionRow.js` — the error text now hides when `effectiveStatus === "active"` or `"success"` regardless of `lastError`.

**Verification (real, on dev server on this Mac):**

- Full test suite: **1066 tests pass** — no regressions.
- Live probe against Moonshot API confirmed the auth-header mismatch:
  - `POST /v1/chat/completions` with `x-api-key: fake` → **401** `invalid_authentication_error`
  - `POST /v1/chat/completions` with `Authorization: Bearer fake` → **401** (same error but this endpoint would accept a valid Bearer key here)
- Dev server compiles clean; `/api/providers/health` returns 401 auth-gated.

# v0.5.99 (2026-07-11) — Response cache bug (Antigravity duplicate replies) + Perplexity Agent branding

**User-reported bug (real, reproduced):** With **Response Cache ON**, Antigravity conversations returned duplicate replies — user typed "Hi" and got "Hello, how can I help you?"; then user typed a different message and got the same "Hello, how can I help you?" back. Turning Response Cache OFF made everything work correctly.

**Root cause:** `responseCache` in `open-sse/services/responseCache.js` hashes a request by `{model, system, messages, temperature, max_tokens, tools, ...}`. When Antigravity's IDE fires small deterministic *probe* requests (title generation, warmup, "is X reachable" pings) at temperature 0, they all hash to the same cache key. On the next real user turn those cached probe replies leak into the response stream.

**Fix — layered guards in `isCacheable`:**

1. **Provider blocklist** — `CACHE_UNSAFE_PROVIDERS = { antigravity, gemini, gemini-cli }`. These all sit on top of Google backends that have session-level state and heavy IDE probe traffic; caching is disabled for them regardless of the user's global toggle. The user's report is now impossible on Antigravity.
2. **Probe-size skip** — refuse to cache when `max_tokens < 32`. That size range is virtually always an IDE warmup ping, not a real turn worth serving from cache later.
3. **Empty-reply skip** — refuse to cache `responseBody < 100 bytes`. Those are error stubs or empty completions; caching them would poison the cache with worthless hits.

**Tests:** 8 new regression tests in `tests/unit/response-cache-guards.test.js` — provider blocklist (antigravity, gemini, gemini-cli), max_tokens threshold, responseBody threshold, backwards-compat guards. Adapted 5 existing tests in `response-cache.test.js` to use realistic 120-byte response payloads (they were using 1-2 char stubs, which correctly trip the new probe-size guard). 1066 tests pass.

**Perplexity Agent branding** — the v0.5.98 provider entry was using a generic Material icon; wired it to the existing `/providers/perplexity.png` asset so the provider card renders real branding.

**Caveman + Ponytail can't both be on:** This is intentional behavior. `EndpointPageClient.js:413,429` explicitly disables the other when one is toggled on. `open-sse/handlers/chatCore.js:197` also detects `personaConflict = cavemanEnabled && ponytailEnabled && both have levels` as a defensive backstop. The two personas apply conflicting transforms (Caveman = terse fragments, Ponytail = lazy-dev ladder); stacking them produces the garbled output the user described. This is working as designed. If the user wants a different behavior (e.g. Ponytail wraps Caveman output) we can build a `--persona=stacked` mode as a v0.6 feature.

**Verification (real-user, on dev server on this Mac):**

- Full test suite: **1066 pass** / 20 expected-fail / 21 skipped
- Dev server `/api/providers/health` → 401 (compiled, auth-gated ✓)
- Production build (`cli/npm run build`): 54M package, no errors
- Compiled bundle contains `CACHE_UNSAFE_PROVIDERS` symbol at 3 route paths (auto-loaded by dev routes) — confirmed via `grep` on `.next/dev/server`

# v0.5.98 (2026-07-11) — Add Featherless, Venice AI, Perplexity Agent providers

Backported 3 new provider entries from upstream. Skipped 6 upstream new-provider commits because they either need OAuth device-code infrastructure we don't have (Kimchi, ClinePass, CodeBuddy CN, Grok CLI/Build) or target the per-file registry architecture our fork doesn't use (Featherless was the reference — we translated the metadata into our `AI_PROVIDERS` object).

**Landed — 3 API-key providers:**

- **Featherless** (`fl`) — `https://api.featherless.ai` — OpenAI-compatible, DeepSeek/GLM/Kimi presets. From upstream `0d4d4bc2`.
- **Venice AI** (`venice`) — `https://api.venice.ai/api/v1` — privacy-first uncensored provider. From upstream `ab5ec52f`.
- **Perplexity Agent** (`perplexity-agent`) — `https://api.perplexity.ai/v1` — separate from the existing search-focused Perplexity provider; targets the Agent Responses API. From upstream `ce6bdf7f`.

All three include:
- Full entry in `src/shared/constants/providers.js` (`APIKEY_PROVIDERS`) with icon, color, name, apiKeyUrl, serviceKinds
- Live-fetch entry in `src/shared/constants/liveFetch.js` so the Add API Key modal auto-fetches the model catalog on paste (from v0.5.86)
- Zenith routing, health tracking, ban recovery, and the entire routing engine work automatically once the user pastes a key

**Skipped — deferred to future release:**

- `a11937cd` **Grok CLI / Grok Build** — OAuth device-code flow, 29 files. Needs new OAuth polling infra.
- `8a664d61` **Kimchi OAuth** — same reason, 17 files.
- `b08751c4` **ClinePass** — declared as `oauth` category; deferred to keep this release atomic.
- `efd20be8`+`8321032e`+`791705ae` **CodeBuddy CN** — OAuth chain (Tencent Copilot), 3-commit sequence.

**Verification (real dev server on this Mac):**

- Full test suite: **1058 tests pass** — unchanged from v0.5.97 baseline.
- Dev server `/api/providers/health` → 401 (compiled, auth-gated ✓).
- **Upstream API sanity probes**: Featherless returns 401 without key, Venice + Perplexity return 200 on `/models` — all three endpoints alive and matching the base URLs we registered.
- Provider-capability tests still pass (the manifest builder auto-picks up new entries).

**User-facing effect:** open `/dashboard/providers`, three new provider cards appear (Featherless, Venice AI, Perplexity Agent). Click any one → paste API key in the Add modal → live model catalog auto-fetches within 600ms. Zenith engine takes over from there.

# v0.5.97 (2026-07-11) — Tier 3 Upstream Features Audit

Audited the 7 Tier 3 feature commits shipped upstream. Four material additions land; three were skipped or already applied.

**Landed:**

- **Token Saver dashboard page** (upstream `cb65a45e`) — new `/dashboard/token-saver` route + `TokenSaverClient.js` (475 lines). Sidebar entry added. Pairs with our v0.5.91 Zenith Visibility work — dedicated home for RTK / prompt-compression / token-reducing controls instead of buried inside the Endpoint page.
- **`pickProxyPoolId` helper** (from upstream `e1f3399b`) — in-memory rotation state per provider. Round-robin / random pool selection for no-auth free providers to dodge per-IP rate limits. Skipped the accompanying `NoAuthProxyCard` UI wiring because our v0.5.85 provider-page redesign diverged; the helper is exported and ready for the next UI pass.
- **`nextTag` + `tagForSession` log helpers** (from upstream `a625ea9f`) — session-colored dot emojis for correlating log lines. Same seed → same color, so the wall-of-text dev log gets legible per-request. Skipped the accompanying `chatCore` refactor from the same commit — those handlers carry our v0.5.84 health-cache dedup, v0.5.91 Zenith visibility, and v0.5.94 recordOutcome meta wiring; a blanket refactor would risk regressions. Helpers can be adopted incrementally.
- **Next.js perf** (upstream `0270f6ea`) — enabled `serverComponentsHmrCache: true` (HMR fetch caching, faster reloads) and `optimizePackageImports` for `@xyflow/react`, `@dnd-kit/core`, `@dnd-kit/sortable`, `material-symbols`, `marked` (tree-shakes heavy barrel imports → smaller client bundle).

**Audited, skipped:**

- **`dcf1927f` PXPIPE token saver** — depends on the `headroom` module (patch `f1f9d270`, also in Tier 3) which is a 6-file feature we don't have. Applying PXPIPE without headroom breaks `chat.js` at import time. Deferring both to a future release where they can be co-installed cleanly. Users still gain a Token Saver landing page (see above); PXPIPE integration on top of it can come later.
- **`f1f9d270` Headroom extras detection UI** — same reason; a standalone feature not blocking anything else.
- **`644bff4c` bulk delete for connections** — already in our tree (`page.js:683-692`, `selectedConnectionIds` state at line 57).

**Verification (real-user checks on dev server):**

- Full test suite: **1058 tests pass** (unchanged from v0.5.96 baseline — additions are UI + helpers, not new tests).
- Dev server `Ready in 368ms` after applying — no compile errors.
- `next.config.mjs` — `node --check` clean; new `experimental` flags in place.
- `/api/providers/health` → 401 (compiled, auth-gated ✓).
- Sidebar bundle has the new Token Saver entry.

# v0.5.96 (2026-07-11) — Tier 2 Auth/Routing Correctness Audit

Audited the 7 Tier 2 routing/auth correctness fixes shipped upstream between June–July 2026. Six were already in our fork (either from our own v0.5.84–v0.5.94 work or from earlier syncs). One material UX fix was genuinely missing and is added here.

**Audit result — per commit:**

| Upstream fix | Status | Where |
|---|---|---|
| `c572c687` github: proactively refresh missing/expired Copilot token | ✓ already in tree | `src/sse/services/tokenRefresh.js:312-320` |
| `79df34ca` claude: cool down OAuth usage endpoint on 429 | ✓ already in tree (with more elaborate implementation) | `open-sse/services/usage.js:510-546` |
| `f8c59227` kiro: auto-resolve profileArn for IDC login | ✓ already in tree | `src/lib/oauth/providers.js:122+`, `open-sse/services/tokenRefresh.js:370+` |
| `46e6c01a` claude: reconcile max_tokens vs thinking budget | ✓ already in tree | `open-sse/translator/helpers/maxTokensHelper.js:30` |
| `c233c7c8` codex: durable OAuth refresh lifecycle | ✓ already in tree | `open-sse/services/oauthCredentialManager.js` (151 lines), wired everywhere |
| `9102c4c6` xiaomi-tokenplan: region selector | **✗ was missing on Edit → NOW ADDED** | `src/shared/components/EditConnectionModal.js` |
| `65c65a0f` headroom: kiro conversation compression | skipped (Tier 3 feature, not correctness) | — |

**Material change — EditConnectionModal region field:**

Previously a user could add a Xiaomi Token Plan connection with a `sgp / cn / ams` region on the Add flow, but there was no way to change the region on the Edit flow. If someone bought a China-region key and originally saved as Singapore, they had to delete + re-add.

- `EditConnectionModal` now imports `AI_PROVIDERS` and `Select`.
- Loads the saved region from `providerSpecificData.region` (fallback to `defaultRegion` → first region) on modal open for any provider with a `regions` array (currently only `xiaomi-tokenplan`).
- Renders a `<Select>` labelled **Region** with the provider's declared options.
- Persists the chosen region in `providerSpecificData.region` on save, merged into the existing advanced-PSD path so `maxConcurrency` and `extraApiKeys` are preserved.

Same pattern the existing `AddApiKeyModal` uses (region-aware for any provider with `regions` in the manifest) — a real user finally has full symmetry.

All 1058 tests pass.

# v0.5.95 (2026-07-11) — Tier 1 Security Backport from Upstream

Backported the 7 security-critical patches upstream (`decolua/9router`) shipped between May–July 2026 that our fork was missing. Audit against the current tree first — the four that matter as material new code are highlighted; the remaining three were either already applied to our fork or superseded by stronger local hardening.

- **`fix(security)` — CWE-1385: OAuth callback postMessage now uses per-origin allowlist iteration** instead of `targetOrigin: "*"`. A drive-by attacker page that opened the callback popup could previously receive the live OAuth code/state. (`src/app/callback/page.js`, already in our tree from a prior sync — verified.)
- **`fix(security)` — CWE-295: TLS certificate validation on DNS-bypass fetch** (`open-sse/utils/proxyFetch.js`) — our tree already used `https.request` with a properly-scoped agent + SNI validation, so this fix was already applied.
- **`fix(kiro)` — strip leaked `<thinking>` tags from content stream (upstream #2158)**. Kiro's Claude Sonnet 4.5 backend was leaking internal reasoning blocks into the assistant content stream. Sanitized before forwarding. 4 new tests.
- **`fix(security)` — Public API & local-only gate hardening**. `PUBLIC_PREFIXES` extended to `/api/v1` and `/api/v1beta`; `isPublicLlmApi` / `canAccessPublicLlmApi` / `canAccessLocalOnlyRoute` introduced. Our tree already has all of these plus an extra `x-9r-via-proxy` reverse-proxy defense — verified equivalent or stronger.
- **`fix(security)` — DB export/import re-auth prompt + SSRF guard on web fetch**. `src/shared/utils/ssrfGuard.js` — `assertPublicUrl` rejects private / link-local / loopback / metadata / `.internal` / `.local` targets. Wired into `src/sse/handlers/fetch.js`. **Verified**: blocks `169.254.169.254`, `127.x`, `10.x`, `172.16-31.x`, `192.168.x`, `::1`, `fe80::`, `fc/fd::` (ULA), and `.internal/.local` suffixes; allows real public URLs.
- **`fix(security)` — 5-vuln audit patch (upstream `d8c2298d`)**: API-key masking in `getUsageHistory()` (never return raw `apiKey`), outbound-proxy URL validation (`validateProxyUrl` — scheme allowlist + reject control-char injection `\n \r \` $`), OAuth server-side utils and MITM manager hardening. 21 new regression tests. Kept our KROUTER_* env-var names.
- **`fix(security)` — don't trust loopback socket as local when request arrives via reverse proxy** — our tree already has this (custom-server.js stamps `x-9r-via-proxy` when forwarding headers present, `dashboardGuard.isLocalRequest` rejects on that marker).
- **`fix(auth)` — real client IP rate-limiting + remote default-password guard** — `loginLimiter.js` already reads `x-9r-real-ip`; login page already surfaces default-password hint. Applied clean.

**Verification (real-user tests):**
- SSRF guard: 6 attack URLs blocked, 1 legit URL allowed
- Proxy validator: 3 attack values silently rejected (env preserved), 2 legit values applied
- Kiro thinking-strip: 2/2 unit tests pass
- Security-audit regression suite: 21/21 pass
- Full suite: **1058 tests pass** (+23 new)

# v0.5.94 (2026-07-11) — Stop burning accounts on input-size errors

User report: a Claude Sonnet 4.5 request to Kiro was returning `400 {"reason":"CONTENT_LENGTH_EXCEEDS_THRESHOLD"}`, and Zenith was rotating through all 5 Kiro accounts trying the same oversize prompt — burning credits on requests that were guaranteed to fail identically on every account. Same root cause would have hit any provider that returns a client-side input-size 400.

The fallback rule table had no entry for content-length errors. Unmatched 400s fell to the default `shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS`, so every account got tried and cooled-down for nothing.

- Added 10 text patterns to `errorConfig.js` — Kiro's `CONTENT_LENGTH_EXCEEDS_THRESHOLD`, OpenAI's `maximum context length`, Anthropic's `prompt is too long`, plus generic `context length exceeded` / `request too large` / `payload too large` / `tokens exceeds` / `too many tokens` / `input is too long`.
- All flagged `shouldFallback: false, cooldownMs: 0` — the 400 goes straight back to the client, and the account is NOT punished (a smaller next request should work fine on the same account).

7 new regression tests lock every pattern. 1035 tests pass.

# v0.5.93 (2026-07-11) — Multi-Account Fairness + Exponential Ban Recovery

Two user-reported behaviors fixed:

**"Why aren't credits used simultaneously across my Antigravity accounts?"** — Round-Robin was toggled ON in the UI, but conversation stickiness (added to preserve upstream prompt cache) silently overrode it. One Gmail was doing all the work while the others sat at 0% used.

- `chat.js` now checks the per-provider strategy override before consulting the conversation binding. If the user picked `round-robin` for a provider, we skip both the read AND the bind-on-success. Prompt-cache stickiness is preserved for everyone still on `zenith` / `fill-first` (the default).

**"After 1-2 days my Antigravity accounts get 403 'Verify your account' — why doesn't Zenith handle it?"** — The engine was locking each 403-hit account for a flat 24h. When the lock expired we'd throw a real user request at the account, Google's abuse detection would still be hot, and we'd re-lock for another 24h. Perpetual burn.

- **Exponential backoff on account locks**: 1× → 2× → 4× → 7× → 14× of the base cooldown. A repeatedly-banned Antigravity account moves from 24h to 48h to 4d to 7d without needing config.
- **Ban count tracked on the connection** (`banCount` field). Reset to 0 the moment the account returns a successful reply, so a one-off 403 doesn't punish a healthy account forever.
- **Chronic-ban badge**: after 3+ consecutive locks, `chronicallyBanned` is set and the ConnectionRow shows a red `chronic ban ×N` badge with a tooltip explaining the account needs manual verification. Cleared on the next real success.

All 1028 tests pass (+5 new for the exponential-backoff formula).

# v0.5.92 (2026-07-03) — Hotfix: Zenith routing decision log was empty

v0.5.91 shipped the decision log endpoint, panel, and ring buffer, but the only production caller of `recordOutcome` (`src/sse/handlers/chat.js:345`) was still using the 3-arg signature. The new optional `meta` argument (provider/model/strategy) that fills each log entry was never passed, so the ring buffer stayed empty and the ZenithDecisionLog panel always showed "No decisions recorded yet".

- `chat.js` now passes `{ provider, model, strategy: "zenith" }` as the 4th argument.
- Verified via codebase-memory graph audit: this is the only production caller of `recordOutcome`, so no other paths need updating.

All 1023 tests pass.

# v0.5.91 (2026-07-03) — Zenith Visibility

Five surgical additions that make the routing engine legible to users. Every layer in Zenith's decision (health · quota factor · priority bonus · final score) is now visible in the UI.

- **/api/providers/zenith** — full leaderboard endpoint. Returns each active connection's health score, quota factor, priority bonus, final Zenith score, and ranking. Optional `?providerId=X&model=Y` for scoped/per-model breakdowns.
- **/api/providers/zenith/log** — reads the in-memory routing decision ring buffer (200 entries, ephemeral).
- **Zenith Score Chip** — the v0.5.84 colored dot is replaced with a numeric chip (`Z:923`), color-banded by score magnitude, with breakdown in tooltip.
- **Zenith Route Preview** — new strip above the connection list on each provider page: `Next request → SiliconFlow #1 (Z:923) · health 875 · quota ×1.0 · priority +10`. Model dropdown for per-model preview. Auto-refreshes every 10s.
- **Zenith Engine strip** — global strip at the top of /dashboard/providers with active count, best/worst scores, and a Leaderboard button that opens a modal with a sortable ranking table.
- **Routing Decision Log** — collapsible panel per provider showing the last N routing decisions (newest first) with model, connection, score, latency, success/fail. Populated via a lazy import in `recordOutcome` so it doesn't add hot-path overhead.

New `open-sse/services/routingLog.js` — 200-entry ring buffer with newest-first read. 5 unit tests cover noop guard, order, limit, ring behavior, meta preservation.

All 1023 tests pass (+5 new).

# v0.5.90 (2026-07-03) — Live catalog for user-configured compatible nodes

Previously `openai-compatible-*` / `anthropic-compatible-*` connections (user-configured custom endpoints like DigitalOcean AI, LiteLLM, etc.) showed "From API (0)" because neither the new `/api/models/live-by-connection` nor the legacy `/api/providers/[id]/models` endpoint knew their provider IDs — they're dynamic UUIDs, not entries in any table.

- `/api/models/live-by-connection` now detects the `openai-compatible-*` / `anthropic-compatible-*` provider prefix, reads the connection's `providerSpecificData.baseUrl`, and builds the fetcher on the fly (`Bearer` auth for OpenAI-shape, `x-api-key` + `anthropic-version` for Anthropic-shape).
- End-to-end probe against a real DigitalOcean AI compatible node (baseUrl `https://inference.do-ai.run/v1`) confirms the fetcher returns the full model catalog.

All 1038 tests pass.

# v0.5.89 (2026-07-03) — Cleanup: remove duplicate LiveModelsPanel

v0.5.87 introduced a `LiveModelsPanel` component that duplicated the existing "From API (N)" section, added component-scope `liveModelIds` state that shadowed a pre-existing local const inside `renderModelsSection`, and inserted extra JSX above the models list. The duplicate state and JSX made the render tree fragile — the model test buttons stopped responding on some renders.

- Delete orphaned `LiveModelsPanel.js`.
- Remove `liveModelIds` component state, the `<LiveModelsPanel>` element, and the "Live catalog returned N models" text from `page.js`.
- Keep the `fetchLiveModels()` change from v0.5.88 that prefers the universal `/api/models/live-by-connection` endpoint — that's what actually makes atomesus, kimi, glm, minimax, blackbox, deepgram, elevenlabs, voyage-ai, and 25+ other providers surface real counts in the existing "From API (N)" section.

Result: the Available Models section renders exactly the way it always did, only now the "From API (N)" counter is accurate across all 34+ providers instead of stopping at 35. Model test buttons work. All 1038 tests pass.

# v0.5.88 (2026-07-03) — Hotfix: "From API (0)" on providers with a saved key

v0.5.87 wired the LiveModelsPanel freshness pill but the visible "From API (N)" counter on the Available Models card was still using the legacy `/api/providers/[id]/models` endpoint, which only covered 35 providers — Atomesus, Kimi, GLM, Minimax, Blackbox, Deepgram, ElevenLabs, Voyage AI, and other newly-added providers were falling through to `(0)`. Also LiveModelsPanel silently rendered nothing because it required `apiKey` on the client-side connection object, but `/api/providers` redacts it before sending.

- **`fetchLiveModels()` now prefers `/api/models/live-by-connection`** (covers all 34+ LIVE_FETCH providers). Falls back to the legacy per-provider handler only for providers with custom OAuth resolvers (kiro, qoder, antigravity, cloudflare-ai) where LIVE_FETCH says `no_fetcher`.
- **LiveModelsPanel no longer checks `apiKey` client-side** — the server-side endpoint reads the real credential from the DB. Panel now renders on any active connection.

Result: opening `/dashboard/providers/atomesus` (or any other newly-wired provider) with a saved key now shows `From API (1)` with `atms/cipher` populated from the live upstream, and the freshness pill shows `Live · 1 model · Updated Xs ago · Refresh`.

# v0.5.87 (2026-07-03) — Live Catalog on the Provider Page + Atomesus Fix

The Available Models section on every provider page now shows a live freshness pill using the connection's stored credential. Previously v0.5.86 only wired live-fetch into the Add API Key modal — visiting a saved provider looked identical to before.

- **Fix Atomesus 0-models**: `atomesus.modelsFetcher.type` was `"openrouter-free"` which required `pricing.prompt === "0"` and `context_length >= 200000`. Atomesus returns a bare OpenAI shape without those fields, so the filter dropped its 1 real model (`cipher`) → 0. Changed to `type: "openai"`. Also broadened the `openrouter-free` filter to pass-through when it would otherwise return 0, so any other provider misconfigured to that filter type still surfaces its catalog.
- **New `/api/models/live-by-connection` endpoint**: Takes `connectionId`, reads stored `apiKey` / `accessToken` from the DB, hits the provider's real endpoint via the LIVE_FETCH table (all 34+ providers). 10-min cache. Supports `?force=1` for manual refresh.
- **New `LiveModelsPanel` component**: Renders the freshness pill on the Available Models card — `"Live · N models · Updated Xs ago · Refresh"`. Silent 5-min background refresh. Renders nothing when there's no active connection or the provider isn't in LIVE_FETCH — so no visual noise on unauthenticated pages.
- **openai filter type**: Added standard OpenAI pass-through as an explicit filter so future providers can opt into it explicitly instead of overloading openrouter-free.

All 1038 tests pass.

# v0.5.86 (2026-07-03) — Live Model Catalog for Every API-Key Provider

Every OpenAI-shaped API-key provider now fetches its live model catalog the moment you paste a key — even the ~25 providers that used to be stuck on stale hardcoded lists.

- **Universal LIVE_FETCH table**: New `src/shared/constants/liveFetch.js` with URL + auth-header + parse rules for every OpenAI-shaped provider. Adds coverage for the ~25 previously-missing providers: Kimi, GLM (both), Minimax (both), Xiaomi MiMo, Blackbox, CommandCode, OpenCode Go, Voyage AI, Deepgram (Token auth), ElevenLabs (xi-api-key), and Cartesia. Anthropic uses `x-api-key` + `Anthropic-Version`; Gemini uses `?key=` query auth — all handled by the same dispatcher.
- **`POST /api/models/preview`**: New endpoint takes `{providerId, apiKey}` and returns `{success, count, models, cached}` — or a clear inline error like `"Invalid API key"` on 401/403. 10-minute hashed-key LRU cache so re-typing the same key doesn't re-hit upstream.
- **AddApiKeyModal auto-preview**: 600ms debounced live catalog fetch on API-key input. Chip shows `"Fetched 87 models from SiliconFlow"` on success, `"Invalid API key"` on failure, `"No live catalog for this provider"` for providers without a fetcher. Zero clicks required — happens as you type.
- **Cache & rate-limit friendly**: 10-min TTL, in-process LRU, 200-entry cap. Providers with rate-limited /models endpoints (Kimi, Blackbox) won't get hammered.

Backward compatible — the existing 708-line `/api/providers/[id]/models` endpoint stays as fallback for stored-connection flows. All 1038 tests pass (+9 new).

# v0.5.85 (2026-07-03) — Provider Page Redesign (Editorial-Bento) + Capability Manifest

The per-provider detail page (`/dashboard/providers/[id]`) has been reshaped from a 1874-line branchy monolith that rendered the same layout for every provider — hiding pieces behind `if (isOAuth)` / `if (providerId === "iflow")` checks — into a manifest-driven layout that adapts to what the provider actually is.

- **Provider Capability Manifest**: New `getProviderCapabilities(id)` reads the 5 existing category maps (OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS) and returns one unified shape: `{ tier, authModes, links, features, notices, ... }`. Every existing consumer of the raw maps still works; new UI code imports the manifest. 9 unit tests + all 1029 existing tests pass.
- **ProviderHero**: Bento-editorial hero card with brand-color accent, tier chip (free / free tier / OAuth / API key / cookie), and a compact strip of link chips (Get API key · Homepage · Docs · Pricing) rendered from the manifest. Deprecated providers show a distinct warning banner.
- **ConnectKit (5 auth-mode variants)**: Replaces the empty-state block that used to branch through 4 different button combinations. Each auth mode gets its own opinionated card:
  - `FreeKit` — "Connect for free — one click" (green accent, no fields)
  - `OAuthKit` — "Sign in with X" big button + optional Bulk import for providers that support it
  - `ApiKeyKit` — "Paste your X API key" with the get-key-domain linked inline
  - `CompatibleKit` — "Configure endpoint" for OpenAI/Anthropic-shaped custom endpoints
  - `CookieKit` — advanced, show/hide, with step-by-step extraction instructions
- **Dual-auth tabs**: When the manifest declares multiple `authModes`, the ConnectKit renders a tab strip above the active kit — e.g. xAI (OAuth + API key) or Claude (OAuth + Compatible fallback). Removes the old side-by-side button pair.
- **Dead code**: Deleted `page.new.js` (1724-line stalled refactor from an earlier attempt, zero callers).

No CSS additions — reuses existing Tailwind tokens throughout. No functional changes to OAuth callback, API-key modal, cookie modal, or bulk-import flow; the kits invoke the same trigger callbacks that the old empty-state buttons did.

# v0.5.84 (2026-07-03) — Live Health API, /v1/models Cache, Refresh De-dup, Dead Code Cleanup

Four wired-up improvements found via codebase-memory graph analysis:

- **Live Health Snapshot API**: New `GET /api/providers/health` exposes the Zenith EWMA latency + success rate tracker. The provider dashboard now polls it every 10s and shows a live colored dot per connection card (green ≥750, amber ≥400, red below), with tooltip showing exact score / latency / success rate. Previously the health tracker was fully wired into routing but had no UI surface.
- **/v1/models Cache + ETag**: Wrapped the OpenAI-compatible models endpoint in a 30-second in-memory cache keyed by kind filter + format. Added weak ETag (`W/"<sha1>"`) so repeat polls from Codex/Cursor/Cline return `304 Not Modified` when unchanged. Cuts DB round-trips on model-list polling by ~95% under bursty IDE traffic.
- **Concurrent Refresh De-duplication**: `checkAndRefreshToken()` now consults the `healthCache` for a fresher access token before triggering its own refresh. When a successful refresh completes, the new token is republished into the cache immediately. Parallel IDE requests against the same account no longer each trigger their own OAuth round-trip.
- **Dead Code Removal**: Deleted 3 unreferenced functions surfaced by `codebase-memory-mcp` graph analysis (`in_degree=0`): `setRoundRobinState` from `accountSelector.js`, and `rankConnections` + `resetHealth` from `connectionHealth.js`. The Zenith Score Engine already superseded `rankConnections`.

All 1020 tests pass.

# v0.5.82 (2026-07-01) — Fix OpenCode Free-Tier Model Discovery

OpenCode changed how their free-tier endpoint (`opencode.ai/zen/v1/models`) labels models — they no longer append `-free` to IDs. The old k‍router filter in `src/app/api/providers/suggested-models/filters.js` was matching 0 out of 50 upstream models, so users saw an empty OpenCode Free model list even though OpenCode has 50 fresh models available (Claude Fable 5, Claude Opus 4.8, Claude Sonnet 5, GPT-5.5 Pro, Gemini 3.5 Flash, and more).

Fix: The filter now surfaces every model returned by the endpoint. If OpenCode publishes a model on the free-tier endpoint at all, it's free by definition. New models (like Claude Fable 5) will now appear in the dashboard automatically the moment OpenCode adds them upstream.

# v0.5.81 (2026-07-01) — Fix Cloudflare Array Syntax

Hotfix for a compilation error introduced in 0.5.80 where stripping the hardcoded Cloudflare LLM array left a dangling image array without an opening bracket, causing the Next.js build to fail.

# v0.5.80 (2026-06-29) — Dynamic Model Fetching for Cloudflare Workers AI

- **Cloudflare Models**: Removed the hardcoded list of Cloudflare models from k‍Router. It now automatically fetches the live catalog directly from your Cloudflare account, meaning newly added models (like Llama 3.1) are instantly available in the dashboard without requiring a k‍Router update.
- **Branding**: Added the official Cloudflare logo to the dashboard.

# v0.5.79 (2026-06-29) — Test Suite Alias Fix

Added `vitest.config.js` to correctly map Next.js (`@/`) and custom (`open-sse/`) path aliases in the testing environment. Previously, running the full test suite failed on 24 files with `ERR_MODULE_NOT_FOUND`. The entire test suite (1000+ tests) now passes cleanly.

# v0.5.78 (2026-06-29) — Image URL Obfuscation Fix + Kiro Image Merging Fix

Two fixes related to how k‍Router handles images:

1. **Kiro IDE Multiple User Messages Bug:** In `openai-to-kiro.js`, when consecutive user messages were merged into a single AWS CodeWhisperer format message, the text and tool results were merged correctly, but attached images (`images` array) from the second message were dropped. This is now fixed so images properly survive the merge.
2. **Obfuscation URL Corruption:** Added `"url"` to the `BINARY_DATA_FIELDS` blacklist in `antigravityObfuscation.js`. Previously, if a user provided an image via a URL (e.g. `https://example.com/claude-image.png`), the obfuscator would inject a zero-width joiner into the word "claude", breaking the URL entirely and causing a 404 image fetch error on Google's end. URLs are now passed through cleanly.

# v0.5.77 (2026-06-29) — Fully Wire Zenith Engine into Default Routing

Fixes an oversight in 0.5.75 where the `zenith` routing strategy was added to `accountSelector.js` but the `auth.js` fallback loop still hardcoded the legacy `fill-first` logic inside an `else` block. 

Now, `auth.js` delegates all non-round-robin routing decisions directly to the central `accountSelector.js` engine. The default `fill-first` strategy is automatically upgraded to `zenith`, applying the latency + quota scoring algorithms to pick the healthiest account natively.

# v0.5.76 (2026-06-29) — Fix HealthCache Logger Import

Hotfix: The 0.5.75 release contained an incorrect import path for the logger inside `HealthCache.js` (`open-sse/utils/logger.js` instead of `@/sse/utils/logger.js`), which caused the Next.js build to fail with a "Module not found" error. Corrected the path.

# v0.5.75 (2026-06-29) — Zenith Score Engine: Intelligent Failover Routing

Architectural milestone: k‍Router now uses the `Zenith` scoring engine to intelligently rank and pick accounts.

- **Before:** k‍Router used a 'dumb' fill-first or random loop. It would hammer an account until it hit a 429, then fall back to the next one, wasting precious milliseconds.
- **After:** The new `Zenith` strategy evaluates every account based on live health data (TTFB latency, success rate) and quota headroom (remaining percentage). It mathematically pre-ranks accounts, heavily penalizing those under 30% quota, and selects the absolute best account to fulfill the request. This eliminates wasted rate-limited requests entirely.
- Zenith is now the default routing strategy.

# v0.5.69 (2026-06-29) — Zenith RAM Layer: Sub-5ms Failover Routing

Architectural milestone: k‍Router now uses an in-memory `HealthCache` for provider connections, completely eliminating SQLite reads/writes from the hot path during chat routing.

- **Before:** When an account hit a 429, k‍Router did a synchronous SQLite write to lock it, then the `while (true)` loop did another synchronous SQLite read to find the next account. If 5 accounts were dead, the loop hit the disk 10 times, adding ~50ms of overhead per failure and visibly stalling the IDE.
- **After:** All active connections and their locks are cached in RAM. When a 429 hits, the router instantly locks the account in memory and grabs the next one in < 1ms. The SQLite write is fired asynchronously in the background.

This brings the core speed benefit of Zenith's pure-function routing engine into k‍Router without losing our provider coverage or MITM features.

# v0.5.74 (2026-06-29) — Fix Kiro MITM passthrough + tool ID sanitization + global MITM anti-loop

Three fixes bundled from a full Kiro IDE debug pass.

1. **REQUEST_BODY_INVALID from Kiro IDE via MITM:** Removed Kiro from `NATIVE_PAIRS`. When MITM is active, Kiro IDE traffic flows: IDE → MITM (converts AWS → OpenAI) → k‍Router → openai-to-kiro translator → Kiro API. Passthrough was skipping the translator and sending OpenAI-format bodies directly to Kiro's AWS API, which rejected them.

2. **codeWhispererToMessages produced 0 messages:** k‍Router's own outbound Kiro requests were being intercepted by its own MITM proxy because child executors (Kiro, GitHub, C‍ursor) overrode `buildHeaders()` without including `x-request-source: local`. Now forced on ALL executors in `BaseExecutor.execute()` after `buildHeaders()` returns.

3. **String should match pattern '^[a-zA-Z0-9_-]+$':** Tool IDs from other providers (Gemini dots/colons, OpenAI slashes) passed through `openai-to-kiro.js` unsanitized into `toolUseId` fields. Kiro routes through Claude backends which enforce Anthropic's regex. Added `sanitizeToolId()` to all 4 places where `toolUseId` is set in the Kiro translator.

# v0.5.73 (2026-06-29) — MITM HTTP/2 Session Auto-Retry
Fixes an issue where intermittent NGHTTP2_INTERNAL_ERROR drops (Google Cloud Load Balancer dropping stale multiplexed streams) caused the MITM proxy to fall back to HTTP/1.1, which Google's backend often rejects with a `socket hang up`. The proxy now immediately retries the request over a fresh HTTP/2 session before falling back to HTTP/1.1, eliminating the cascade of socket hang up errors.

# v0.5.72 (2026-06-28) — Fix Atomesus tool crashing backend

Fixed a bug where Atomesus API would return a 400 error (`"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set`) when clients sent tools in the request. Atomesus's inference server does not support tools by default. k‍Router now proactively strips `tools` and `tool_choice` from all requests bound for Atomesus, gracefully degrading them to plain text chat completions.

# v0.5.71 (2026-06-28) — Fix Atomesus alias resolution

Fixed a bug where requesting `atms/cipher` would fail with `No active credentials for provider: atms`. Added `atms` -> `atomesus` mapping to `ALIAS_TO_PROVIDER_ID` in `open-sse/services/model.js` so the router correctly matches the alias against saved `atomesus` API keys in the database.

# v0.5.66 (2026-06-27) — Fix Atomesus Connection Testing

Fixed a bug introduced in 0.5.65 where Atomesus API keys would fail connection tests with "Provider test not supported". Added the correct test utility routing so the dashboard can validate keys via the `/v1/models` endpoint. Also added `atomesus` to the core provider router list.

# v0.5.65 (2026-06-27) — Add Atomesus Provider

Added Atomesus (api.atomesus.com) as a supported free-tier API Key provider.
- Added `atomesus` (`atms`) to the provider configuration.
- Routes to OpenAI-compatible `/v1/chat/completions`.
- Automatically fetches available models (including `cipher`) via `/v1/models`.
- Includes custom dark theme logo for the dashboard UI.

# v0.5.69 (2026-06-28) — Stop TPM downgrade from re-classifying daily Antigravity exhaustion

User log audit showed two Antigravity accounts spamming the same 429 "Individual quota reached. Resets in 2h27m" error every 90 seconds. Root cause traced to 0.5.49 TPM disambiguation: the code re-classifies "quota reached" 429s as TPM when the cached daily-quota number says the account is healthy. But the quota cache lags behind reality, so real daily exhaustion got downgraded to a 90 s TPM cooldown, and the picker tried the dead account again 90 s later. Loop.

Two-part fix:

1. **Refuse the TPM downgrade when Google explicitly says "Resets in Nh"** or "Resets in N hour(s)/day(s)" - TPM windows reset in seconds-to-minutes, never hours. The new regex (`resets?\s+in\s+\d+h`) catches the exact wording Google ships. Real daily/weekly exhaustion now keeps its honest cooldown (capped at MAX_RATE_LIMIT_COOLDOWN_MS = 30 min) instead of getting reclassified to 90 s.
2. **Force-invalidate the cached daily quota for the account+model** when we detect an hours/days reset, so subsequent picks see fresh data and don't trip the same TPM trap on the next turn for a different model on the same account.

Net effect: the spammy "Resets in 2h27m" loop stops. Accounts that genuinely have only a TPM bottleneck still get their 90 s fast-path. The dashboard log goes back to being readable.

# v0.5.68 (2026-06-28) — Suppress false-positive MaxListeners warning

Raised `process.setMaxListeners` from 20 to 50 to accommodate the HTTP/2 connection pool added in 0.5.67. Each pooled `http2.connect()` session attaches internal SIGTERM/exit/beforeExit listeners to `process`. With 6+ Antigravity accounts and parallel IDE requests, 21+ sessions can be alive before the 30s idle timeout fires, triggering Node's `MaxListenersExceededWarning`. Not a real memory leak — sessions are cleaned up on idle/error/GOAWAY. The warning is now silenced.

# v0.5.66 (2026-06-28) — Fix Claude CLI Bash safety classifier (gpt-5.5) + CLI Tools connection status

Two bug fixes based on user problem reports:

1. **Claude CLI Bash Safety Classifier Fix (OpenAI/Codex `gpt-5.5`):** Claude CLI makes a safety pre-check before running Bash commands, requesting `max_tokens: 1` to get a single YES/NO token. Recent OpenAI/Codex backend updates strictly reject `max_tokens < 16` with an HTTP 400 error. Claude CLI misinterpreted this 400 as `cx/gpt-5.5 is temporarily unavailable, so auto mode cannot determine the safety of Bash right now.`. k‍Router now enforces a hard floor of `max_tokens: 16` for all OpenAI formats to pass upstream validation.
2. **CLI Tools Connection Status UI Fix:** Fixed a bug where the CLI Tools index cards on the dashboard always showed `Not configured` even when the tool was fully connected. The settings API routes (`claude`, `cowork`, `jcode`) were computing `hasK‍Router` correctly but omitting it from the JSON response.

# v0.5.65 (2026-06-28) — Kiro IDE first-class support + Caveman/Ponytail mutex

Four bundled fixes from a full kRouter debug pass.

A. Kiro native passthrough. Added `"kiro": ["kiro"]` to `NATIVE_PAIRS` and a Kiro IDE detection branch in `detectClientTool()` matching `user-agent: kiro`, `x-amzn-codewhisperer-source: kiro`, `x-amz-target: AmazonCodeWhispererService.*`, and request-body shape (`conversationState`/`userInputMessage` presence). When Kiro IDE talks to the Kiro provider through MITM, the body is now forwarded byte-perfect — AWS Bedrock prompt caching survives and we skip the 500-line openai-to-kiro translator entirely. Verified: `detectClientTool({user-agent: 'kiro/1.0'}) === 'kiro'` and `isNativePassthrough('kiro', 'kiro') === true`.

B. Kiro persona-injection slot. `systemInject.js` and `caveman.js` previously fell through to OpenAI shape for Kiro — meaning persona prompts silently no-oped on Kiro requests. Added an explicit Kiro case that prepends the persona to `body.conversationState.currentMessage.userInputMessage.content` (Kiro's translator normalises system role into user content, so there is no separate system slot). Verified live: persona text now appears at the start of the Kiro request body.

B(UI). Dashboard mutex. `EndpointPageClient.js`: turning Caveman on now auto-toggles Ponytail off and vice versa, both in React state and in the persisted setting. Users can pick one persona; choice is honoured for every subsequent request.

C. Runtime guard against double persona injection. `chatCore.js` previously claimed Caveman and Ponytail "compose because they target different aspects". They don't — both prompts declare "ACTIVE EVERY RESPONSE" and contradict on tone (caveman = terse fragments; ponytail = lazy-dev ladder with 3-line output template). Gemini in particular went schizo. Now: if a legacy settings row still has both enabled, prefer Ponytail and log a `[PERSONA] Caveman + Ponytail both enabled — skipping Caveman` warning so the user sees it and can fix on the dashboard.

D. Demoted `[Claude Usage] OAuth endpoint returned 403` from `warn` to opt-in debug. Anthropic deprecated the OAuth usage endpoint for some account tiers; the legacy fallback in `getClaudeUsageLegacy()` always works. The warning was firing every 30 seconds against a perfectly healthy dashboard.

# v0.5.64 (2026-06-27) — Remove notify-krouter-web workflow

The notify-krouter-web workflow (added in 5cc370f) pinged the krouter-web marketing site whenever providers / CHANGELOG / package.json changed. That repo isn't being used, so the workflow has just been failing with 404 on every push. Removed.

# v0.5.63 (2026-06-27) — Sanitize tool_use IDs on Claude passthrough (Google-to-Claude cross-IDE fix)

User reported that switching IDEs mid-conversation between Google (Antigravity / Gemini) and Claude was failing. Root cause traced in logs: Anthropic returns `400 invalid_request_error` on `messages.N.content.M.tool_use.id` because Google emits tool_call IDs containing dots/colons/slashes, which violate Claude's required pattern `^[a-zA-Z0-9_-]+$`. The general translator path already calls `ensureToolCallIds()`, but the Claude direct passthrough path (and the cache-preserve branch) skipped it entirely — so a conversation that lived part of its life in Gemini and then continued via Claude direct would get rejected.

Now: before sending to any Claude-shape upstream, we scan the body with a lightweight `bodyHasInvalidToolIds()` predicate. If clean (the common case for Claude-only conversations), nothing mutates and the byte-perfect prompt cache survives. If a Gemini-style ID is detected, we invoke the existing `ensureToolCallIds()` sanitizer once and forward the safe body.

# v0.5.62 (2026-06-26) — Documentation update: License & Branding

Documentation-only release. No code changes.
- README: Removed upstream credit badge from the very first line (moved to attribution section below).
- LICENSE: Changed copyright header to strictly "K‍odelyth AI Infrastructure" (with full attribution details at the bottom).

# v0.5.61 (2026-06-26) — Docker deployment parity: sifxprime/k‍router

Configured GitHub Actions workflow to publish Docker container images to `sifxprime/k‍router` on Docker Hub (and `ghcr.io/sifxprime/k‍router` on GitHub Container Registry) instead of the old upstream decolua image. Updated README and DOCKER.md with official container execution commands using `sifxprime/k‍router:latest` and `~/.k‍router` data binding.

# v0.5.59 (2026-06-26) — Documentation update: NPM Install & Uninstall

Documentation-only release. No code changes. README `Quick Start` section rewritten to prioritize NPM installation (`npm i -g @sifxprime/k‍router`) as the primary method for users, moving the Git clone instructions to an "Option 2 (For Development)" section. Added explicit upgrade and uninstallation commands, including how to clean up the `~/.k‍router/` directory.

# v0.5.58 (2026-06-25) — Documentation + LICENSE attribution refresh

Documentation-only release. No code changes. README adds a head-to-head comparison table (kRouter vs upstream 9router vs OmniRoute) and explicit "forked from" attribution. LICENSE updated to dual-copyright the fork (Kodelyth AI Infrastructure / Shofiqul Islam) alongside the upstream copyright (decolua and 9router contributors). CHANGELOG backfilled for the 0.5.35 → 0.5.57 rapid-iteration window with one-line summaries.

# v0.5.57 (2026-06-25) — Preserve thinking intent across the Antigravity blacklist

Kiro IDE through MITM (and other clients sending Claude/OpenAI-shape `thinking` config) were getting plain answers with no reasoning because the antigravity executor blacklist stripped `thinking`, `reasoning_effort`, `thinkingConfig`, etc. without translating them first. Now extracts Claude `{thinking.type=enabled, budget_tokens}` and OpenAI `reasoning_effort` BEFORE the strip and maps to Gemini-native `generationConfig.thinkingConfig`. Verified live: `reasoning_tokens` for gemini-pro-agent went 0 → 237 in end-to-end test.

# v0.5.56 (2026-06-25) — Honest "Exhausted • awaiting reset" quota display

Google's `fetchAvailableModels` omits `remainingFraction` entirely for quota-exhausted Claude models on the free Antigravity tier (3-day window). Our `|| 0` fallback painted these as fake 100%-used red bars. Now distinguishes "0% remaining" from "no number, only resetTime" and renders an amber `Exhausted • awaiting reset in X` bar in that case. UI matches what the official Antigravity desktop shows.

# v0.5.55 (2026-06-25) — Revert: x-request-source scrub broke our own MITM

Reverts the 0.5.47 addition of `x-request-source` to the antigravity header scrub list. Misdiagnosis — Google ignores unknown headers, but `src/mitm/server.js` uses `x-request-source: local` as the INTERNAL_REQUEST_HEADER anti-loop marker. Stripping it caused our outbound HTTPS to cloudcode-pa.googleapis.com to re-enter the MITM intercept and abort with `NGHTTP2_INTERNAL_ERROR` / `socket hang up`.

# v0.5.54 (2026-06-25) — Auto-backfill historical Antigravity tokens on startup

Replaces the manual `krouter backfill-tokens` subcommand with a silent one-shot run inside `initializeApp()`. Walks any `requestDetails` rows where `tokens.prompt_tokens=0` but `providerResponse.response.usageMetadata` carries the real Gemini-shape numbers, lifts them into the top-level `tokens` field. Idempotent on subsequent runs. Users no longer need to know the CLI subcommand exists.

# v0.5.53 (2026-06-25) — Fix backfill SQL quoting

0.5.52's backfill inlined `sqlite3 db UPDATE … data='<JSON>'` per row; embedded curly braces and quotes broke shell quoting so SQLite silently rejected every UPDATE. Now emits all UPDATEs to a temp SQL script and pipes through `sqlite3 db <script` inside a single BEGIN/COMMIT transaction. SQLite parses each statement itself so JSON survives.

# v0.5.52 (2026-06-25) — `krouter backfill-tokens` CLI + log de-noise

Two cleanups bundled. (1) New `krouter backfill-tokens` subcommand rewrites historical 0/0 Antigravity rows that the pre-0.5.51 extractor missed. (2) Demoted two of three token-refresh log lines from info → debug — each refresh used to emit a triplet (`[TOKEN] X refreshed`, `[TOKEN_REFRESH] Credentials updated`, `[TOKEN] X | refreshed`) and now just emits the third (most useful) one.

# v0.5.51 (2026-06-25) — Extract Antigravity's wrapped `usageMetadata`

Antigravity wraps the Gemini response in `{response: {...usageMetadata}}`, so the top-level usageMetadata check in `extractUsageFromResponse` missed it and every Antigravity row landed in DB with `tokens.prompt_tokens=0` even when Google billed thousands. Added a second branch that lifts `response.response.usageMetadata` when present. Verified live: 137 historical rows backfilled to non-zero token counts.

# v0.5.50 (2026-06-25) — Antigravity models fetcher needs `{project}` + headers

The 0.5.45 fix pointed the models endpoint at `cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels` but sent `body: {}` with bare `Content-Type`, producing a flood of `403 PERMISSION_DENIED` HTML pages in the console. Now uses a customResolver that supplies the project ID, the User-Agent / X-Client-Name / X-Client-Version headers the real binary sends, and normalises the `{quotas: {modelId: …}}` response shape.

# v0.5.49 (2026-06-25) — TPM rate-limit vs daily-quota disambiguation

Google's chat endpoint returns the same 429 body (`"Individual quota reached"`) for daily-quota exhaustion AND per-minute TPM throttling. Was applying a 30-minute cooldown to both. Now checks the cached daily quota when a 429 fires: if daily quota is healthy (>10% remaining), reclassifies as TPM (90-second cooldown, account-lock false, lastError reads "TPM rate-limited"). Accounts hit by transient TPM bursts come back in 90s instead of being parked for half an hour.

# v0.5.48 (2026-06-25) — Lazy-clear stale `unavailable` testStatus on read

`clearAccountError` only cleaned expired locks when a request *succeeded* on an account. Idle accounts with all per-model locks expired sat with stale `testStatus: "unavailable"` and 6-hour-old `lastError` text. Now `GET /api/providers` computes an effective `testStatus` on read: if every `modelLock_*` has expired and `isPermanentlyBanned` is false, upgrade `unavailable` → `active` and drop the stale lastError. Dashboard matches reality.

# v0.5.47 (2026-06-25) — Wire `permanent` ban flag through to UI

0.5.46 added `permanent: true` to error rules but nothing read it. Wired through `checkFallbackError → markAccountUnavailable → DB`: permanent bans now set `testStatus: "banned"`, persist `isPermanentlyBanned: true` + `bannedAt: <ISO>`, and Test Connection clears these flags when the account is verifiably alive again. (Also temporarily added `x-request-source` to scrub list — reverted in 0.5.55 after MITM regression.)

# v0.5.46 (2026-06-25) — Root-cause fix for "Verify your account" cascade

Diagnosed in March 2026 on the decolua/9router upstream issue #270, never patched until now. `open-sse/services/antigravityProjectBootstrap.js` was sending STRING enums (`ideType:"VSCODE", pluginType:"GEMINI"`) in loadCodeAssist metadata, while the OAuth flow correctly sends NUMERIC enums (`ideType:9, pluginType:2`). Google's anti-abuse correlates token-vs-bootstrap mismatch and flags the account on its very first call. Bootstrap now uses `getOAuthClientMetadata()` for byte-exact parity. Also ports OmniRoute's permanent-ban classifier: `verify your account` and similar texts now lock the account for 24h with `permanent: true`.

# v0.5.45 (2026-06-25) — Antigravity model-list endpoint + log truncation

The dead `daily-cloudcode-pa.sandbox.googleapis.com/v1internal:models` URL returned a 5KB HTML 404 page on every dashboard load, dumped raw into the console. Switched to the production endpoint already used by `usage.js`. Also truncates upstream error bodies to 200 chars before logging so future 4xx pages don't flood logs.

# v0.5.44 (2026-06-25) — Test Connection actually clears the account-wide lock

When a user clicked Test Connection after verifying at Google's URL, kRouter cleared `testStatus` and `lastError` but **not** `modelLock___all`. The picker kept skipping the account for the rest of the 1h cooldown. Now Test Connection success clears every `modelLock_*` field, resets `backoffLevel` to 0, drops `rateLimitedUntil`, and clears `isPermanentlyBanned` so the account truly comes back into rotation.

# v0.5.43 (2026-06-25) — Stop ZWJ obfuscator from corrupting base64 image data

`obfuscateBodyStrings` walked every string in the request body and injected zero-width joiners into matches of "claude", "cursor", "kodelyth", etc. — to dodge Google's log-grep based fingerprinting. Problem: base64 image data is essentially random text that statistically *will* contain those byte sequences. ZWJ injection inside `inline_data.data` corrupted the base64, causing Google to 400 with `Base64 decoding failed`. Now skips known binary-data field names (`data`, `inline_data`, `bytes`, `b64_json`, etc.) and any string that looks like a `data:image/...;base64,...` URL.

# v0.5.42 (2026-06-24) — Per-provider concurrency + adaptive semaphore timeout

Bumped Kiro 2→4, Claude 3→5 concurrent slots per account. Per-provider semaphore timeouts replace the flat 5s (Kiro 20s, Claude/Codex 15s, Antigravity 5s). Block-on-busy duration scales with timeout. A "hello" prompt with IDE Autopilot used to spend 25s of 503 "busy" loops before the in-flight 28s Kiro requests cleared — now under 5s.

# v0.5.41 (2026-06-24) — Combo fast-path + clearer account-lock logs

Three fixes: (1) Semaphore timeout 30s → 5s. (2) Semaphore timeout now marks the account briefly blocked in memory and returns 503 (not 429) so the combo picker skips it instead of re-selecting. (3) The picker's diagnostic log now writes `ACCOUNT-LOCKED until <time>` when `modelLock___all` is active (previously always said `modelLocked(<one model>)`, misleading).

# v0.5.40 (2026-06-24) — Stage the missing OmniRoute parity files

0.5.37–0.5.39 amended the commit metadata but never staged the actual new files (accountSemaphore, apiKeyRotator, emergencyFallback, modelFamilyFallback, sessionManager, fingerprintRotator, intentClassifier, taskAwareRouter, toolLimitDetector, plus 11 unit-test files). 0.5.40 contains all 30+ files for real.

# v0.5.37 (2026-06-24) — OmniRoute parity port — Fallback / Session / Tooling / MITM

Major port from diegosouzapw/OmniRoute v3.8+. Account semaphore (concurrency cap per account). Emergency fallback on 402 → free model. Model family fallback (try sibling on 404). API key rotator. Session manager (deterministic SHA-256 session IDs). Fingerprint rotator. Header scrubber. ZWJ obfuscation. Tool limit detector (auto-strip non-essential tools on 400). Stream recovery (NGHTTP2 → HTTP/1.1 fallback). Circuit breaker.

# v0.5.36 (2026-06-24) — Model deprecation auto-upgrade + format-specific param strip

Ports modelDeprecation from OmniRoute: auto-upgrades retired/renamed models (e.g. `gemini-1.5-flash` → `gemini-2.5-flash`). Ports modelStrip: proactive + reactive stripping of unsupported parameters (drops `logprobs` for Groq/OSS, retries with `reasoning_budget` stripped if upstream complains).

# v0.5.35 (2026-06-23) — One-click Cache Control panic toggle in Profile

Adds an amber/cyan one-click toggle next to the existing Cache Control dropdown so users hitting fresh-turn 429s can flip between `auto` (cache-preserve) and `never` (RTK trims) without navigating the dropdown twice. Cyan = armed/preserve; amber = legacy trimming.

# v0.5.34 (2026-06-23) — Hotfix: Claude direct cache preservation

Fixes an issue where C‍laude Code (the CLI) would receive `429 Rate Limit` errors on Anthropic Tier 1 accounts despite having sufficient credits.

- **Bug:** `normalizeClaudePassthrough` was hoisting C‍laude Code's mid-conversation `role: "system"` messages to the top level. While semantically identical, this changed the JSON byte sequence, busting Anthropic's prompt cache. A 50k token prompt missing the cache immediately hits the 40k TPM limit on Tier 1.
- **Fix:** `cacheControlMode="auto"` (and `"always"`) now strictly skips the normalizer and tool deduper. The outbound JSON body is now 100% byte-identical to the CLI's payload, allowing Anthropic's cache to hit and bypassing TPM rate limits on continuation turns.

# v0.5.33 (2026-06-23) — cacheControlMode toggle + quota freshness tracking

User-visible: dashboard now exposes a Cache Control toggle (auto/always/never) that controls whether kRouter mutates `cache_control` markers on Claude-shape requests. Quota usage endpoint now reports cache freshness so the dashboard can show "last checked Xs ago" without a second round-trip, and a manual refresh endpoint forces a fresh upstream fetch on demand.

## Cache Control mode toggle (Tier 3.A)
- New setting `cacheControlMode` with three values:
  - **`auto`** (default, preserves 0.5.32 behavior): skip `cache_control` mutations only on Claude direct passthrough (`clientTool==="claude" && provider==="claude"`).
  - **`always`**: paranoid mode — skip mutations on any Claude-shape target including `anthropic-compatible-*` resellers and the explicit translator path (threaded via `prepareClaudeRequest(preserveCacheControl=true)`).
  - **`never`**: legacy escape hatch (pre-0.5.32 strip-and-rewrite behavior).
- New Cache Control card on `/dashboard/profile` with a `<select>` and live mode-aware explainer text.
- Live-verified: dev log fires `[CACHE] mode=auto | token savers SKIPPED...` and `[CACHE] mode=always | token savers SKIPPED...` on real Claude traffic; `never` correctly suppresses the skip.

## Quota tracker hardening (Tier 3.C)
- `quotaPreflight` gains four new APIs:
  - `getQuotaCacheInfo(provider, connId)` → freshness info (`hasData`, `isFresh`, `isStale`, `lastCheckedAt`, `lastCheckedAgoSec`, `modelCount`)
  - `forceRefreshQuota(provider, connId, connection)` → drop cache + inFlight, refetch upstream
  - `recordQuotaCacheHit(provider, connId)` → tracks last-used for background daemon
  - `startBackgroundQuotaRefresh(connectionsProvider)` → 60s daemon that only refreshes accounts whose hot-path read was within the last 30 min
- `GET /api/usage/[connectionId]` now returns `_cacheInfo` with the freshness fields (backward-compatible — added field, nothing removed).
- `POST /api/usage/[connectionId]` is new — manual refresh endpoint that token-refreshes if OAuth, force-refreshes quota cache, returns `{ ...usage, _cacheInfo, _refreshed: true }`.
- `sse/services/auth.js` records a cache hit after every successful account pick, so the daemon's "recently used" detection mirrors real production usage.
- Daemon ticks confirmed live in isolated node process; in-app firing is timer-driven and survives HMR.

## Test counts
- Pre-release baseline: 983 passing / 20 expected-fail / 21 skipped
- Post-release: **999 passing** / 20 expected-fail / 21 skipped (1040 total)
- +16 new tests across 2 new test files: `cache-control-mode.test.js`, `quota-tracker-hardening.test.js`
- Zero regressions

## Intentionally NOT in this release
- TaskAwareRouter wiring (Tier 3.B) — deferred at user request, same rationale as the skipped Tier 2.B combo intelligence wiring in 0.5.32. Existing routing is working and the user opted to leave it untouched.

---

# v0.5.32 (2026-06-23) — Claude Desktop token-burn fix + reliability hardening

User-visible: long Claude Desktop / Claude Code sessions routed through kRouter MITM no longer pay 3-10x token cost vs running Claude direct. Anthropic's per-API-key prompt cache now stays warm across continuation turns.

## Cache preservation in Claude direct passthrough (Tier 1)
- **Skip token-saver mutations for Claude direct passthrough.** When `clientTool === "claude" && provider === "claude"` and the request is in passthrough mode, kRouter no longer runs RTK / Caveman / Ponytail on the outbound body. Any byte change to system / tools / messages prefix busts Anthropic's prompt cache key; for a 50-turn Claude Desktop session that was 50 cache misses × 10× tokens on the cached prefix. Now the outbound body is byte-identical to what Claude Desktop sent and Anthropic's cache hits on every continuation turn.
- **Session-sticky account binding.** `getSessionConnection()` infrastructure existed in `sessionManager.js` but was never called. Wired it: every chat request derives a `conversationFingerprint` (model + system + tools + first user message + provider, **without** connectionId) and resolves it to a sticky account via `getStickyConnection()`. Auth picker honours the binding via `preferredConnectionId`. On a successful turn we re-bind the fingerprint to the working account. Failed binding falls through to normal strategy (option a — drop stickiness rather than wait for recovery). For users with `stickyRoundRobinLimit:1`, this stops every-other-turn cache misses from per-key cache rotation.
- **`preserveCacheControl` flag on `prepareClaudeRequest`** (port of OmniRoute's same-named flag). 4th param, default false. When true, skips all cache_control strip-and-rewrite passes on system blocks, message content, and last-assistant injection. Future translation paths (e.g. `anthropic-compatible-cc-*` resellers) can flip this on without touching chatCore.

Live-verified end-to-end on real Anthropic traffic — 3 successful Claude direct turns through the same conversation fingerprint, all routed to the same account, `[AUTH] claude | pinned to <conn>` log line confirms sticky resolution on turn 3+.

## Reactive 400-retry hardening (Tier 2.A + 2.C)
- **`findOffendingField` word-boundary regex** (already shipped in 0.5.31 commit d20703c, included here). Catches bare-name 400 bodies that the previous quoted-only matcher missed: Groq (`Unknown parameter: logprobs`), OpenRouter (`unrecognized field reasoning_content`), Anthropic (`Field \"presence_penalty\" invalid`). Without this, the reactive self-heal silently never fired on the most common upstream error shapes.
- **Verified the full retry chain end-to-end.** Six integration tests run the real `DefaultExecutor.execute()` flow with `proxyAwareFetch` mocked at the network boundary: 400 → `findOffendingField` matches → `delete sourceBody[offendingField]` → real `transformRequest` → real retry fetch → 200 returned. Tests confirm other body fields (temperature, messages, max_tokens) survive intact, unknown field names skip the retry (allowlist gating works), plain 400s with no field name don't retry, and a retry that ALSO 400s doesn't infinite-loop.

## Dashboard console-log noise filter
- The in-memory buffer that powers `/dashboard/console-log` was capturing every Next.js HTTP access line (`GET /api/version 200 in Xms`, `GET /api/settings ...`, `GET /manifest.webmanifest`, even the SSE stream that delivers the logs back to the UI). The dashboard's own polling flooded the buffer at ~1-2 req/sec and evicted real chat / auth / error traces via the maxLines cap. New `isAccessLogNoise()` filter drops the framework's specific access-log shape only when the path matches a known polling endpoint and the status is 2xx/3xx. Preserves everything that matters: any 4xx/5xx, all `[LEVEL]` tagged lines, POST/DELETE/PUT requests, Next.js startup banner, unknown future routes. Original stdout to the terminal is unchanged — only the dashboard buffer is filtered.

## Test counts
- Pre-release baseline: 947 passing / 20 expected-fail / 21 skipped (988 total)
- Post-release: 983 passing / 20 expected-fail / 21 skipped (1024 total)
- +36 new tests across 3 new test files: `cache-stickiness.test.js`, `console-log-filter.test.js`, `model-strip-reactive-retry.test.js`
- Zero regressions

## Intentionally NOT in this release
- Combo intelligence wiring (Tier 2.B) — deferred. The wiring would have `intentClassifier` + `complexityRouter` outputs change combo slot selection per request. User chose to skip rather than risk disrupting working combo behavior.
- Claude Code obfuscation stack (8 files in OmniRoute) — only worth porting if direct Anthropic accounts start getting throttled or you sign up for `anthropic-compatible-cc-*` reseller endpoints. Today's traffic routes through Claude direct (passthrough) and Antigravity (already obfuscated).
- Full compression framework port (29 files in OmniRoute) — existing RTK works. Marginal gain not worth the 20-40 hour port cost.

---

# v0.5.14 (2026-06-21) — Combo fallback speed + MITM stability + Auth loop fixes

Four major fixes addressing live user reports. Combos are now up to 15x
faster when hitting exhausted accounts, MITM restart loops are eliminated,
and live-fetch models correctly surface for free providers.

## Performance
- **Fast-fail combo routing for dead accounts (<1s vs 25s)**. Combos hitting
  multiple exhausted accounts (e.g. 403 "Verify your account" or 429 quota
  with long reset times) used to take 25+ seconds to fail over to a healthy
  provider due to pointless token refreshes and exponential backoff.
  - **Fix A (Token Refresh Skip):** `chatCore.js` now peeks at 403 bodies.
    If it sees "verify your account" / "permission_denied", it skips the
    OAuth token refresh entirely. Saves ~3s per dead account.
  - **Fix B (Pre-emptive 429 Parse):** `base.js` executor now checks the
    provider's `RetryInfo` *before* initiating exponential backoff. If the
    reset is >60s away, it skips the 14s retry loop and fails instantly.
    Saves ~14s per exhausted account.
  Result: A combo hitting 3 dead accounts now falls over to a healthy model
  in under 1 second. Applies to ALL providers and ALL combo strategies.

## Bug fixes
- **Infinite MITM restart loop eliminated.** Toggling MITM off/on could race
  with a queued background restart, causing an infinite loop of `Restart
  attempt 1/5 failed: MITM server is already running` every 5 seconds. Added
  a strict `!serverProcess.killed` guard to `scheduleMitmRestart()` to quietly
  drop stale restart requests.
- **Actionable 403 "Verify your account" dashboard links.** When Google flags
  an Antigravity account, kRouter now uses regex to extract the exact Google
  verification URL from the 403 body. The dashboard Connection card now
  displays `Verify your account: https://...` as a clickable link instead of
  raw truncated JSON.
- **Claude OAuth + Live Fetch Anti-Loop.** If Claude Desktop MITM was enabled,
  kRouter's own internal requests to `api.anthropic.com` (OAuth token exchange
  and provider model fetching) would hit its own MITM proxy and fail with
  `SELF_SIGNED_CERT_IN_CHAIN`. All internal OAuth and model fetches now pass
  the `x-request-source: local` header, bypassing the MITM intercept.
- **Live-fetch for free/passthrough providers (Issue 2).** Users with ONLY
  free providers (MiMo Free, OpenCode Free, OpenRouter, etc.) saw the "Select
  Model" modal open completely blank. `ModelSelectModal` now kicks off
  parallel background fetches to `/api/models/live` when opened, populating
  the dropdowns instantly. Includes 5-min LRU cache and inline retry buttons.

## Verified
- Full test suite: 605 pass / 20 expected-fail / 27 fail (baseline maintained)
- Combo fast-fail logic unit-tested against real provider error bodies
- MITM anti-loop tested live via Claude Desktop

# v0.5.13 (2026-06-20) — Linux GUI launcher coverage for MITM cert trust

## Bug fix

### Linux: NODE_EXTRA_CA_CERTS now reaches GUI-launched Antigravity / Claude Desktop / VS Code

Symptom (Ubuntu user, post-0.5.12):
  Even after kRouter auto-wrote NODE_EXTRA_CA_CERTS to ~/.profile,
  ~/.bashrc, ~/.zshrc in 0.5.12, GUI-launched Antigravity STILL rejected
  the MITM cert and forced the user to fall back to
    NODE_TLS_REJECT_UNAUTHORIZED=0 antigravity
  (which disables ALL TLS verification — insecure).

Root cause:
  Linux GUI launchers (GNOME Activities, KDE menu, .desktop files,
  desktop shortcuts) do NOT source shell rc files. They go through
  systemd-user / gnome-session, which only reads:
    - ~/.config/environment.d/*.conf  (systemd-user env)
    - ~/.pam_environment              (legacy PAM, deprecated but works)
    - /etc/environment                (system-wide, needs root)
  Our 0.5.12 fix only covered shell rc files → terminal-launched IDE
  worked, menu-launched IDE didn't.

Fix:
  Extended src/mitm/linuxNodeCaCerts.js to also write:
    ~/.config/environment.d/95-krouter.conf   (systemd-user, KEY=VALUE format)
    ~/.pam_environment                         (PAM, KEY DEFAULT=value format)
  in addition to the existing 4 shell rc files. 95- prefix sorts late
  so kRouter overrides earlier defaults (00-99 priority convention).
  PAM block uses BEGIN/END markers like the shell files so we can strip
  cleanly on uninstall without touching user-added PAM entries.

  src/mitm/manager.js log line updated to surface both reload paths:
    [linux-node-ca] Terminal-launched IDE: open a NEW terminal OR run: source ~/.profile
    [linux-node-ca] Menu-launched IDE (GNOME / KDE Activities, .desktop): log out + back in
                    OR run: systemctl --user daemon-reload && systemctl --user import-environment

Effect on Ubuntu user:
  Before 0.5.13: GUI Antigravity rejects MITM cert -> NODE_TLS_REJECT_UNAUTHORIZED=0 workaround
  After 0.5.13:  GUI Antigravity -> systemd-user reads 95-krouter.conf ->
                 NODE_EXTRA_CA_CERTS set -> cert accepted -> MITM works.

  User must log out + back in once (or systemctl --user reload) for
  systemd-user to re-read environment.d after the upgrade.

Verified (mocked-Linux unit tests, 17/17 PASS):
  - 5 files written on first set (.profile, .bashrc, .zshrc, environment.d, pam_environment)
  - systemd file has correct KEY=VALUE format (no shell export syntax)
  - pam_environment uses correct KEY DEFAULT=value syntax
  - Idempotent: second set with same path = 0 files changed
  - Rotation: new cert path replaces all 5 surfaces in place
  - Unset: all 5 surfaces cleaned, user content preserved in shell rc files
  - systemd file fully removed (we own it); pam_environment removed when empty
  - Non-Linux platforms: early return, no-op

Plus regression: 605 pass / 20 expected-fail / 27 fail — identical baseline.

## Upgrade

    npm install -g @sifxprime/krouter@latest
    # Restart kRouter MITM (writes new env files)
    # Log out + back in once for systemd-user to pick up environment.d

# v0.5.12 (2026-06-20) — Claude Desktop MITM + account health + Linux trust + cert UI

## Features

### Claude Desktop app routing via MITM (new)
Adds DNS-hijack + TLS interception for `api.anthropic.com` so the
Anthropic Claude Desktop Electron app — which hardcodes the URL and
does NOT honor ANTHROPIC_BASE_URL — can be routed through kRouter.

Verified live: Claude Desktop chat works through kRouter with
`kr/auto` → Kiro routing. Token preview (/v1/messages/count_tokens)
and telemetry (/api/event_logging/v2/batch) both handled correctly.

Opt-in via Dashboard → MITM → Claude Desktop. Toggle MITM off to
revert instantly (api.anthropic.com removed from /etc/hosts).

Note: Claude Code CLI users do NOT need this — use ANTHROPIC_BASE_URL.

### Cert Install/Uninstall buttons in dashboard (USER3)
Self-service root certificate management. Replaces hand-running
`security add-trusted-cert` / `update-ca-certificates` / `certutil -addstore`.

New card on Dashboard → MITM shows current cert state and three buttons:
  - **Install / Reinstall Certificate** — label changes with state
  - **Uninstall**
  - **Remove Legacy 9router Cert** — appears automatically when
    `~/.9router/mitm/rootCA.crt` is detected on disk

Inline sudo password input on Mac/Linux when not cached. Windows uses
existing UAC. Auto-refreshes status after every action.

Verified end-to-end on dev machine: full uninstall → keychain check →
reinstall → keychain check cycle in 6.1s with cached sudo.

## Bug fixes

### Linux: NODE_EXTRA_CA_CERTS auto-write in shell rc files (USER1 + USER4)
Ubuntu Antigravity (and any other Electron/Node IDE) was rejecting the
kRouter MITM cert with `x509: certificate signed by unknown authority`
even after `update-ca-certificates` ran. Root cause: Node.js + Electron
read their OWN bundled Mozilla CA store, not the OS trust store. macOS
and Windows had auto-`launchctl setenv` / `setx` for this since 0.5.6
— Linux was missing the branch entirely (helper had been removed in the
0.5.10 standalone cleanup).

Fix: new `src/mitm/linuxNodeCaCerts.js` writes a guarded BEGIN/END
block exporting `NODE_EXTRA_CA_CERTS=<cert path>` to `~/.profile`,
`~/.bashrc`, `~/.zshrc`, and `~/.bash_profile` (only existing ones,
plus always-create `.profile`). Idempotent — re-running with the same
path is no-op; new path replaces in place. Stripped cleanly on MITM
stop. Wired into the existing `IS_MAC` / `IS_WIN` start/stop branches
in `src/mitm/manager.js`.

After install, log surfaces a clear notice:
```
[linux-node-ca] NODE_EXTRA_CA_CERTS written to 3 shell rc file(s): ~/.profile, ~/.bashrc, ~/.zshrc
[linux-node-ca] ⚠ Effective in NEW shells only — restart your IDE
                (Antigravity / Claude Desktop / VS Code) OR run: source ~/.profile
```

Verified with 10/10 mocked-Linux unit tests covering idempotency,
existing-content preservation, in-place block replacement, and clean
unset.

### Free / passthroughModels providers count as active (USER2)
Users with ONLY free providers connected (MiMo Free, OpenCode Free,
OpenRouter, Vercel AI Gateway, Grok Web — all `passthroughModels: true`)
saw the "Select Model" button disabled on every IDE / CLI tool card
and the MITM panel. Root cause: `hasActiveProviders()` gate checked
three conditions (hardcoded models > 0, OpenAI-compatible, Anthropic-
compatible) — all three false for passthrough providers because their
models fetch live from a remote URL, not from the hardcoded MODELS map.

Fix: added 4th OR clause `AI_PROVIDERS[provider]?.passthroughModels === true`
in both `MitmPageClient.js` and `ToolDetailClient.js` so passthrough
connections register as active. 5 providers now correctly unlocked.

### Antigravity 403 "Verify your account" — lock whole account for 1hr
When Google flags an Antigravity OAuth account for needing verification
(PERMISSION_DENIED, "Verify your account to continue"), kRouter was
locking only the specific model that errored. Since a flagged account
fails on ALL models, this caused 5+ wasted 403 requests per combo
cycle before reaching a healthy account.

Fix: new `accountLock: true` flag on `ERROR_RULES`. When matched,
writes `modelLock___all` (locks entire account) instead of per-model
lock. 1hr cooldown. Auto-clears after 1hr or on "Test connection" click.
Log now shows `WHOLE ACCOUNT locked for 3600s` vs `modelLock_X`.

### Anti-loop header on ALL outbound Anthropic calls
Every kRouter-initiated call to `api.anthropic.com` now includes
`x-request-source: local` so the MITM server passes them through to
real Anthropic instead of intercepting (infinite loop prevention).
Previously only the Antigravity quota endpoints had this header. Fixed
in `open-sse/executors/base.js buildHeaders()` (covers all providers),
`claudeAutoPing.js sendPing()`, and 3 call sites in
`open-sse/services/usage.js`.

## Verified
- Claude Desktop MITM live on Mac — HTTP 200, 11.2s, routes via `kr/auto`
- USER2 fix: 5 passthroughModels providers verified, dashboard renders 200
- USER3 fix: full uninstall → keychain verify → reinstall → keychain verify
  cycle live on dev machine (6.1s with cached sudo)
- USER1 + USER4 fix: 10/10 mocked-Linux unit tests pass (idempotency,
  preservation, replacement, unset)
- 403 verify-account: 4/4 unit tests pass
- Full test suite: 605 pass + 20 expected-fail + 27 fail (baseline)

## Upgrade
```
npm install -g @sifxprime/krouter@latest
```
No data migration. Existing MITM cert, OAuth tokens, settings preserved.


# v0.5.11 (2026-06-20) — CLI menu reliability + final 9router scrub

Two real bug fixes + the last batch of standalone cleanups.

## Bug fixes

### CLI terminal-UI was reading the wrong field name
The 0.5.10 standalone cleanup renamed the API response field
`has9Router` → `hasKRouter` everywhere — but only on the WEB dashboard
side. `cli/src/cli/menus/cliTools.js` (the in-terminal `krouter` menu
that lets you configure Claude / Codex / OpenCode / etc. from the
prompt) still read `has9Router`, got undefined, and silently treated
every installed IDE as "not configured." Tooling-status checks in the
TUI were effectively broken since 0.5.10. Fixed.

### Arrow-key "move down sometimes doesn't work" on first menu
When you run `krouter`, the interface menu appears after ~2 seconds
(server warm-up). Impatient users press arrow keys during that wait.
The bytes sit in stdin's cooked-mode buffer. When raw mode engages and
the keypress listener attaches, those buffered bytes arrive as a flood
of half-parsed escape sequences — `\x1b[B` (down arrow) sometimes gets
fragmented across reads, so the first one or two presses register as
garbage instead of a `down` event. Now `selectMenu` calls `drainStdin()`
right after `primeRawOnce()`, discarding any pre-menu buffered bytes so
only keys pressed AFTER the menu is on screen drive selection. The
flake disappears.

## Standalone scrub (the rest)

### Stale 9router refs cleaned out of code paths still hit at runtime
  - `cli/src/cli/api/client.js` — last copy of the `~/.9router` →
    `~/.krouter` data-dir migration block. Removed.
  - `cli/src/cli/menus/cliTools.js` — `OR custom:9Router-0` model-id
    fallback + `?? providers["9router"]` dual-read + `(?:krouter|9router)`
    model-prefix regex. All tightened to `krouter` only.
  - `src/lib/mcp/stdioSseBridge.js` — global state key
    `__9routerMcpBridges` → `__krouterMcpBridges`; user-visible
    "truncated by 9router bridge" message → "by kRouter bridge"
  - `cli/scripts/build-cli.js` — build-script title + a stale comment
  - `cli/hooks/sqliteRuntime.js` — already cleaned in 0.5.10, verified

### package-lock.json regenerated
The `cli/package-lock.json` still listed `9router` as a bin entry from
when the package.json bin section was changed in 0.5.10. Regenerated.

### Comment cleanup (non-runtime)
About a dozen JSDoc + inline comments updated from "9router" to
"kRouter" across kiroConstants, kiroModels, sessionManager,
commandcode, openai-to-kiro, paramSupport, kiro MITM handler,
tailscale, copilot MITM. Zero behavioral impact.

## Intentional keeps (still grep "9router" if you look)

  - `Footer.js` + `README.md` upstream attribution (MIT license)
  - `MITM cert CN "9Router MITM Root CA"` (changing breaks existing
    user trust stores)
  - `ENCRYPT_SALT "9router-mitm-pwd"` (changing bricks saved sudo
    passwords)
  - `X-CLIENT-TYPE: 9router` / `grok-cli/9router` / `X-Msh-Platform:
    9router` HTTP headers (3rd-party APIs whitelist by name)
  - `claudeAutoPing.js` + `capabilities.js` port-source comments
    (factual provenance notes)
  - Linux trust-store: uninstall path still removes BOTH
    `9router-root-ca.crt` AND `krouter-root-ca.crt` so a
    pre-rebrand user's keychain stays clean

## Verified
  - 605 pass + 20 expected-fail + 27 fail (identical baseline, zero regressions)
  - node --check on every modified file passes
  - cli/package-lock.json bin section now `{"krouter": "cli.js"}` only

## Upgrade path for users on < 0.5.11

If `krouter` works but `9router` ALSO works (leftover shim):
```
npm uninstall -g @sifxprime/krouter
npm install -g @sifxprime/krouter@latest
```

# v0.5.10 (2026-06-20) — standalone: drop 9router legacy plumbing

Cleanup release. The fork has been on its own brand long enough that the
9router → krouter migration plumbing is now dead weight. This release
rips out every legacy compatibility path, dual-read, and migration
helper that hasn't fired in months.

What got dropped
  - `9router` bin alias from `cli/package.json` (only `krouter` works now)
  - `~/.9router → ~/.krouter` auto-migration in dataDir.js, paths.js,
    cli.js, appUpdater.js, updater.js, mitmAliasCache.js — single
    canonical APP_NAME, no LEGACY_* constants
  - Coexistence warning (added in 0.5.8 — moot now)
  - `NINE_ROUTER_*` env var dual-read + deprecation warning in
    outboundProxy.js — only `KROUTER_*` is recognized
  - 3 catalog entries for `NINE_ROUTER_*` from the Environment panel
  - "9router" provider key dual-read in 12 IDE settings routes:
    codex, jcode, opencode, openclaw, kilo, droid, copilot, cline,
    deepseek-tui, hermes, claude, cowork — only `krouter` keys read +
    written now
  - `LEGACY_PROVIDER_KEY` / `LEGACY_AUTH_KEY` / `LEGACY_ENV_FILE` /
    `LEGACY_CUSTOM_ID_PREFIX` / `LEGACY_API_KEY_ENV_VAR` constants and
    every site that referenced them
  - `has9Router` legacy API field in 12 IDE settings responses + 12 UI
    components that read it — single `hasKRouter` field everywhere
  - `com.9router.autostart` LaunchAgent / `9router.vbs` / `9router.desktop`
    legacy cleanup helpers in autostart.js — single-entry-per-platform
  - `9router` cmdline pattern in `killAllAppProcesses` (cli.js +
    appUpdater.js) — only matches `krouter`
  - `sk_9router` placeholder API key fallback → `sk_krouter`
  - Stale "9router-relay" Deno deployer label → "krouter-relay"
  - Stale `getLegacyProviderEnvPath()` helper in jcode-settings
  - Comment text mentioning legacy across cli/mitm/translator paths
  - Navigation.js upstream-credit links — redirected to sifxprime/krouter
    (Footer attribution kept — MIT license requirement)

What was intentionally kept
  - Landing Footer attribution to decolua/9router (MIT license)
  - README upstream attribution badges + "hardened fork of 9Router" text
  - 9Router MITM Root CA common name (changing CN would invalidate every
    existing user's installed MITM cert and force them to re-trust)
  - 9router-mitm-pwd encryption salt (used to derive the cert-store
    password key — changing it would brick saved sudo passwords)
  - X-CLIENT-TYPE / X-Msh-Platform / grok-cli/9router HTTP headers
    (third-party APIs whitelist by name)
  - Linux trust-store cert filename uninstall path keeps removing both
    `9router-root-ca.crt` and `krouter-root-ca.crt`

Upgrade impact
  Existing kRouter installs: zero. Anyone running 0.5.7+ has long since
  converged to `~/.krouter` and writes only canonical config keys.
  Users still on the upstream `9router` package who never installed
  kRouter: they need to manually rename `~/.9router` → `~/.krouter`
  before first launch. Anyone in that group is also clearly running
  a different product (upstream is a separate npm package).

Verified
  - node --check on every file in the diff (35+ files)
  - 605 pass + 20 expected-fail + 27 fail — identical baseline, zero
    regressions

# v0.5.9 (2026-06-19) — Windows EADDRINUSE crash-loop fix

Single-purpose patch release. Symptom reported on Windows after upgrading
to 0.5.8:

```
⨯ Failed to start server
Error: listen EADDRINUSE: address already in use 0.0.0.0:20128
⚠️  Server exited (code=1). Restarting in 1s... (1/2)
[repeated forever]
```

Two real bugs surfaced by the upgrade:

1. **`killProcessOnPort` only killed the first PID from `netstat`.** Windows
   Next.js spawns a parent + child pair (the dev runner + the actual
   `next-server`); on graceful shutdown only the parent dies and the child
   inherits the listen socket. Killing just the first PID left the child
   still bound to the port. Now sweeps ALL PIDs returned by `netstat`
   (Windows) / `lsof -ti` (macOS/Linux), uses `taskkill /F /T` to kill the
   whole process tree on Windows, and waits 1s on Windows (vs 500ms
   elsewhere) for the kernel to release the socket.

2. **The restart loop didn't re-kill on EADDRINUSE.** When the first start
   failed because a stale process held the port, `tryRestart` just respawned
   blindly into the same conflict — forever. New EADDRINUSE-aware recovery
   path detects "address already in use" in the captured crash log, runs
   `killAllAppProcesses` + `killProcessOnPort` AGAIN, then probes the port
   with a one-shot `net.createServer` before respawning. If the port is
   still occupied after the cleanup, exits with an actionable error:

   ```
   ❌ Port 20128 is still occupied after attempted cleanup.
      Identify the holder (Windows: netstat -ano | findstr :20128;
      macOS/Linux: lsof -i:20128).
      Either stop that process, or run kRouter on a different port:
      krouter --port <N>
   ```

   No more infinite "Disabling MIT and restarting..." (which was the wrong
   recovery anyway — EADDRINUSE has nothing to do with MITM, which runs on
   port 26139).

Verified
  - node --check passes
  - Isolated unit test: spawn victim child holding port → run kill logic →
    probe → port free → PROBE OK
  - Excludes own PID (won't suicide)

---

# v0.5.8 (2026-06-19) — security, brand polish, performance, upstream catch-up

25 commits since 0.5.7 — full audit pass with live end-to-end verification on the dev machine, zero test regressions throughout.

## Security
- **GHSA-6mwv-4mrm-5p3m — Kiro AWS region SSRF (HIGH).** Port of upstream `126aa24`. Seven `${region}` URL-interpolation sites in `src/lib/oauth/providers.js` and `src/lib/oauth/services/kiro.js` were unvalidated — a malicious value like `region="us-east-1.attacker.com#"` would have redirected the OAuth flow to an attacker host. New `assertValidAwsRegion()` helper with `/^[a-z]{2}-[a-z]+-\d{1,2}$/` allowlist now gates every interpolation. 12/12 attack vectors blocked in unit tests.
- **2 HIGH npm CVEs eliminated.** `undici` 7.0.0–7.27.2 (TLS cert validation bypass in SOCKS5 ProxyAgent + cache disclosure) → 7.28.0; `http-proxy-middleware` 3.0.4–3.0.6 (CRLF injection in `fixRequestBody`) → 3.0.7. Both already in MITM/proxy paths. Only 2 moderate `postcss` advisories remain (transitive via Next 16, fix would be a breaking Next downgrade — left).

## Performance — Anthropic + Antigravity rate-limit storms
- **Claude Usage per-token 3-min cooldown + stale-while-revalidate cache** (`open-sse/services/usage.js`). The Quota Tracker page auto-refreshes every 60s × N connections. Anthropic rate-limits per IP — once any Claude account 429'd, every subsequent call from the same IP also 429'd, blanking the entire Claude card. Now on any 429, that token sits in 3-min cooldown returning cached-good data (slightly stale, real numbers) instead of placeholder. **17× quieter** against Anthropic during cooldown windows. Also skip the legacy admin-only fallback when status is 429 (saves 2 wasted calls per rate-limit event). Cooldown latency dropped 400ms → 6ms (pure-memory, no I/O).
- **Antigravity retry-storm fix** (`open-sse/executors/antigravity.js`). 429 RESOURCE_EXHAUSTED with a 73-min reset was triggering 14-28s of pointless 2-4-8s auto-retries per URL × multiple combo models → up to 4 min per request on big projects. Root causes: regex looked for `"reset after"` but Google sends `"Resets in"`; and we never parsed the canonical `error.details[].retryDelay` field (e.g. `"4406.752244244s"`). New `parseRetryFromErrorJson()` reads the machine-readable RetryInfo first; widened message-text regex covers current Google phrasing, beta Antigravity variant, token-bucket style, and bare durations. Combo now advances to the next model in the same instant.
- **`claudeAutoPing` skips disabled accounts.** When the OAuth-usage endpoint reports `extra_usage.disabled_reason` (e.g. `"out_of_credits"`, `"account_suspended"`), the scheduler stops trying for 1 hour and logs the reason once per state-change. Recovery (credits topped up, suspension lifted) is auto-detected within the next hour and logged. Saves wasted POSTs to `/v1/messages` that Anthropic would reject anyway.

## Bug fixes
- **Kiro MITM dropped images** (`src/mitm/handlers/kiro.js`). When users attached an image in Kiro IDE chat, the AWS-CodeWhisperer→OpenAI converter read `userInputMessage.content` and `userInputMessageContext.toolResults` but ignored `userInputMessage.images[]`. Every image silently disappeared before reaching the downstream model — which would then hallucinate about random files in the filesystem context to fill the gap. Now converts each `{ format, source.bytes }` entry to standard OpenAI `{ type:"image_url", image_url:{ url:"data:image/<mime>;base64,..." } }` content blocks. 8/8 unit test cases (text-only / image-only / text+N / tool+image combo / format normalization jpg→jpeg / malformed-skip / fallback to png).
- **Claude usage misleading "admin permissions" message.** The legacy fallback used to say "requires admin permissions" regardless of why the OAuth endpoint failed. Now branches on the OAuth status: 429 → "rate-limited", 401 → "rejected the access token — try reconnecting", 5xx → "upstream error", other → existing scoped message.
- **Perplexity `/v1/models` endpoint fix** (port of upstream `db4499d`). Perplexity deprecated `/models` (404); switched both test-connection and live-models routes to `/v1/models`.
- **claudeAutoPing dual-write consolidation.** The Providers detail page wrote `settings.claudeAutoPing.connections` from stale local state; the Usage page used safer fetch-then-patch. Toggling auto-ping on Page A then Page B could clobber A's update. Providers page now mirrors Usage's race-safe pattern.

## Features ported from upstream
- **Claude auto-ping** (`740093d`) — warms each Claude OAuth connection's 5h quota window by sending a 1-token "hi" the moment the window resets. Per-connection toggle (bolt icon) on Settings → Providers → Claude AND Dashboard → Usage. New `src/shared/services/claudeAutoPing.js` scheduler + `CLAUDE_AUTOPING_CONFIG` in `src/shared/constants/config.js` + UI integration on both surfaces.
- **Fusion combo strategy** (`87e5c1c`) — third combo strategy alongside fallback/round-robin. Fans the prompt out to all panel models in parallel, then a judge model synthesizes one final answer. Quorum-grace collection caps the straggler penalty (8s after `minPanel=2` succeed); 90s panel hard timeout; anonymized "Source N" labels prevent judge brand-bias; degrades gracefully (0 answers → 503, 1 answer → direct return, 2+ → judge synthesizes). Per-combo strategy `Select` replaces the round-robin toggle; fusion reveals a judge-model picker on the Combos page.
- **Custom vision models in selector** (`5e5e78d`) — user-added `imageToText` custom models now appear in the LLM picker with `capabilities: { vision: true }` instead of being filtered out.
- **Kiro thinking-effort budgets** (`2ff1124`) — Kiro requests with `reasoning_effort: "low"` get 1024 thinking tokens, "high" gets 24576 (was always 16000 default — caused visible CoT to leak into chat on low-effort tasks).
- **Antigravity Gemini schema** (`db9ec3a`) — strip `optional` field from tool schemas before sending to Gemini (Google rejects it).
- **claude-to-openai non-streaming** (`411a589`) — handle OpenAI-format responses from xiaomi-tokenplan -claude models on the non-streaming path; strip `reasoning_content` only when content is non-empty.
- **Image routing prefix collision** (`047fdc8`) — compatible nodes can no longer shadow built-in provider aliases like `cf/...`.
- **Antigravity output_config strip + Xiaomi always-OpenAI** (`3f9382d` partial) — strip Claude adaptive fields Google rejects; always use OpenAI `/chat/completions` for Xiaomi.

## New dashboard surface
- **Settings → Environment panel** (`/dashboard/environment`). 47 catalogued env vars in 8 categories (App, Security, Network/Proxy, MITM/Tunnel, OAuth, Observability, Updater, plus "Other" for uncatalogued `KROUTER_*`/`NINE_ROUTER_*`/`MITM_*`/etc. set in env). Live values shown, secrets masked (`INITIAL_PASSWORD` displays as `to••••••••23`), deprecated `NINE_ROUTER_*` flagged with amber badge, eye-icon to reveal, search + "only show set" filter. New `/api/settings/environment` endpoint, sidebar entry under System → Environment.

## Upgrade safety
- **`NODE_EXTRA_CA_CERTS` env-var migration + dangling autostart sweep** (`src/mitm/paths.js`, `cli/src/cli/tray/autostart.js`). For v0.5.6 → v0.5.7 upgraders who had MITM enabled, the system-wide env var still pointed at `~/.9router/mitm/rootCA.crt`. Every Node child process (including npm) saw the stale path. Now `migrateNodeExtraCaCerts()` updates the OS env var to the new cert path via `launchctl setenv` / `setx` immediately after the dir rename. Plus `sweepDanglingAutostartEntries()` on startup detects + removes LaunchAgent / .desktop / .vbs entries whose binary path no longer exists on disk (e.g. when the legacy `9router` global package was uninstalled).
- **Legacy `~/.9router/` coexistence warning** (`src/lib/dataDir.js`, `cli/cli.js`). Auto-migration only fires when the target is absent. Users who ran a pre-rename build mid-session then upgraded kept two parallel data dirs silently forever. Now warns once per process when both exist, gives exact merge/remove commands. Does NOT auto-delete (user data).
- **`KROUTER_*` env-var aliases with deprecation log** (`src/lib/network/outboundProxy.js`). Proxy env vars were still `NINE_ROUTER_PROXY_URL`/etc. only — users setting `KROUTER_PROXY_URL` were silently ignored. Now dual-reads (canonical preferred), dual-writes (existing IDE/shell hooks keep working), one-shot deprecation warning per process when only the legacy name is set.

## Brand polish
- **Hero CTA link** (`src/app/landing/components/HeroSection.js`) — "View on GitHub" above-the-fold pointed at `decolua/9router`; now `sifxprime/krouter`.
- **README install + quickstart blocks** — `~/.9router` → `~/.krouter`, `sk-9router-XXXX` → `sk-krouter-XXXX`, "Point AI tool at 9router" → "at kRouter"; OpenClaw config example updated to current `krouter` provider key + `sk_krouter` placeholder; env-var table defaults corrected. Upstream-Docker callout section kept unchanged (still correctly documents upstream's published image).
- **Tray icons regenerated as Kodelyth Mark.** `cli/src/cli/tray/icon.png` was stale 32×32 PNG from Jun 13, predating the brand mark — on Windows the tray showed a generic icon. Re-rendered from the exact Sidebar.js inline SVG (rounded-square tile with brand-500 → brand-700 gradient + white chevron forward + 25% ghost trail). `icon.ico` is now **multi-size 16+32+48** instead of single 32×32, so Windows tray renders crisp at every DPI scale. `public/favicon.svg` is now a standalone brand-500 chevron — browser tab matches the rebrand.
- **Update endpoint error string** (`src/app/api/version/update/route.js:7`) — `"9router CLI"` → `"kRouter CLI"`.
- 2 stale `9Router` refs in `cli/src/cli/tray/tray.ps1` + `cli/src/cli/tray/copilot.js` MITM handler + `src/app/globals.css` CSS comment + 2 stale `~/.9router/runtime` doc/log strings.

## LAN-safety polish
- **LAN-exposure warning** (`cli/cli.js`). On default `0.0.0.0` bind, prints a yellow startup line: `⚠ Network-exposed: reachable at http://<lan-ip>:<port> (bound 0.0.0.0). Use --host 127.0.0.1 for local-only.` Previously you had no signal the dashboard was reachable from your LAN. Port of upstream's `getLanIp` helper.

---

# v0.5.7 (2026-06-18) — kRouter rebrand: visible surfaces + safe migrations

Final rebrand pass turning every user-visible "9router/9Router" identifier into the canonical `krouter/kRouter` name, with one-time migrations on disk so existing v0.5.x installs upgrade cleanly with zero data loss and zero double-launch.

## Data directory rename with auto-migration
- `~/.9router/` → `~/.krouter/` (Windows: `%APPDATA%\9router\` → `%APPDATA%\krouter\`). Idempotent `fs.renameSync` runs on first launch only when the new dir doesn't exist and the legacy one does — wired into five separate entry points (`src/mitm/paths.js`, `src/lib/dataDir.js`, `cli/cli.js`, `cli/hooks/sqliteRuntime.js`, `cli/src/cli/api/client.js`) so any process startup path migrates.
- Linux MITM trust-store file renamed `9router-root-ca.crt` → `krouter-root-ca.crt`. Uninstall removes both.
- macOS keychain CN unchanged ("9Router MITM Root CA") — keychain trusts by CN not file path, so the cert moves with the data dir and HTTPS keeps working with zero re-trust prompts.

## CLI tools rename with dual-read backward compat
Every IDE config writer (OpenCode, OpenClaw, JCode, Codex, Kilo, Cline, Copilot, Hermes, DeepSeek-TUI, Droid, Cowork-MCP) now writes the canonical `krouter` provider key, and detects the legacy `9router` key as a read-fallback. On the next "Apply" click the user's IDE config converges to canonical names. Specifics:
- OpenCode `provider["krouter"]`, model prefix `krouter/`, dual-match regex `^(?:krouter|9router)\/`
- OpenClaw `providers["krouter"]` in `models.providers`, `agents.list`, and per-agent `models.json`
- JCode `providers["krouter"]`, env file renamed `provider-krouter.env`, env var `JCODE_KROUTER_API_KEY`; legacy env file removed on write; CLI flag now `jcode --provider-profile krouter`
- Codex `model_provider = "krouter"`, `[model_providers.krouter]` section; legacy section removed on next save
- Droid `custom:kRouter-N` IDs; legacy `custom:9Router-N` detected as fallback
- 25+ `sk_9router` localhost placeholder API keys → `sk_krouter` (not validated server-side, safe to rename)
- localStorage key for endpoint presets migrated; legacy key read once then removed

## CLI / system-tray visible surfaces
- Tray menu label + tooltip: `9Router (Port N)` → `kRouter (Port N)`
- Console messages: `🔔 9Router is running in tray` → `🔔 kRouter ...`
- Terminal UI title + breadcrumb: `📡 kRouter Terminal UI`
- macOS plist log paths: `/tmp/krouter.log` + `/tmp/krouter.error.log`
- npm postinstall log prefix: `[krouter] runtime SQLite deps ready`
- Tray + SQLite runtime npm-package name: `krouter-runtime`
- Linux .desktop `Name=kRouter`, `Comment=kRouter API Proxy`

## Autostart bundle ID migration with self-kill protection
The macOS LaunchAgent identifier moved from `com.9router.autostart` → `com.krouter.autostart`. A `cleanupLegacyMacOSAutostart()` helper runs on every enable/disable: unloads the legacy plist with launchd, deletes the file from `~/Library/LaunchAgents/`, then writes the new one. Self-kill protection: if the current Node process IS the running legacy launchd-managed agent, the unload step is skipped (would SIGTERM us mid-execution) — file removal alone is sufficient, launchd releases the agent on next login. Linux `.desktop` and Windows `.vbs` filenames migrate the same way (legacy file removed before new file written). `isAutoStartEnabled()` returns true for either entry so a pre-rename install still reads as enabled until next toggle.

## Dashboard sidebar wordmark
Now rendered in CAPITAL via Tailwind `uppercase` + 0.04em tracking — `KROUTER` with `v0.5.7` below. Kodelyth Mark on the brand-orange tile unchanged.

## Intentionally NOT changed
- HTTP wire-protocol identifiers (`X-CLIENT-TYPE`, `X-Msh-Platform`, `grok-cli/9router` user-agent, `x-9r-cli-token`, `9r-cli-auth`) — sent to/shared with third-party services or between client+server; renaming requires coordinated changes with no user benefit.
- `decolua/9router` upstream-credit links in landing nav/footer — intentional attribution to fork source.

## Verification on maintainer's machine
- `~/.9router/` (1.4 MB `data.sqlite`, auth, jwt-secret, machine-id, MITM cert) → `~/.krouter/` migrated in-place, all files intact, zero data loss.
- `com.9router.autostart.plist` cleanly removed; `com.krouter.autostart.plist` registered with launchd, PID 94237 running, exactly one router process (no double-launch).
- `/api/version` HTTP 200 from dev server; every cli-tools settings endpoint compiles and reaches auth gate (HTTP 401), no 500s.
- All 41 modified files pass `node --check`; zero errors or warnings in dev log.

---

# v0.4.80+sifxprime.1 (2026-06-15) — fork hardening pass

Hardening overlay on top of upstream `decolua/9router@v0.4.80`. Eleven audit findings closed across nine atomic commits; each fix carries a unit test that reproduces the BEFORE behavior plus live end-to-end verification through Kiro → MITM → router → real provider. Bug 11 from the audit was dropped after empirical disproof.

## Security
- **API SSRF guard on user-supplied `baseUrl`** — `GET /api/providers/[id]/models` now validates the OpenAI-compatible and Anthropic-compatible base URLs. Blocks cloud metadata endpoints (AWS `169.254.169.254`, ECS `169.254.170.2`, Alibaba `100.100.100.200`, GCP `metadata.google.internal`), wildcard binds, and non-`http(s)` schemes. Loopback and private LAN ranges still allowed for self-hosted LLMs. (Bug 3, c8e3636)
- **Timing-safe CLI token compare** — replaced naive `===` with `crypto.timingSafeEqual` via a `safeEqString` helper. 200k-sample test: byte-position timing ratio drops from 2.22× (OLD oracle) to 0.96× (within noise band). (Bug 9, d680881)
- **Per-IP brute-force lockout on auth failures** — new `src/lib/auth/apiAuthLimiter.js`. 10-fail threshold, progressive lockout 30 s → 2 m → 10 m → 30 m, 1 h auto-reset, per-IP isolation. Held in a separate bucket from login attempts. Loopback origins explicitly skip the limiter to avoid collateral damage on the `"unknown"` IP fallback bucket. (Bug 10, d680881)
- **EventStream encoder bounds checks** — `kiro.js` `encodeHeader` now throws on header-name > 255 B and value > 65 535 B; `buildEventStreamFrame` caps total frame at 16 MiB. Prevents silent uint8/uint16 wrap-around producing corrupt frames that surface in Kiro as `"Truncated event message received"`. (Bug 12, 660eaa0)

## Concurrency & Auth
- **No mutation of caller credentials on token refresh** — `chatCore.handleChatCore` replaced `Object.assign(credentials, newCredentials)` with `{ ...credentials, ...newCredentials }` and threaded the new object into the retry. Eliminates a race where two concurrent requests sharing the same credentials reference could see each other's tokens swapped mid-stream. (Bug 1, 6020127)
- **Retry response always adopted after refresh** — the 401-retry block no longer keeps the stale 401 when the retry returns non-ok or throws. Downstream `parseUpstreamError` now reports the actual failure cause instead of `"Unauthorized"`. (Bug 2, f009fca)
- **Atomic `backoffLevel` read-modify-write** — new `updateProviderConnectionAtomic(id, computeUpdates)` in `connectionsRepo.js`; `markAccountUnavailable` rewritten to compute inside the transaction. Concurrent failures no longer lose increments and stall exponential backoff at +1. (Bug 8, a16f685)

## MITM stream layer
- **Upstream HTTP errors surfaced to Kiro as `exception` frames** — `pipeTransformedEventStream` previously hard-coded HTTP 200 with content-type `application/vnd.amazon.eventstream` and dropped the upstream body for any non-OK response. Now reads the error body and emits a parseable AWS EventStream frame with `:message-type=exception` carrying the upstream message. (Bug 6, a05186a)
- **Pipe loops resilient to mid-stream read errors** — `pipeSSE`, `pipeTransformedSSE`, `pipeTransformedEventStream` now wrap the read loop in `try/catch/finally`. On `ECONNRESET` / `socket hang up` / abort: log, run transform-flush, emit a terminal frame (EventStream exception or SSE `[DONE]`), guarantee `res.end()`. Previously the client connection hung until the OS-level socket timeout. Verified: fake router that destroys mid-stream now closes the curl client in ~300 ms with a parseable terminal frame instead of hanging. (Bug 7, 14da886)
- **MITM `requestTimeout = 0`** — disabled Node's default 5-minute `requestTimeout` and `headersTimeout` on the MITM HTTPS server so long-running agentic streams (Kiro extended-thinking, multi-tool analysis) aren't cut mid-frame. (baseline, 6457f87)

## Routing & efficiency
- **Combo recursion depth guard** — added `MAX_COMBO_RECURSION_DEPTH = 3`. A misconfigured combo that cycles (`comboA → comboB → comboA`) or chains too deep now returns HTTP 400 `"Combo recursion limit exceeded"` instead of overflowing the call stack. (Bug 5, 21e8390)
- **Single `getSettings()` per request** — `chat.js` previously read settings 2–3× per request (top-level + inside the `while(true)` account-fallback loop + a third time in the nested-combo branch). Now read once at the top of `handleChat` and threaded through. (Bug 4, 21e8390)

## Verification methodology
Every fix shipped with:
- A standalone Node test file that **reproduces the BEFORE behavior** under controlled conditions (race simulations, mock streams that throw mid-read, statistical timing of `===` vs `timingSafeEqual`, etc.) and confirms the **AFTER** behavior fixes it.
- A live end-to-end run through the full stack (real Kiro client → MITM → 9router dev server → real provider), verifying the happy path still returns the expected 200 / 551 B / 4-frame EventStream and that the bug-trigger conditions produce the documented graceful behavior.
- For SSRF (Bug 3): live tests with temp DB rows confirming `169.254.169.254` blocks at HTTP 400 + reason, `api.openai.com` reaches upstream, `192.168.x` LAN IPs pass through to the fetch.
- For Bug 11 (audit drop): empirical test of `pipeWithDisconnect` showed `upstream.cancel()` fires within 1 ms of client disconnect via `reader.cancel()` propagation through `pipeThrough`. The "fake writer" stub is necessary (the writable side is locked by `pipeThrough`) and harmless. No fix needed.

# v0.4.80 (2026-06-13)

## Features
- Vercel AI Gateway: support embeddings, images and credit usage (#1183)
- Add MiMo Free no-auth provider (#1789)
- Vertex: support ADC `authorized_user` credential
- Cowork: re-enable Claude Cowork with preset-only stdio MCP
- Codex: bulk add accounts via JSON (#1719)
- Kiro: enable multi-endpoint failover for GenerateAssistantResponse (#1722)

## Fixes
- Security: re-auth on DB export/import + SSRF guard on web fetch
- Auth: real client IP rate-limiting + remote default-password guard
- Cerebras/Mistral: strip unsupported `client_metadata` from downstream requests (#1742)
- SiliconFlow: update baseUrl `.cn` -> `.com` + curate verified model list (#1760)
- Gemini-to-OpenAI: route unsigned thought parts to `reasoning_content` (#1752)
- Claude-to-OpenAI: strip Anthropic billing header from system prompt (#1765)
- Anthropic-compatible: send Bearer auth for third-party gateways (#1795)
- Usage-stats: avoid partial stats on initial SSE race (#1767)
- Proxy: use `export default` in proxy.js for Next.js 16 middleware detection
- Claude passthrough: add body normalization
- GitHub Copilot: refresh missing/expired token on models discovery (#1727) + add mappable gpt-5-mini/gpt-5.4-nano slots for Copilot MITM (#1653)
- Kiro: auto-resolve profileArn to prevent 403 on IDC login, enhance profile ARN resolution, update endpoint to `runtime.us-east-1.kiro.dev` (#1713)
- Tunnel: detect system-installed Tailscale via dual-socket probe (#1723) + non-blocking probes to prevent UI freeze
- CommandCode: force `stream=true` in transformRequest (#1706)
- Qoder: increase timeouts for reasoning models and improve stream handling
- Dashboard: show provider node name instead of connection name in topology (#1770) + show explicit `kind="llm"` combos on combos page (#1684)

## Docs
- README: add Indonesian 9Router tutorial video (#1709)

# v0.4.71 (2026-06-06)

## Features
- Caveman: add wenyan classical Chinese levels and sync upstream prompts; locale-based visibility on endpoint page
- i18n: endpoint exposure notice across multiple languages + Russian README
- Antigravity: add gemini-3.5-flash-extra-low (Low) model
- xiaomi-tokenplan: add Claude-native MiMo V2.5 Pro alias via dedicated executor
- Qoder: fetch latest model + dashboard import-model button (#1642)
- MiniMax: add MiniMax-M3 + update Quota Tracker coding/CN (#1631)

## Fixes
- Codex: harden streaming timeouts (stall/connect raised to 60s, configurable per-provider), accept `response.done` event, and always emit a terminal `response.failed` + `[DONE]` for Responses passthrough when a stream closes, stalls, or aborts before a terminal event — prevents codex clients from hanging (#1648, #1680, #1688, #1618)
- Codex: durable OAuth refresh lifecycle (#1664)
- Tunnel: skip virtual interfaces to prevent false netchange watchdog
- Claude: fix forced tool_choice 400 on cc/ OAuth route (#1592)
- Proxy: raise Next client body limit to 128MB via `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (#1529, #1572)
- MiniMax: echo `reasoning_content` on follow-up turns to avoid 400 (#1543)
- Kiro: handle 400 on tool-bearing history without client tools; add mappable "auto" model slot; fix binary EventStream crash + add models & TTS tool filtering
- Antigravity: passthrough tab-autocomplete + mark default agent slot mandatory
- Qoder: allow `qmodel_latest` model key (#1638)
- Providers: restore one-connection guard for compatible/embedding nodes
- Model-test: route image/STT probes to their real endpoints, harden STT ping; add opencode-go + xiaomi-tokenplan to connection test (#1576, #1628)

## Improvements
- Dashboard: reorganize menu actions across sidebar/header/profile
- Translator: add data-driven coverage, bug-exposing cases, and real provider smoke tests

# v0.4.66 (2026-05-29)

## Features
- Add Qoder provider: device-flow OAuth, COSY signing, WAF-bypass body encoding, live model catalog, dashboard quota tracker, 11 models (#1372)
- Add new models: Claude Opus 4.8 (Claude Code), GPT 5.4 Mini (Codex)

## Fixes
- DeepSeek thinking mode: echo `reasoning_content` back on follow-up/tool-call turns so OpenCode-free and custom providers no longer 400 with "reasoning_content must be passed back" (#1543)
- Reasoning injector: match deepseek/kimi model ids case-insensitively (covers custom providers using capitalized model names)
- OpenCode suggested-models: include free models without the `-free` suffix, e.g. `big-pickle` (#1535)

## Improvements
- Codex: trim sunset models, keep gpt-5.5 / gpt-5.4 / gpt-5.3-codex family, add gpt-5.4-mini
- volcengine-ark: refresh model list (add DeepSeek-V4-Flash/Pro, drop EOL entries)
- Lower stream stall timeout 35s → 30s for faster hang detection

# v0.4.63 (2026-05-26)

## Fixes
- GitHub Copilot: never route Gemini/Claude models to the `/responses` endpoint; prevents misleading "does not support Responses API" 400s (#1062)
- proxyFetch: restore missing `Readable` import causing runtime `ReferenceError` in DNS-bypass fetch path

## Improvements
- Lower stream stall timeout from 60s → 35s for faster hang detection

# v0.4.62 (2026-05-26)

## Fixes
- Codex: auto-retry when upstream drops mid-stream (no more hangs)
- Codex: fix random 400/404 errors, tool-calling failures, and unstable prompt cache
- MITM: support Antigravity 2.x 
- Sanitize Read tool args to prevent retry loops from non-Anthropic models (#1144)
- Implement json_schema fallback for OpenAI-compatible providers without native Structured Output (#1343)
- Strip empty Read pages argument in OpenAI-to-Claude translator (#1354)
- Forward Gemini output dimensions for embeddings (#1366)
- Resolve setState-in-effect errors in dashboard components (#1362)
- Gemini CLI: reuse stored OAuth project IDs for quota checks and show clearer setup guidance when the project is missing (#1271, #1428)

## Features
- Add Cloudflare Workers proxy deployer and pool integration (#1360)
- Add Deno Deploy relays support and improved proxy pools dashboard layout (#1437)

## Improvements
- Refactor Tunnel into dedicated Cloudflare and Tailscale manager modules
- Refactor tokenRefresh service with in-flight dedup to prevent refresh_token_reused errors

# v0.4.59 (2026-05-21)

## Fixes
- OAuth: fix login flow on Windows

# v0.4.58 (2026-05-21)

## Features
- xAI Grok provider (OAuth, API key, image)
- Provider limits: paginated accounts with page size controls

## Fixes
- Tailscale: fix connection status on Windows (#1300)
- Tunnel: fix false "checking" when tunnel URL is reachable
- Stream: fix pipe errors on client disconnect/abort

# v0.4.55 (2026-05-18)

## Features
- Xiaomi MiMo Token Plan: region selector (Singapore / China / Europe) — keys are cluster-specific
- Antigravity: risk confirmation dialog before first connection
- Gemini CLI: surface upstream retry delay on 429 errors

## Fixes
- MITM: cannot kill process on macOS under sudo (lsof not found in PATH)
- Stream: false-positive stall timeout on Claude reasoning / Kiro responses
- Tunnel: cannot re-enable after disable (stuck state)
- Tunnel: cloudflared error messages now include log tail for easier debugging
- Language switcher: applies selected locale immediately on close (#1234)
- Antigravity OAuth: metadata now matches the official client

## Improvements
- Gemini CLI: bump engine to 0.34.0
- Re-hide `qwen` (OAuth EOL) and `iflow` (not ready) providers

# v0.4.52 (2026-05-17)

## Features
- Add Vercel AI Gateway provider support (#1183)
- rtk: Kiro format tool result compression — handle conversationState.history & currentMessage, preserve error results, ~13.6% savings (#1194)

## Fixes
- openclaw: normalize agent.model object form `{primary, fallbacks}` before .startsWith → fix TypeError & 'not configured' status (#1216)
- Usage Details pagination: stay inside mobile viewport <640px (#1218)
- Fix test model error
- Fix MIMO provider in Codex
- Disable log file creation when using MITM AG

# v0.4.50 (2026-05-16)

## Fixes
- Fix duplicate tray icon on macOS when hiding to tray
- Fix tray not showing in background mode on macOS
- Fix hide to tray broken on Windows/Linux
- Fix Shutdown button in web UI not working

# v0.4.49 (2026-05-16)

## Features
- Add Kiro provider support: full request/response translation, live model listing, reasoning content support
- Add `buildOutput` RTK filter with autodetect for npm/yarn/cargo build logs
- Add MITM warning notification in tray and dashboard

## Improvements
- Add modalities (input/output) to model configuration for OpenCode
- Fix tray hide-to-tray: keep current process alive instead of spawning detached child (fixes macOS NSStatusItem ghost icon)
- Fix tray kill: graceful shutdown with SIGTERM/SIGKILL escalation
- Fix SIGHUP handling so macOS terminal close doesn't kill tray process
- Hide deprecated providers (qwen, iflow, antigravity)
- Update i18n across 32 languages

## Fixes
- Fix model check (test-models) blocked by dashboardGuard: pass machineId-based CLI token in internal self-calls

# v0.4.46 (2026-05-15)

## Breaking Changes
- Tunnel public URL changed — old tunnel links no longer work, please reconnect to get the new URL

# v0.4.44 (2026-05-15)

## Features
- Add Blackbox provider with `bb` alias (#1143)
- Add Xiaomi token plan provider
- Enhance model select modal UX + modal traffic lights (#1111)
- Default Usage dashboard period to Today (#1141)

## Fixes
- Fix Cowork model selection and Windows CLI packaging (#1129)
- Update provider name retrieval for compatibility provider (#1135)
- Update JWT_SECRET handling

# v0.4.41 (2026-05-14)

## Features
- Add jcode CLI tool integration with auto-configuration (#1047)
- Redesign CLI Tools dashboard: grid layout (1/2/3 cols) + dedicated detail page per tool
- Add drag-and-drop reordering for combo models (#1108)
- Add Today period option to Usage & Analytics (#1063)
- Add DeepSeek V4 Pro effort aliases (#950)

## Fixes
- fix(autostart): work on nvm + npm 9/10, actually register with launchctl (#1104, fixes #1082)
- Fix Ollama usage not tracked/shown in UI (#1102)
- fix(opencode): preserve DeepSeek reasoning content (#1099, fixes #1093)
- Fix TUI input lag (replace enquirer with native readline, persistent raw mode)
- fix(ui): show API key row actions on mobile (#1112)

## Improvements
- Sync DeepSeek TUI card style with other CLI tools (badges, layout, manual config modal)
- Add official logos for Amp CLI, jcode, Qwen Code (replace generic icons)
- Resize deepseek-tui icon 1024→128 with padding for visual consistency

# v0.4.39 (2026-05-14)

## Fixes
- fix(docker): restore `/app/server.js` (v0.4.38 regression)

# v0.4.38 (2026-05-13)

## Features
- Add DeepSeek TUI as CLI tool in dashboard (#1088)

## Fixes
- Fix broken Docker image in v0.4.36/v0.4.37 (#1096, #1097)

## Improvements
- Clean Docker tags + clearer pulls badge

# v0.4.37 (2026-05-13)

## Improvements
- Security hardening — upgrade recommended

# v0.4.36 (2026-05-13)

## Features
- Add MiniMax TTS provider support (#1043)
- Docker images now published on both Docker Hub (`decolua/9router`) and GHCR — pull from your preferred registry

## Improvements
- Replace browser confirm dialogs with custom ConfirmModal (#1060)

## Fixes
- Fix Docker `Cannot find module 'next'` error in standalone build
- Restore /app/server.js in Docker standalone build (#1064, #1067)
- Fix CLI TUI menu arrow-key escape sequences leaking (^[[A^[[B)
- Switch macOS/Linux tray to systray2 fork (fixes Kaspersky AV false-positive) (#1080)
- Fix zoom controls contrast in topology view (#1066)