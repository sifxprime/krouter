<div align="center">
  <img src="https://raw.githubusercontent.com/sifxprime/krouter/main/images/kodelyth-router.png" alt="kRouter — Kodelyth AI Infrastructure" width="320"/>

  # kRouter — Kodelyth AI Infrastructure

  **The universal AI router that saves 20–40% tokens and never stops working.**

  Connect Claude Code, Cursor, Antigravity, Kiro, Copilot, Codex, OpenCode, Cline, OpenClaw, and any OpenAI-compatible client to **40+ AI providers and 100+ models** through a single local endpoint. Route intelligently. Fall back instantly. Save tokens automatically.

  [![npm](https://img.shields.io/npm/v/@sifxprime/krouter.svg)](https://www.npmjs.com/package/@sifxprime/krouter)
  [![GitHub](https://img.shields.io/badge/github-sifxprime%2Fkrouter-blue?logo=github)](https://github.com/sifxprime/krouter)
  [![Website](https://img.shields.io/badge/website-krouter.kodelyth.com-orange)](https://krouter.kodelyth.com)
  [![License](https://img.shields.io/npm/l/@sifxprime/krouter.svg)](https://github.com/sifxprime/krouter/blob/main/LICENSE)

  **[🌐 Website & Full Docs — krouter.kodelyth.com](https://krouter.kodelyth.com)**

  [🚀 Quick Start](#-quick-start) • [💡 Features](#-features) • [📖 Setup](#-setup-guide) • [🌐 Supported Providers](#-supported-providers)
</div>


> **You're viewing this on npm.** Full docs, screenshots, and changelog: [github.com/sifxprime/krouter](https://github.com/sifxprime/krouter).

---

## 🚀 Quick Start

Requires **Node.js 20.9 or newer**.

```bash
# Install globally from npm
npm install -g @sifxprime/krouter

# Run in background (tray mode)
krouter -t
```

Dashboard opens at **[http://localhost:20128/dashboard](http://localhost:20128/dashboard)**.

**First login:** the default dashboard password is `123456`. Change it under **Profile** once you're in.
For safety, the default only works from the machine kRouter is running on — sign-ins from other devices
on your network are refused until you set your own.

Prefer running in the foreground with live logs? Just use `krouter` (no flag).

### CLI Options

```bash
krouter --help

Options:
  -p, --port <port>   Port to run the server (default: 20128)
  -l, --log           Show server logs (default: hidden)
  -t, --tray          Run in system tray mode (background)
  --skip-update       Skip auto-update check
  -h, --help          Show this help
  -v, --version       Show version
```

### From Source (Contributors)

```bash
git clone https://github.com/sifxprime/krouter.git
cd krouter
npm install
npm run dev
```

### Docker

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.krouter:/app/data" \
  --name krouter \
  sifxprime/krouter:latest
```

#### With PII Redaction (Presidio)

To enable automatic PII redaction before sending requests to AI providers.
`INITIAL_PASSWORD` has no default — set one before starting, or compose will
refuse to come up:

```bash
export KROUTER_INITIAL_PASSWORD="$(openssl rand -base64 24)"
docker compose up -d
```

Not using Docker? kRouter has no Python dependency — run the sidecar separately
and point `SIDECAR_URL` at it. See the setup guide below.

Redaction is **off by default**; enable it from Dashboard -> Presidio.

See [docs/REDACTION_SETUP.md](https://github.com/sifxprime/krouter/blob/main/docs/REDACTION_SETUP.md) for full configuration and customization options.

Then open **[http://localhost:20128/dashboard](http://localhost:20128/dashboard)**.

---

## 🤔 Why kRouter?

Stop wasting money, tokens, and hitting limits:

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls…) burn tokens fast
- ❌ Expensive APIs cost $20–50/month per provider
- ❌ Manually switching between providers

**kRouter solves this:**

- ✅ **RTK Token Saver** — auto-compress tool outputs, save 20–40% tokens per request
- ✅ **Zenith intelligent routing** — instant sub-1ms failover, ranked by live quota + latency
- ✅ **Multi-account rotation** — round-robin across accounts with real-time quota tracking
- ✅ **Auto token refresh** — OAuth tokens refresh transparently
- ✅ **Universal client support** — works with any OpenAI-compatible AI client
- ✅ **MITM interception** — Kiro, Antigravity, Copilot, and Cursor natively supported

---

## 🔄 How It Works

```
┌─────────────┐
│  Your CLI   │  (Claude Code, Codex, OpenClaw, Cursor, Cline…)
│   Tool      │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌─────────────────────────────────────────────┐
│           kRouter (Smart Router)            │
│  • RTK Token Saver (cut tool_result tokens) │
│  • Zenith Score Engine (sub-1ms routing)    │
│  • Format translation (OpenAI ↔ Claude)     │
│  • Live quota tracking                      │
│  • Auto token refresh                       │
└──────┬──────────────────────────────────────┘
       │
       ├─→ [SUBSCRIPTION] Claude Code · Codex · Copilot · Cursor
       │
       ├─→ [FREE TIER] Cloudflare · Vertex · Gemini · Ollama · OpenRouter
       │
       └─→ [FREE PROXY] Kiro · OpenCode · Atomesus · MiMo
```

If one provider fails, kRouter instantly falls back through your entire pre-ranked stack — with zero manual intervention.

---

## 🔒 PII Redaction with Presidio

Optional, and **off by default**. When enabled, kRouter strips personal data — names, emails, phone
numbers, API keys — from prompts *before* they leave your machine, using Microsoft Presidio as a local
sidecar (needs Docker or Python). It **fails closed**: if the sidecar is down, times out or errors,
the request is rejected (`503` / `502`) rather than sent unredacted.

Setup, configuration, custom patterns, testing and troubleshooting: **[docs/REDACTION_SETUP.md](https://github.com/sifxprime/krouter/blob/main/docs/REDACTION_SETUP.md)**.

## 💡 Features

| Feature | What It Does | Why It Matters |
|---------|--------------|----------------|
| 🚀 **RTK Token Saver** | Auto-compress tool outputs (git diff, grep, ls, tree…) | Save **20–40% input tokens** on every request |
| ⚡ **Zenith Routing** | Pre-ranks accounts by live health + quota in RAM | Instant sub-1ms failover, zero wasted 429s |
| 🎯 **Smart Fallback** | Subscription → Free tier → Free proxy | Never stop coding |
| 📊 **Real-Time Quota** | Live remaining %, reset countdown, exhaustion badge | Maximize every subscription |
| 🔄 **Format Translation** | OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex | Works with any CLI tool |
| 👥 **Multi-Account** | Multiple accounts per provider with rotation strategies | Load balancing + redundancy |
| 🔄 **Auto Token Refresh** | OAuth tokens refresh automatically | No manual re-login |
| 🎨 **Custom Combos** | Unlimited model combinations with per-combo strategies | Tailor fallback to your workflow |
| 🖥️ **System Tray** | Runs quietly in background with tray icon | Set-and-forget deployment |
| 🐳 **Deploy Anywhere** | Localhost · VPS · Docker · Cloudflare Workers | Wherever you need it |
| 🔒 **PII Redaction** | Auto-redact sensitive data (emails, phones, API keys) using Microsoft Presidio | Protect privacy before sending to AI providers |

📖 **Full feature guide with screenshots → [krouter.kodelyth.com](https://krouter.kodelyth.com)**

---

## 🛠️ Supported CLI Tools

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

## 🌐 Supported Providers

### 🔐 OAuth (Bring Your Subscription)

Claude Code · Antigravity · Codex · GitHub Copilot · Cursor · Kiro AI

### 🆓 Free Tier (with API key)

Cloudflare Workers AI · Vertex AI · Gemini · Ollama · OpenRouter · BytePlus · Atomesus · NVIDIA NIM

### 🆓 Free Proxy (no auth or included key)

OpenCode Free · MiMo Free

### 🔑 API Key Providers (40+)

OpenAI · Anthropic · GLM · Kimi · MiniMax · DeepSeek · Groq · xAI · Mistral · Perplexity · Together AI · Fireworks · Cerebras · Cohere · SiliconFlow · Hyperbolic · Nebius · Chutes · and 20+ more

📖 **Full provider setup guide → [krouter.kodelyth.com](https://krouter.kodelyth.com)**

---

## 📖 Setup Guide

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
2. Click **Providers → Add** and choose one (Cloudflare Workers AI is a great free start)
3. Paste your API key or OAuth login
4. Click **Test Connection** → done!

### Step 4 · Point Your AI Tool at kRouter

```text
Endpoint:  http://localhost:20128/v1
API Key:   sk-krouter-XXXX   (from Dashboard → API Keys)
Model:     kr/claude-sonnet-4.5   (or any provider/model)
```

Works with any OpenAI-compatible client.

📖 **Detailed integration guide (Claude Code, Cursor, Cline, and more) → [krouter.kodelyth.com](https://krouter.kodelyth.com)**

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `20128` | Server port |
| `HOSTNAME` | `0.0.0.0` | Bind host. The default listens on every interface, so the port is reachable from your network — use `127.0.0.1` (or `--host 127.0.0.1`) for local-only |
| `DATA_DIR` | `~/.krouter` | Data directory (SQLite, certs, cache) |
| `NODE_ENV` | `production` | Runtime mode |
| `REQUIRE_API_KEY` | `false` | Require a Bearer key on `/v1/*` from **every** caller. Remote callers always need one; this additionally removes the loopback exemption, for shared or multi-user machines |
| `KROUTER_SKIP_RUNTIME_HEAL` | `false` | Skip the startup npm self-heal of the SQLite/tray runtime (air-gapped or CI machines) |
| `AUTH_COOKIE_SECURE` | `false` | Force `Secure` cookie (set behind HTTPS reverse proxy) |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | — | Outbound proxy config |

Full env reference → **[krouter.kodelyth.com](https://krouter.kodelyth.com)**

---

## 🚢 Deployment

### VPS

```bash
npm install -g @sifxprime/krouter
export PORT=20128 HOSTNAME=0.0.0.0
krouter --skip-update
```

Behind Nginx / Caddy + Cloudflare Tunnel for HTTPS.

### Docker

```bash
docker run -d -p 20128:20128 -v "$HOME/.krouter:/app/data" --name krouter sifxprime/krouter:latest
```

### PM2

```bash
npm install -g @sifxprime/krouter pm2
pm2 start krouter --name krouter -- --skip-update
pm2 save
pm2 startup
```

---

## 📡 API

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

## 🗑️ Uninstall

```bash
# Stop kRouter (right-click tray → Quit, or pkill -f krouter)
npm uninstall -g @sifxprime/krouter
rm -rf ~/.krouter   # optional: wipe database + certs
```

---

## 🐛 Troubleshooting

**"No active credentials for provider"** — Add or reconnect the provider in Dashboard → Providers.

**Rate limited** — kRouter's Zenith engine will auto-fall back. To speed it up, add more accounts or configure a combo.

**MITM cert errors** — Reinstall the root CA from Dashboard → CLI Tools → MITM.

**Dashboard on wrong port** — `PORT=20128 krouter -t`

**Full troubleshooting guide → [krouter.kodelyth.com](https://krouter.kodelyth.com)**

---

## 🛠️ Tech Stack

- **Runtime:** Node.js 20+
- **Framework:** Next.js 16
- **UI:** React 19 + Tailwind CSS 4
- **Database:** SQLite (better-sqlite3 / node:sqlite / sql.js)
- **Streaming:** Server-Sent Events (SSE)
- **Auth:** OAuth 2.0 (PKCE) + JWT + API Keys

---

## 📧 Links

- **Website:** [krouter.kodelyth.com](https://krouter.kodelyth.com)
- **GitHub:** [github.com/sifxprime/krouter](https://github.com/sifxprime/krouter)
- **Issues:** [github.com/sifxprime/krouter/issues](https://github.com/sifxprime/krouter/issues)
- **npm:** [`@sifxprime/krouter`](https://www.npmjs.com/package/@sifxprime/krouter)
- **Support:** [krouter@kodelyth.com](mailto:krouter@kodelyth.com) · [WhatsApp](https://wa.me/8801312365939)

---

## 🙏 Credits

kRouter is a hardened fork of the upstream **[decolua/9router](https://github.com/decolua/9router)**. Huge thanks to [@decolua](https://github.com/decolua) and the 9router contributors for the original project. ⭐ them on GitHub.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://krouter.kodelyth.com">Kodelyth AI Infrastructure</a></sub>
</div>
