<div align="center">
  <img src="./images/kodelyth-router.png" alt="kRouter — Kodelyth AI Infrastructure" width="320"/>

  # kRouter — Kodelyth AI Infrastructure

  **The universal AI router that saves 20–40% tokens and never stops working.**

  Connect Claude Code, Cursor, Antigravity, Kiro, Copilot, Codex, OpenCode, Cline, OpenClaw, and any OpenAI-compatible client to **40+ AI providers and 100+ models** through a single local endpoint. Route intelligently. Fall back instantly. Save tokens automatically.

  [![npm](https://img.shields.io/npm/v/@sifxprime/krouter.svg)](https://www.npmjs.com/package/@sifxprime/krouter)
  [![GitHub](https://img.shields.io/badge/github-sifxprime%2Fkrouter-blue?logo=github)](https://github.com/sifxprime/krouter)
  [![Website](https://img.shields.io/badge/website-krouter.kodelyht.com-orange)](https://krouter.kodelyht.com)
  [![License](https://img.shields.io/npm/l/@sifxprime/krouter.svg)](https://github.com/sifxprime/krouter/blob/main/LICENSE)

  **[🌐 Website & Full Docs — krouter.kodelyht.com](https://krouter.kodelyht.com)**

  [🚀 Quick Start](#-quick-start) • [💡 Features](#-features) • [📖 Setup](#-setup-guide) • [🌐 Supported Providers](#-supported-providers)

---

### Contributors Note

For contributors: Ensure your git identity is properly configured before committing to ensure accurate attribution in pull requests.
</div>

---

## 🚀 Quick Start

```bash
# Install globally from npm
npm install -g @sifxprime/krouter

# Run in background (tray mode)
krouter -t
```

Dashboard opens at **[http://localhost:20128/dashboard](http://localhost:20128/dashboard)**.

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

To enable automatic PII redaction before sending requests to AI providers:

```bash
docker-compose up -d
```

See [docs/REDACTION_SETUP.md](docs/REDACTION_SETUP.md) for full configuration and customization options.

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

kRouter includes optional PII (Personally Identifiable Information) redaction using Microsoft Presidio, protecting your sensitive data before it reaches AI providers.

### What Gets Redacted

**Built-in ML Detection:**
- Names (PERSON)
- Email addresses (EMAIL_ADDRESS)
- Phone numbers (PHONE_NUMBER)
- Locations and addresses (LOCATION, GPE)
- Organizations (ORG)
- Credit card numbers (CREDIT_CARD)
- IP addresses (IP_ADDRESS)
- URLs (URL)
- Social Security Numbers
- Dates and more...

**Custom Regex Patterns:**
- OpenAI API keys (`sk-proj-*`)
- GitHub personal access tokens
- AWS access keys
- Slack webhook URLs
- Internal IDs and custom patterns

### How It Works

```
┌─────────────┐
│  Your CLI   │  Input: "My name is John Doe, email: john@company.com"
│   Tool      │
└──────┬──────┘
       │
       ↓
┌─────────────────────────────────────────────┐
│         kRouter Redaction Middleware       │
│  1. Extract text from messages             │
│  2. Send to Presidio sidecar               │
│  3. Receive redacted text                  │
│  4. Replace in request body                │
└──────┬──────────────────────────────────────┘
       │
       ↓
  Output: "My name is <PERSON>, email: <EMAIL>"
       │
       ↓
┌─────────────────────────────────────────────┐
│           AI Provider                       │
│  (Never sees actual PII)                   │
└─────────────────────────────────────────────┘
```

### Security: Fail-Closed by Default

**When redaction fails, requests are REJECTED** — not sent unredacted:

| Scenario | Behavior | Status Code |
|----------|----------|-------------|
| Sidecar timeout | Request rejected | 503 Service Unavailable |
| Sidecar down | Request rejected | 503 Service Unavailable |
| Sidecar error | Request rejected | 502 Bad Gateway |
| Invalid response | Request rejected | 502 Bad Gateway |

This ensures PII is never accidentally sent to AI providers when the redaction service is unavailable.

> ⚠️ **Important:** For production use, monitor redaction failures and set up alerts. See [Troubleshooting](#troubleshooting-presidio).

### Quick Start (Docker)

```bash
# Start kRouter with Presidio sidecar
docker-compose up -d

# Open dashboard
open http://localhost:20128/dashboard
```

The Presidio sidecar runs in a separate container and communicates with kRouter over the Docker network.

### Configuration

Enable and configure PII redaction in the dashboard:

1. Go to **Dashboard → Settings → Presidio**
2. Toggle **Presidio Sidecar** to enable
3. Toggle **PII Redaction** to activate
4. (Optional) Toggle **Custom Regex Patterns** and edit YAML

#### Example Custom Regex YAML

```yaml
rules:
  - entity: "INTERNAL_ID"
    pattern: "USER-[0-9]{6}"
    description: "Internal user ID format"

  - entity: "PROJECT_KEY"
    pattern: "PROJ_[A-Z]{3}-[0-9]{4}"
    description: "Project identifier"

  - entity: "DEPLOY_TOKEN"
    pattern: "glpat-[a-zA-Z0-9_-]{20}"
    description: "GitLab deployment token"
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDACTION_ENABLED` | `true` | Enable/disable redaction middleware |
| `REDACTION_FAIL_OPEN` | `false` | **⚠️ SECURITY:** If true, allow requests on redaction failure (not recommended) |
| `SIDECAR_URL` | `http://presidio-sidecar:5001/redact` | Presidio sidecar endpoint |
| `PRESIDIO_CONFIG_PATH` | `/app/redaction_config.yaml` | Path to custom regex YAML config |

> 🔒 **Security Note:** Never set `REDACTION_FAIL_OPEN=true` in production unless you have a specific reason and understand the security implications.

### Testing Redaction

```bash
# Test the sidecar directly
curl -X POST http://localhost:5001/redact \
  -H "Content-Type: application/json" \
  -d '{
    "texts": [
      "Contact John Doe at john.doe@example.com or 555-123-4567",
      "OpenAI key: sk-proj-abc123def456ghi789jkl"
    ]
  }'

# Response:
# {
#   "redacted_texts": [
#     "Contact <PERSON> at <EMAIL_ADDRESS> or <PHONE_NUMBER>",
#     "OpenAI key: <OPENAI_KEY>"
#   ]
# }
```

### Performance

- **Latency:** < 2ms per request (within Docker network)
- **Overhead:** Minimal, typically < 10ms end-to-end
- **Scalability:** Concurrent processing with Uvicorn workers

### Troubleshooting Presidio

**Redaction failures appear as 503 errors:**

```bash
# Check sidecar status
docker-compose ps presidio-sidecar

# Check sidecar logs
docker-compose logs presidio-sidecar

# Check kRouter redaction logs
docker-compose logs krouter | grep redaction
```

**Sidecar won't start:**

```bash
# Check if port 5001 is in use
lsof -i :5001

# Rebuild the sidecar container
docker-compose build presidio-sidecar
docker-compose up -d presidio-sidecar
```

**Redaction not working:**

1. Verify Presidio toggles are enabled in Dashboard → Settings → Presidio
2. Check that `REDACTION_ENABLED=true` in docker-compose.yml
3. Ensure sidecar is healthy: `curl http://localhost:5001/health`
4. Check kRouter logs for errors

**High false positive rate:**

- Add custom patterns to YAML config in Dashboard → Settings → Presidio
- Review and refine regex patterns
- Test patterns using the sidecar API directly

### Security Best Practices

1. **Never disable fail-closed in production** — Keep `REDACTION_FAIL_OPEN=false`
2. **Monitor redaction failures** — Set up alerts on 503/502 errors
3. **Review custom regex patterns** — Ensure they're specific and don't match valid content
4. **Keep sidecar updated** — Pull latest image for security patches
5. **Use dedicated network** — Isolate redaction traffic when possible

### Customization

For advanced customization, see:
- **Full configuration guide:** [docs/REDACTION_SETUP.md](docs/REDACTION_SETUP.md)
- **Pattern examples:** [presidio-sidecar/README.md](presidio-sidecar/README.md)
- **Security considerations:** [docs/REDACTION_FAIL_CLOSED.md](docs/REDACTION_FAIL_CLOSED.md)

---

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

📖 **Full feature guide with screenshots → [krouter.kodelyht.com](https://krouter.kodelyht.com)**

---

## 🛠️ Supported CLI Tools

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude Code</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/openclaw.png" width="60" alt="OpenClaw"/><br/>
        <b>OpenClaw</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/opencode.png" width="60" alt="OpenCode"/><br/>
        <b>OpenCode</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continue</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/droid.png" width="60" alt="Droid"/><br/>
        <b>Droid</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/roo.png" width="60" alt="Roo"/><br/>
        <b>Roo</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/copilot.png" width="60" alt="Copilot"/><br/>
        <b>Copilot</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/kilocode.png" width="60" alt="Kilo Code"/><br/>
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

📖 **Full provider setup guide → [krouter.kodelyht.com](https://krouter.kodelyht.com)**

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

📖 **Detailed integration guide (Claude Code, Cursor, Cline, and more) → [krouter.kodelyht.com](https://krouter.kodelyht.com)**

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `20128` | Server port |
| `HOSTNAME` | `127.0.0.1` | Bind host |
| `DATA_DIR` | `~/.krouter` | Data directory (SQLite, certs, cache) |
| `NODE_ENV` | `production` | Runtime mode |
| `REQUIRE_API_KEY` | `false` | Enforce Bearer API key on `/v1/*` (recommended for public deploys) |
| `AUTH_COOKIE_SECURE` | `false` | Force `Secure` cookie (set behind HTTPS reverse proxy) |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | — | Outbound proxy config |

Full env reference → **[krouter.kodelyht.com](https://krouter.kodelyht.com)**

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

**Full troubleshooting guide → [krouter.kodelyht.com](https://krouter.kodelyht.com)**

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

- **Website:** [krouter.kodelyht.com](https://krouter.kodelyht.com)
- **GitHub:** [github.com/sifxprime/krouter](https://github.com/sifxprime/krouter)
- **Issues:** [github.com/sifxprime/krouter/issues](https://github.com/sifxprime/krouter/issues)
- **npm:** [`@sifxprime/krouter`](https://www.npmjs.com/package/@sifxprime/krouter)

---

## 🙏 Credits

kRouter is a hardened fork of the upstream **[decolua/9router](https://github.com/decolua/9router)**. Huge thanks to [@decolua](https://github.com/decolua) and the 9router contributors for the original project. ⭐ them on GitHub.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://krouter.kodelyht.com">Kodelyth AI Infrastructure</a></sub>
</div>
