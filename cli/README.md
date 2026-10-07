<div align="center">
  <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/images/kodelyth-router.png" alt="kRouter — Kodelyth AI Infrastructure" width="320"/>

  # kRouter — Kodelyth AI Infrastructure

  **The universal AI router that saves 20–40% input tokens and falls back when a provider fails.**

  Connect Claude Code, Cursor, Antigravity, Kiro, Copilot, Codex, OpenCode, Cline, OpenClaw, and any OpenAI-compatible client to **95+ AI providers and 100+ models** through one self-hosted endpoint. Route intelligently. Fall back instantly. Save tokens automatically.

  [![npm](https://img.shields.io/npm/v/@sifxprime/krouter.svg)](https://www.npmjs.com/package/@sifxprime/krouter)
  [![GitHub](https://img.shields.io/badge/github-sifxprime%2Fkrouter-blue?logo=github)](https://github.com/sifxprime/krouter)
  [![Website](https://img.shields.io/badge/website-krouter.kodelyth.com-orange)](https://krouter.kodelyth.com)
  [![License](https://img.shields.io/npm/l/@sifxprime/krouter.svg)](https://github.com/sifxprime/krouter/blob/main/LICENSE)

  **[Website & Full Docs — krouter.kodelyth.com](https://krouter.kodelyth.com)**

  [Quick Start](#quick-start) • [Features](#features) • [Setup](#setup-guide) • [Supported Providers](#supported-providers)
</div>


> **You're viewing this on npm.** Full docs, screenshots, and changelog: [github.com/sifxprime/krouter](https://github.com/sifxprime/krouter).

---

## Quick Start

Requires **Node.js 20.9 or newer**.

```bash
# Install globally from npm
npm install -g @sifxprime/krouter

# Run in background (tray mode)
krouter -t
```

The dashboard is at **[http://localhost:20128/dashboard](http://localhost:20128/dashboard)** — open it in your browser, or from the tray icon.

**First login:** the default dashboard password is `123456`. Change it under **Settings → Security** once you're in.
For safety, the default only works from the machine kRouter is running on — sign-ins from other devices
on your network are refused until you set your own. Under Docker that includes your own browser, so
set `INITIAL_PASSWORD` as shown below.

Prefer the foreground? Run `krouter` with no flag, and add `-l` to see the server logs.

### CLI Options

```bash
krouter --help

Options:
  -p, --port <port>   Port to run the server (default: 20128)
  -H, --host <host>   Host to bind (default: 0.0.0.0)
  -l, --log           Show server logs (default: hidden)
  -t, --tray          Run in system tray mode (background)
  --skip-update       Skip auto-update check
  -h, --help          Show this help message
  -v, --version       Show version
```

The default host `0.0.0.0` makes kRouter reachable from your network; remote callers still need an API key
for `/v1/*` and a login for the dashboard. Use `--host 127.0.0.1` to keep it local-only. The `krouter`
command ignores the `PORT` and `HOSTNAME` environment variables, so set the port and host with these flags.

### From Source (Contributors)

```bash
git clone https://github.com/sifxprime/krouter.git
cd krouter
npm install
npm run dev
```

### Docker

```bash
KROUTER_PASSWORD="$(openssl rand -base64 18)" && echo "Dashboard password: $KROUTER_PASSWORD"
docker run -d \
  -p 20128:20128 \
  -e INITIAL_PASSWORD="${KROUTER_PASSWORD:?run the line above first}" \
  -v "$HOME/.krouter:/app/data" \
  --name krouter \
  sifxprime/krouter:latest
```

The first line makes a random password and prints it. Log in with it, then set your own under
**Settings → Security**; until you do, the password is whatever `INITIAL_PASSWORD` the container started with.
Under Docker the default `123456` is refused, because your browser's requests reach the container
from outside it. If `~/.krouter` already holds a password from an npm install, that one is used.
Forgot it? With image 0.5.162 or newer: `docker exec krouter node scripts/reset-password.js` (see
[DOCKER.md](https://github.com/sifxprime/krouter/blob/main/DOCKER.md)).

#### With PII Redaction (Presidio)

To enable automatic PII redaction before sending requests to AI providers. Compose builds kRouter
and the sidecar from source, so it runs from a clone. `KROUTER_INITIAL_PASSWORD` has no default —
compose refuses to start without it. The second line saves a random one to `.env`, where compose
reads it on every start, and prints it: that is your dashboard password.

```bash
git clone https://github.com/sifxprime/krouter.git && cd krouter
echo "KROUTER_INITIAL_PASSWORD='$(openssl rand -base64 18)'" > .env && cat .env
docker compose up -d
```

Not using Docker? kRouter has no Python dependency — run the sidecar separately. kRouter looks for it
at `http://127.0.0.1:5001/redact`; set `SIDECAR_URL` if it runs anywhere else. See the setup guide below.

Redaction is **off by default**; enable it from the **Presidio** page in the dashboard sidebar.

See [docs/REDACTION_SETUP.md](https://github.com/sifxprime/krouter/blob/main/docs/REDACTION_SETUP.md) for full configuration and customization options.

Then open **[http://localhost:20128/dashboard](http://localhost:20128/dashboard)**.

---

## Why kRouter?

Stop wasting money, tokens, and hitting limits:

- Subscription quota expires unused every month
- Rate limits stop you mid-coding
- Tool outputs (git diff, grep, ls…) burn tokens fast
- Paying separately for every provider's API adds up
- Manually switching between providers

**kRouter solves this:**

- **RTK Token Saver** — on by default; compresses tool outputs to save 20–40% of input tokens per request
- **Zenith routing** — scores each account by success rate, latency and remaining quota, and skips accounts that are cooling down
- **Multi-account rotation** — round-robin across accounts, with quota tracking for providers that report it
- **Auto token refresh** — OAuth tokens refresh transparently
- **Universal client support** — works with OpenAI, Anthropic, Responses, Gemini and Ollama-format clients
- **MITM interception** — routes Antigravity, GitHub Copilot, Kiro IDE and Claude Desktop through kRouter (not inside Docker)

---

## How It Works

```
┌─────────────┐
│  Your CLI   │  (Claude Code, Codex, OpenClaw, OpenCode, Cline…)
│   Tool      │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌─────────────────────────────────────────────┐
│           kRouter (Smart Router)            │
│  • RTK Token Saver (cut tool_result tokens) │
│  • Zenith account scoring                   │
│  • Format translation (OpenAI ↔ Claude)     │
│  • Live quota tracking                      │
│  • Auto token refresh                       │
└──────┬──────────────────────────────────────┘
       │
       ├─→ [SUBSCRIPTION] Claude Code · Codex · Copilot · Cursor
       │
       ├─→ [FREE TIER] Cloudflare · Vertex · Gemini · Ollama Cloud · OpenRouter
       │
       └─→ [FREE] Kiro · Gemini CLI · Qoder · OpenCode Free · MiMo Code Free
```

If an account fails or hits a rate limit, kRouter moves to the next account for that provider. Put models from several providers in a combo and it falls back across them in turn — with zero manual intervention.

---

## PII Redaction with Presidio

Optional, and **off by default**. When enabled, kRouter strips personal data — names, emails, phone
numbers, API keys — from prompts *before* they leave your machine, using Microsoft Presidio as a local
sidecar (needs Docker or Python). It **fails closed**: if the sidecar is down, times out or errors,
the request is rejected (`503` / `502`) rather than sent unredacted. It covers the chat, Messages,
Responses, Ollama and Gemini-format routes; embeddings, audio, images, search and fetch are not redacted.

Setup, configuration, custom patterns, testing and troubleshooting: **[docs/REDACTION_SETUP.md](https://github.com/sifxprime/krouter/blob/main/docs/REDACTION_SETUP.md)**.

## Features

| Feature | What It Does | Why It Matters |
|---------|--------------|----------------|
| **RTK Token Saver** | Compresses tool outputs (git diff, grep, ls, tree…) in requests. On by default | Save **20–40% input tokens** on requests that carry tool output |
| **Zenith Routing** | Scores accounts by success rate, latency, remaining quota and priority | Picks the healthiest account; rate-limited accounts cool down instead of being retried |
| **Smart Fallback** | Combos you build, e.g. Subscription → Free tier → Free | Never stop coding |
| **Real-Time Quota** | Remaining %, reset countdown, exhaustion badge for providers that report quota | Maximize every subscription |
| **Format Translation** | OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex | Works with any CLI tool |
| **Multi-Account** | Multiple accounts per provider with rotation strategies | Load balancing + redundancy |
| **Auto Token Refresh** | OAuth tokens refresh automatically | No manual re-login |
| **Custom Combos** | Named model combinations with fallback, round-robin or fusion strategy | Tailor fallback to your workflow |
| **System Tray** | Runs quietly in background with tray icon | Set-and-forget deployment |
| **Deploy Anywhere** | Localhost · VPS · Docker · PM2, with remote access through Cloudflare Tunnel or Tailscale | Wherever you need it |
| **PII Redaction** | Optional, off by default: redacts names, emails, phones and API keys using Microsoft Presidio | Protect privacy before sending to AI providers |

**Full feature guide → [krouter.kodelyth.com](https://krouter.kodelyth.com)**

---

## Supported CLI Tools

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude Code</b>
      </td>
      <td align="center" width="120">
        <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/public/providers/openclaw.png" width="60" alt="OpenClaw"/><br/>
        <b>OpenClaw</b>
      </td>
      <td align="center" width="120">
        <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/public/providers/opencode.png" width="60" alt="OpenCode"/><br/>
        <b>OpenCode</b>
      </td>
      <td align="center" width="120">
        <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continue</b>
      </td>
      <td align="center" width="120">
        <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/public/providers/droid.png" width="60" alt="Droid"/><br/>
        <b>Droid</b>
      </td>
      <td align="center" width="120">
        <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/public/providers/roo.png" width="60" alt="Roo"/><br/>
        <b>Roo</b>
      </td>
      <td align="center" width="120">
        <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/public/providers/copilot.png" width="60" alt="Copilot"/><br/>
        <b>Copilot</b>
      </td>
      <td align="center" width="120">
        <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/public/providers/kilocode.png" width="60" alt="Kilo Code"/><br/>
        <b>Kilo Code</b>
      </td>
    </tr>
  </table>
</div>

---

## Supported Providers

95+ providers in five groups, plus any OpenAI- or Anthropic-compatible endpoint you add yourself.

### OAuth (Bring Your Subscription)

Claude Code · Antigravity · Codex · GitHub Copilot · Cursor · xAI · Kilo Code · Cline · ClinePass · Grok CLI · Kimchi

### Free Tier (with API key)

Cloudflare Workers AI · Vertex AI · Gemini · Ollama Cloud · OpenRouter · BytePlus ModelArk · Atomesus · NVIDIA NIM · Poolside

### Free (account sign-in or no auth)

Kiro AI · Gemini CLI · CodeBuddy CN · Qoder · OpenCode Free · MiMo Code Free

Kiro, Gemini CLI, Qoder, Claude Code, Antigravity, Codex and GitHub Copilot use subscription sessions that are not licensed for proxy use. The dashboard warns before you connect them: the account may be restricted or banned.

### API Key Providers (65+)

OpenAI · Anthropic · GLM · Kimi · MiniMax · DeepSeek · Groq · xAI · Mistral · Perplexity · Together AI · Fireworks · Cerebras · Cohere · SiliconFlow · Hyperbolic · Nebius · Chutes · and 45+ more

### Browser Session

Grok Web · Perplexity Web (Pro/Max)

**Full provider setup guide → [krouter.kodelyth.com](https://krouter.kodelyth.com)**

---

## Setup Guide

### Step 1 · Install

```bash
npm install -g @sifxprime/krouter
```

### Step 2 · Start in Background

```bash
krouter -t
```

You'll see a tray icon in your menu bar. Right-click for **Open Dashboard** or **Quit**.

### Step 3 · Add a Provider

1. Open **[http://localhost:20128/dashboard](http://localhost:20128/dashboard)**
2. Go to **Providers**, pick one (Cloudflare Workers AI is a good free start) and click **Add**
3. Paste your API key or complete the OAuth login
4. Click **Test** on a model to check it answers

### Step 4 · Point Your AI Tool at kRouter

```text
Endpoint:  http://localhost:20128/v1
API Key:   a key from Dashboard → Endpoint → API Keys   (local callers can skip it)
Model:     kr/claude-sonnet-4.5   (or any provider/model)
```

Works with any OpenAI-compatible client. A **Default Key** is created the first time you open the
Endpoint page. Local requests need no key unless `REQUIRE_API_KEY=true`; requests from other machines
always do. Cursor is the exception to `localhost`: it sends requests through its own servers, so turn
on the **Tunnel** on the Endpoint page and use that URL with a key.

**Detailed integration guide (Claude Code, Cursor, Cline, and more) → [krouter.kodelyth.com](https://krouter.kodelyth.com)**

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `20128` | Server port for the Docker image and `node custom-server.js`. The `krouter` command ignores it — use `--port` |
| `HOSTNAME` | `0.0.0.0` | Bind host for the Docker image and `node custom-server.js`. The `krouter` command ignores it — use `--host 127.0.0.1` for local-only |
| `DATA_DIR` | `~/.krouter` | Data directory (SQLite, certs, cache). `%APPDATA%\krouter` on Windows |
| `INITIAL_PASSWORD` | — | First-login dashboard password. Unset, it is `123456`, accepted only from the same machine |
| `NODE_ENV` | `production` | Runtime mode |
| `REQUIRE_API_KEY` | `false` | Require a Bearer key on `/v1/*` from **every** caller. Remote callers always need one; this additionally removes the loopback exemption, for shared or multi-user machines |
| `KROUTER_SKIP_RUNTIME_HEAL` | `false` | Skip the startup npm self-heal of the SQLite/tray runtime (air-gapped or CI machines) |
| `AUTH_COOKIE_SECURE` | `false` | Force `Secure` cookie (set behind HTTPS reverse proxy) |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` | — | Outbound proxy config |

Full env reference → **[krouter.kodelyth.com](https://krouter.kodelyth.com)**

---

## Deployment

### VPS

```bash
npm install -g @sifxprime/krouter
krouter --skip-update --host 127.0.0.1 --port 20128
```

Put Nginx or Caddy in front for HTTPS; `--host 127.0.0.1` keeps the port closed to everything but the
proxy. Or skip the proxy and use the built-in Cloudflare Tunnel or Tailscale from the Endpoint page.

### Docker

```bash
KROUTER_PASSWORD="$(openssl rand -base64 18)" && echo "Dashboard password: $KROUTER_PASSWORD"
docker run -d -p 20128:20128 -e INITIAL_PASSWORD="${KROUTER_PASSWORD:?run the line above first}" -v "$HOME/.krouter:/app/data" --name krouter sifxprime/krouter:latest
```

### PM2

```bash
npm install -g @sifxprime/krouter pm2
pm2 start krouter --name krouter -- --skip-update
pm2 save
pm2 startup
```

---

## API

### Chat Completions

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer <your-api-key>
Content-Type: application/json

{
  "model": "kr/claude-sonnet-4.5",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": true
}
```

### List Models

```bash
GET http://localhost:20128/v1/models
Authorization: Bearer <your-api-key>
```

Returns every configured provider + custom combo in OpenAI format.

---

## Uninstall

```bash
# Stop kRouter (right-click tray → Quit, or pkill -f krouter)
npm uninstall -g @sifxprime/krouter
rm -rf ~/.krouter   # optional: wipe database + certs
```

---

## Troubleshooting

**"No active credentials for provider"** — Add or reconnect the provider in Dashboard → Providers.

**Rate limited** — kRouter cools the account down and moves to the next one. To speed it up, add more accounts or configure a combo.

**MITM cert errors** — Install or reinstall the root CA from the **MITM** page in the dashboard sidebar (**Install Certificate** / **Reinstall Certificate**).

**Dashboard on wrong port** — the `krouter` command ignores `PORT`; pass the port as a flag: `krouter -t --port 20128`. If another program holds the port, kRouter will not stop it and suggests another one.

**Full troubleshooting guide → [krouter.kodelyth.com](https://krouter.kodelyth.com)**

---

## Tech Stack

- **Runtime:** Node.js 20.9+
- **Framework:** Next.js 16
- **UI:** React 19 + Tailwind CSS 4
- **Database:** SQLite (better-sqlite3 / node:sqlite / sql.js)
- **Streaming:** Server-Sent Events (SSE)
- **Auth:** OAuth 2.0 (PKCE) + JWT + API Keys

---

## Links

- **Website:** [krouter.kodelyth.com](https://krouter.kodelyth.com)
- **GitHub:** [github.com/sifxprime/krouter](https://github.com/sifxprime/krouter)
- **Issues:** [github.com/sifxprime/krouter/issues](https://github.com/sifxprime/krouter/issues)
- **npm:** [`@sifxprime/krouter`](https://www.npmjs.com/package/@sifxprime/krouter)
- **Support:** [krouter@kodelyth.com](mailto:krouter@kodelyth.com) · [WhatsApp](https://wa.me/8801312365939)

---

## Credits

kRouter is a hardened fork of the upstream **[decolua/9router](https://github.com/decolua/9router)**. Huge thanks to [@decolua](https://github.com/decolua) and the 9router contributors for the original project. Star them on GitHub.

---

## License

MIT License — see [LICENSE](https://github.com/sifxprime/krouter/blob/main/LICENSE) for details.

---

<div align="center">
  <sub>Built by <a href="https://krouter.kodelyth.com">Kodelyth AI Infrastructure</a></sub>
</div>
