# Contributing to kRouter

Thanks for helping. Bug reports, fixes and new providers are all welcome. This page
covers the handful of things about this repository that tend to catch people out.

## Reporting a bug

Open an **[issue](https://github.com/sifxprime/krouter/issues/new/choose)** and fill in
the bug template. The version, client, provider and the exact error text are what let
us reproduce it — remember to **remove API keys and tokens** from anything you paste.

Security problems go through **[private reporting](SECURITY.md)**, not a public issue.

## Running it from source

Needs **Node.js 20.12 or newer** for development (the test runner needs 20.12; the
published package itself runs on 20.9+).

```bash
git clone https://github.com/sifxprime/krouter.git
cd krouter
npm install
npm run dev          # dashboard + API at http://localhost:20128
```

## The layout that surprises people

There are **two packages** in this repo:

| Path | What it is | Published? |
|---|---|---|
| `/` (root) | The Next.js app — dashboard, API, routing engine (`src/`, `open-sse/`) | No — `private: true` |
| `cli/` | The `krouter` command and the npm package `@sifxprime/krouter` | **Yes** |

When you release, `cli/scripts/build-cli.js` builds the root app and copies its
standalone output into `cli/app/`, which ships inside the npm package. So most code
changes happen in the root, but anything about the command itself, the install hooks
or the published metadata lives in `cli/`.

## Editing the README

Edit **`README.md` at the root**, never `cli/README.md`. The npm page is generated from
it by `cli/scripts/sync-readme.js`, which also rewrites relative links into absolute
GitHub URLs (npmjs.com can't resolve them). It runs automatically before publishing;
to preview it:

```bash
node cli/scripts/sync-readme.js
```

## Tests

```bash
npm test
```

Run it from the **repo root** — the tests resolve paths like `cli/cli.js` relative to
it. CI runs the same command on every pull request, on Node 20.12 and 22, and separately
checks that the app installs and builds on Node 20.9, the floor the package promises.

Please add a test with a fix where you can. If a bug was silent — no error, just wrong
behaviour — a test that would have failed beforehand is the most useful thing a pull
request can carry.

## Pull requests

- Keep each one to a single change; it is much quicker to review.
- Say what was wrong and how you know your change fixes it — a command, a test, or the
  before/after output.
- Configure your git identity (`git config user.name` / `user.email`) before committing,
  so your work is attributed to you. *(Suggested by @manindersarao in #3.)*

## Upstream

kRouter is a fork of [decolua/9router](https://github.com/decolua/9router). If your fix
applies there too, consider sending it upstream as well.
