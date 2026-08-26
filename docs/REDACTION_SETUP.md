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
downloads a ~500 MB spaCy language model on first run.

| Setup | Sidecar | Effort |
|---|---|---|
| Docker Compose | started for you | one command |
| npm / global install | you run it | a few minutes |

---

## Option 1 — Docker Compose

The compose file wires kRouter and the sidecar together on a private network
with a shared config volume.

`INITIAL_PASSWORD` has no default on purpose. Set a real one first:

```bash
export KROUTER_INITIAL_PASSWORD="$(openssl rand -base64 24)"
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

kRouter itself has no Python dependency. Run the sidecar separately and point
kRouter at it.

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
uvicorn sidecar:app --host 127.0.0.1 --port 5001
```

> There is no prebuilt sidecar image on a registry yet, so both paths above
> build or run from the source you just cloned. The Docker Compose setup in
> Option 1 builds it for you and needs none of this.

Then tell kRouter where it is and start normally:

```bash
export SIDECAR_URL="http://127.0.0.1:5001/redact"
krouter
```

Config is read from `~/.krouter/presidio/redaction_config.yaml`, created on
first save from the dashboard.

---

## Turning it on

Both toggles must be on before anything is redacted:

1. **Presidio Sidecar** — enables the middleware.
2. **PII Redaction** — enables ML-based detection.
3. **Custom Regex Patterns** — optional, enables your own YAML patterns.

Verify the sidecar is reachable before relying on it:

```bash
curl http://127.0.0.1:5001/health
```

---

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `SIDECAR_URL` | `http://presidio-sidecar:5001/redact` | Where the sidecar lives. Override for non-Docker setups. |
| `REDACTION_ENABLED` | `true` | Set `false` to disable the middleware regardless of the dashboard toggles. |
| `REDACTION_FAIL_OPEN` | `false` | Set `true` to forward requests unredacted when redaction fails. Not recommended — it removes the guarantee. |
| `REDACTION_TIMEOUT_MS` | `15000` | Sidecar timeout. Presidio analyses texts serially, so long conversations need headroom. |
| `PRESIDIO_CONFIG_PATH` | `~/.krouter/presidio/redaction_config.yaml` | Pattern file. Docker Compose points this at the shared volume. |

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

Covered:

- Chat messages, string and multimodal text blocks
- The Anthropic top-level `system` prompt
- Responses API `input` and `instructions`
- Tool traffic — `role:"tool"` results, `tool_result` blocks, tool descriptions
- `tool_calls[].function.arguments`, but only when the redacted string still
  parses as JSON; otherwise the original is kept, because a malformed tool call
  breaks the request for everyone while a leaked value affects one field

Not covered — these endpoints do not pass through the middleware:

- `/v1/embeddings`, `/v1/audio/speech`, `/v1/images/generations`, `/v1/videos/*`
- Binary content: images, PDFs, audio
- Anything already sent before you enabled the feature

---

## Troubleshooting

**Every request returns 503 after enabling it.** The sidecar is not reachable.
That is the fail-closed behaviour working. Check `curl <SIDECAR_URL>` and that
`SIDECAR_URL` matches where it actually runs — the default hostname
`presidio-sidecar` only resolves inside the compose network.

**Large requests time out.** Raise `REDACTION_TIMEOUT_MS`. Presidio processes
texts in a serial loop, so time scales with total conversation size.

**Custom patterns are not applied.** Confirm the **Custom Regex Patterns**
toggle is on, and that the sidecar can read the config path. In Docker both
containers must mount the same `presidio-config` volume.

**Redaction makes answers worse.** Expected in some cases — if a name or
identifier is meaningful to the task, removing it removes context. Narrow your
patterns rather than disabling redaction wholesale.

---

## A note on trust

This reduces accidental exposure. It is not a compliance control and should not
be treated as one. Detection is probabilistic: Presidio will miss things,
particularly unusual formats and non-English text. If data must never reach a
third party, do not send it — route to a local model instead.
