# v0.5.196 (2026-11-19) — the Chat page can actually send a message

The dashboard Chat page has never worked. BasicChatPageClient posts to
`/api/dashboard/chat/completions`, and that route did not exist — not in any
release, and nowhere in git history. Every send came back 404, which the page
rendered as "Request failed (404)". v0.5.193 added the page to the nav, which
made a page that could not send a message easier to find.

The route exists now, deliberately shaped like `/v1/chat/completions`: the same
`handleChat`, the same redaction wrapper, so Chat gets the same routing,
failover and PII handling as every other client. It is a separate route only
because the two are authorised differently. `/v1` is the public LLM API and is
keyed; this is dashboard surface, where the deny-by-default gate has already
required a session before the request arrives, so the browser authenticates as
itself and sends no API key. When `requireApiKey` is on — where `handleChat`
demands a key a browser does not have — the route borrows a stored active key
server-side rather than letting that setting break the operator's own dashboard.

Nothing could have caught this. The page compiles, the route list is correct and
the suite was green: the caller and the callee were two strings nobody compared.
There is now a test that compares them, walking every `fetch("/api/...")` in
tracked frontend source and matching it against the registered routes the way
Next does — whole paths, `[seg]` for one segment, `[...seg]` for the rest. 103
fetch targets against 154 routes, both with a floor, so a scan that stops seeing
things fails instead of passing quietly.

**MITM, viewed from another machine.** The MITM card showed "Stopped" with dead
controls when the dashboard was opened from a different device. The route is
local-only by design — it spawns sudo, binds :443 and edits the hosts file — so a
remote session gets a 403 and always will. It now says so, with Start and the
base-URL input disabled, instead of looking merely broken.

**Security.** node-forge 1.4.2 → 1.4.3 and a minimatch floor of 11.0.1, closing
all ten open Dependabot alerts. Neither was reachable here — the four node-forge
advisories live in `forge.tls`, `forge.http` and `forge.ed25519`, none of which
this codebase imports, and minimatch was dev-only — but both are patched rather
than dismissed. No typescript-eslint release uses minimatch 11 yet, so it is
forced per parent rather than reached by a version bump.

**Tests that could not fail.** The data-dir source scan was walking `cli/app`,
the CLI build's staging copy, and reporting twenty bundles as drifting source on
any machine that had run that build. It asks git what source is now, which also
closed `cli/.build-home` without needing a second exclusion. And a duplicate
import shipped to main that `node --check` rejects and vitest ran green over,
because esbuild merges the two declarations — so every tracked `.js` is now
parsed by Node itself, not only by the bundler.

