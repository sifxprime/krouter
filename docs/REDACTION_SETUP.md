# PII Redaction Setup (Presidio)

Redacts personally identifiable information from requests before they leave your
machine for any provider. Contributed by
[manindersarao](https://github.com/manindersarao) in
[PR #1](https://github.com/sifxprime/krouter/pull/1).

**It is off by default.** Nothing changes until you enable both toggles in the
dashboard. If you never turn it on, kRouter behaves exactly as it did before.

---

## How it works

```
your IDE  ->  kRouter  ->  redaction middleware  ->  Presidio sidecar
                                   |                       |
                                   |<---- redacted text ---'
                                   v
                            AI provider
```

The middleware pulls every piece of user text out of the request, sends it to a
local Presidio service, and substitutes the redacted result before the request
continues upstream. Presidio does the detection — an ML model for names,
emails, phone numbers, locations and card numbers, plus any regex patterns you
add yourself.

**Fail-closed by default.** If the sidecar is down, slow, or returns something
unusable, the request is *rejected* rather than forwarded unredacted. That is
the point of the feature: a redaction layer that quietly gives up is worse than
none, because you would trust it.

---

## Requirements

The sidecar is a Python service. It needs to be reachable from kRouter, and it
needs the spaCy `en_core_web_lg` language model (about 590 MB), fetched when you
install its requirements or build its image.

| Setup | Sidecar | Effort |
|---|---|---|
| Docker Compose | started for you | one command |
| npm / global install | you run it | a few minutes |

---

## Option 1 — Docker Compose

The compose file wires kRouter and the sidecar together on a private network
with a shared config volume. It builds both from source, so start from a clone:

```bash
git clone https://github.com/sifxprime/krouter.git && cd krouter
```

`KROUTER_INITIAL_PASSWORD` has no default on purpose — compose refuses to start
without it. Save a random one to `.env`, where compose reads it on every start;
the command prints it, and that is your dashboard password:

```bash
echo "KROUTER_INITIAL_PASSWORD='$(openssl rand -base64 18)'" > .env && cat .env
```

Then:

```bash
docker compose up -d
```

Open <http://localhost:20128/dashboard>, sign in with that password, and go to
**Presidio** in the sidebar.

> A previous version of this compose file pinned `INITIAL_PASSWORD=123456` to
> get past the default-password restriction. That restriction exists because a
> remote caller who guesses the public default gets a valid dashboard session,
> so the variable is now required rather than defaulted. Compose will refuse to
> start until you set it.

---

## Option 2 — npm or global install

kRouter itself has no Python dependency. Run the sidecar separately, on the same
machine or anywhere kRouter can reach.

The npm package does not include the sidecar, so fetch it first. It is three
small files plus a requirements list:

```bash
git clone --depth 1 https://github.com/sifxprime/krouter.git /tmp/krouter-sidecar
cd /tmp/krouter-sidecar/presidio-sidecar
```

**Run it with Docker** (no Python toolchain needed):

```bash
docker build -t krouter-presidio .
docker run -d --name presidio-sidecar -p 5001:5001 \
  -v "$HOME/.krouter/presidio:/app/config" krouter-presidio
```

**Or run it from source:**

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PRESIDIO_CONFIG_PATH="$HOME/.krouter/presidio/redaction_config.yaml" \
  uvicorn sidecar:app --host 127.0.0.1 --port 5001
```

Set `PRESIDIO_CONFIG_PATH` when running from source. The sidecar's own default is
the container path `/app/config/redaction_config.yaml`, which it cannot create on
a normal machine; pointing it at `~/.krouter/presidio/` also lets it read the
patterns you save from the dashboard.

> There is no prebuilt sidecar image on a registry yet, so both paths above
> build or run from the source you just cloned. The Docker Compose setup in
> Option 1 builds the sidecar image for you from its clone.

kRouter looks for the sidecar at `http://127.0.0.1:5001/redact` by default, so
with the commands above you can start it normally. If the sidecar runs anywhere
else, tell kRouter where:

```bash
export SIDECAR_URL="http://127.0.0.1:5001/redact"
krouter
```

kRouter saves custom patterns to `~/.krouter/presidio/redaction_config.yaml`
(`$DATA_DIR/presidio/` if you moved the data directory) the first time you save
them from the dashboard.

---

## Turning it on

Both toggles must be on before anything is redacted:

1. **Presidio Sidecar** — enables the middleware.
2. **PII Redaction** — enables ML-based detection.
3. **Custom Regex Patterns** — optional, opens the YAML editor so you can save
   your own patterns. The sidecar applies whatever is in the saved pattern file;
   switching this toggle off later does not unload patterns already saved.

Verify the sidecar is reachable before relying on it:

```bash
curl http://127.0.0.1:5001/health
```

---

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `SIDECAR_URL` | `http://127.0.0.1:5001/redact` | Where the sidecar lives. Docker Compose sets it to `http://presidio-sidecar:5001/redact`. |
| `REDACTION_ENABLED` | `true` | Set `false` to disable the middleware regardless of the dashboard toggles. |
| `REDACTION_FAIL_OPEN` | `false` | Set `true` to forward requests unredacted when redaction fails. Not recommended — it removes the guarantee. |
| `REDACTION_TIMEOUT_MS` | `15000` | Sidecar timeout. Presidio analyses texts serially, so long conversations need headroom. |
| `PRESIDIO_CONFIG_PATH` | `~/.krouter/presidio/redaction_config.yaml` | Pattern file kRouter writes. The sidecar reads the same variable, with its own default `/app/config/redaction_config.yaml`. Docker Compose points both at the shared volume. |

---

## Custom patterns

Dashboard → Presidio → the YAML editor. Patterns are validated before they are
written, and the sidecar hot-reloads them without a restart.

```yaml
rules:
  - entity: "INTERNAL_TICKET"
    pattern: "\\bJIRA-\\d{4,6}\\b"
    description: "Internal ticket references"
  - entity: "DEPLOY_TOKEN"
    pattern: "\\bdpl_[A-Za-z0-9]{32}\\b"
    description: "Deployment tokens"
```

Patterns are Python regexes — they run inside the sidecar, not in Node. Most
syntax is shared, but lookbehind and named-group syntax differ from JavaScript.

---

## What gets redacted

Covered endpoints: `/v1/chat/completions`, `/v1/messages`, `/v1/responses`,
`/v1/responses/compact`, the Ollama-compatible `/v1/api/chat`, and the
Gemini-format `generateContent` / `streamGenerateContent` route.

Covered fields:

- Chat messages, string and multimodal text blocks
- The Anthropic top-level `system` prompt
- Responses API `input` and `instructions`
- Tool traffic — `role:"tool"` results, `tool_result` blocks, tool descriptions
- `tool_calls[].function.arguments`, but only when the redacted string still
  parses as JSON; otherwise the original is kept, because a malformed tool call
  breaks the request for everyone while a leaked value affects one field

Not covered — these endpoints do not pass through the middleware:

- `/v1/embeddings`, `/v1/audio/*`, `/v1/images/generations`, `/v1/videos/*`
- `/v1/search` and `/v1/web/fetch`
- Binary content: images, PDFs, audio
- Anything already sent before you enabled the feature

---

## Troubleshooting

**Every request returns 503 after enabling it.** The sidecar is not reachable.
That is the fail-closed behaviour working. Check that the sidecar's `/health`
answers (`curl http://127.0.0.1:5001/health`) and that `SIDECAR_URL` matches
where it actually runs. The default is
`http://127.0.0.1:5001/redact`; the hostname `presidio-sidecar` only resolves
inside the compose network.

**Large requests time out.** Raise `REDACTION_TIMEOUT_MS`. Presidio processes
texts in a serial loop, so time scales with total conversation size.

**Custom patterns are not applied.** Confirm you saved them from the YAML editor
(it appears when the **Custom Regex Patterns** toggle is on), and that the
sidecar reads the file kRouter writes: both use `PRESIDIO_CONFIG_PATH`. In Docker
both containers must mount the same `presidio-config` volume.

**Redaction makes answers worse.** Expected in some cases — if a name or
identifier is meaningful to the task, removing it removes context. Narrow your
patterns rather than disabling redaction wholesale.

---

## A note on trust

This reduces accidental exposure. It is not a compliance control and should not
be treated as one. Detection is probabilistic: Presidio will miss things,
particularly unusual formats and non-English text. If data must never reach a
third party, do not send it — route to a local model instead.

---

## Reference

These sections previously lived in the main README. They moved here when the README
was trimmed so that an optional, Docker/Python-only feature no longer sat above the
Features and Providers sections on the GitHub and npm pages.

### Security: Fail-Closed by Default

**When redaction fails, requests are REJECTED** — not sent unredacted:

| Scenario | Behavior | Status Code |
|----------|----------|-------------|
| Sidecar timeout | Request rejected | 503 Service Unavailable |
| Sidecar down | Request rejected | 503 Service Unavailable |
| Sidecar error | Request rejected | 502 Bad Gateway |
| Invalid response | Request rejected | 502 Bad Gateway |

This ensures PII is never accidentally sent to AI providers when the redaction service is unavailable.

> **Important:** For production use, monitor redaction failures and set up alerts. See [Troubleshooting](#troubleshooting-presidio).

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDACTION_ENABLED` | `true` | Set `false` to disable the redaction middleware |
| `REDACTION_FAIL_OPEN` | `false` | **Security:** if true, allow requests on redaction failure (not recommended) |
| `SIDECAR_URL` | `http://127.0.0.1:5001/redact` | Presidio sidecar endpoint (`http://presidio-sidecar:5001/redact` under Docker Compose) |
| `PRESIDIO_CONFIG_PATH` | `~/.krouter/presidio/redaction_config.yaml` | Path to custom regex YAML config (`/app/config/redaction_config.yaml` under Docker Compose) |

> **Security Note:** Never set `REDACTION_FAIL_OPEN=true` in production unless you have a specific reason and understand the security implications.

### Testing Redaction

```bash
# Test the sidecar directly
curl -X POST http://localhost:5001/redact \
  -H "Content-Type: application/json" \
  -d '{
    "texts": [
      "Contact John Doe at john.doe@example.com or 555-123-4567",
      "OpenAI key: sk-abc123def456ghi789jkl012mno345pqr678"
    ]
  }'

# Example response. Labels depend on what is loaded: <OPENAI_KEY> needs an
# OPENAI_KEY rule in your saved patterns, and a custom rule can relabel a match.
# {
#   "redacted_texts": [
#     "Contact <PERSON> at <EMAIL_ADDRESS> or <PHONE_NUMBER>",
#     "OpenAI key: <OPENAI_KEY>"
#   ]
# }
```

### Performance

- **Latency:** Presidio analyses each text in turn, so the added time grows with the
  total size of the conversation. Raise `REDACTION_TIMEOUT_MS` (default 15000) for
  long threads.
- **Scalability:** The sidecar image runs Uvicorn with 4 workers; the from-source
  command above runs one.

### Troubleshooting Presidio

**Redaction failures appear as 503 errors:**

```bash
# Check sidecar status
docker compose ps presidio-sidecar

# Check sidecar logs
docker compose logs presidio-sidecar

# Check kRouter redaction logs
docker compose logs krouter | grep redaction
```

**Sidecar won't start:**

```bash
# Check if port 5001 is in use
lsof -i :5001

# Rebuild the sidecar container
docker compose build presidio-sidecar
docker compose up -d presidio-sidecar
```

**Redaction not working:**

1. Verify both toggles are on in the **Presidio** page of the dashboard sidebar
2. Check that `REDACTION_ENABLED` is not set to `false` (docker-compose.yml sets it to `true`)
3. Ensure sidecar is healthy: `curl http://localhost:5001/health`
4. Check kRouter logs for errors

**High false positive rate:**

- Add custom patterns in the YAML editor on the **Presidio** page
- Review and refine regex patterns
- Test patterns using the sidecar API directly

### Security Best Practices

1. **Never disable fail-closed in production** — Keep `REDACTION_FAIL_OPEN=false`
2. **Monitor redaction failures** — Set up alerts on 503/502 errors
3. **Review custom regex patterns** — Ensure they're specific and don't match valid content
4. **Keep sidecar updated** — Rebuild the sidecar image from an updated clone for security patches (there is no prebuilt image to pull)
5. **Use dedicated network** — Isolate redaction traffic when possible

### Customization

For advanced customization, see:
- **Full configuration guide:** [Configuration](#configuration)
- **Pattern examples:** [Custom patterns](#custom-patterns)
- **Fail-closed behaviour and limits:** [A note on trust](#a-note-on-trust)

---
