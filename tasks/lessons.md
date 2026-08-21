# Claude Lessons

Project: **9router-master** (kRouter — `@sifxprime/krouter`)

Hard rules for this project, derived from real corrections and from bugs that
actually shipped. Injected into every session as mandatory constraints, so keep
this tight — every line costs context. Edit freely; these are YOUR rules.

---

## Scope

- This repo IS kRouter. When the user says "kRouter", "the router", or names antigravity/kiro/opencode issues, they mean THIS repo — fix and verify here.
- `~/freellmapi` (Veltix / zenith) and `~/klaw` are separate projects and out of scope. Do not raise them as caveats, even if they are running and sharing `~/.krouter` data.

## Naming

- The project was renamed 9router → kRouter. No user-visible "9router" string should remain: check UI copy, dashboard labels, and hardcoded paths before shipping.
- The data directory is `~/.krouter`, not `~/.9router`. Hardcoded display strings have leaked the old path before (e.g. the profile page) — grep for it rather than trusting the config value.

## Verification

- Verify live with a real request, not just unit tests. A passing unit test with a wrong assertion is how the v0.5.114 translator bug shipped.
- Always report before/after with concrete evidence when claiming a fix, and verify before pushing rather than after.
- Prefer the terminal for verification over the browser.

## Testing

- Run tests with `./node_modules/.bin/vitest run` from the repo root — it uses the root `vitest.config.js` with the `@` and `open-sse` aliases.
- Do NOT use the `tests/` package script: it points at `/tmp/node_modules`, which macOS clears, and running from `tests/` breaks the suite's relative-path reads.

## Providers

- Adding a provider touches 4 catalog/routing points: `src/shared/constants/providers.js`, `open-sse/config/providers.js`, `open-sse/config/providerModels.js`, and `ALIAS_TO_PROVIDER_ID` in `open-sse/services/model.js`.
- There are TWO alias maps and nothing forces them to agree. Any provider whose alias differs from its id must be in BOTH, or it silently 401s/404s at request time (cbcn in v0.5.109, gcli in v0.5.110).
- Token refresh has two distinct paths: `DefaultExecutor` providers use the `refreshers` map in `open-sse/executors/default.js`; `BaseExecutor` providers use the switch in `open-sse/services/tokenRefresh.js`. A missing case fails silently after the token TTL.

## Translator

- `translateRequest(source, target, …)` takes the CLIENT format first. `translateResponse(target, source, …)` takes the PROVIDER format first. They are opposite, and getting the response order wrong is a silent bug, not an error.

## Upstream

- This is a fork of `decolua/9router` that has structurally diverged — no `open-sse/providers/registry/`, no `PROVIDER_MEDIA`. Port upstream commits by adapting them; verify every imported symbol exists here before copying.

## Releasing

- The npm package is `cli/package.json` (`@sifxprime/krouter`). The root package is `krouter-app` and is `private: true` — never publish from the root.
- `cli/app/` ships a PREBUILT copy of the app. Bumping the version without running the build publishes stale code under a new version number. Use `npm run cli:publish`, or build first and publish the audited tarball.

## Environment

- MITM writes `127.0.0.1` entries to `/etc/hosts` for provider domains. If they are left behind while MITM is down, requests to those providers hang and return nothing. Check `/etc/hosts` before diagnosing a provider as broken.
