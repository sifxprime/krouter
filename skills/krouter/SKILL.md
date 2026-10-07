---
name: krouter
description: Entry point for kRouter — local/remote AI gateway with OpenAI-compatible REST for chat, image, TTS, embeddings, web search, web fetch. Use when the user mentions kRouter, KROUTER_URL, or wants AI without writing provider boilerplate. This skill covers setup + indexes capability skills; fetch the relevant capability SKILL.md from the URLs below when needed.
---

# kRouter

Local/remote AI gateway exposing OpenAI-compatible REST. One key, many providers, auto-fallback.

## Setup

```bash
export KROUTER_URL="http://localhost:20128"      # or VPS / tunnel URL
export KROUTER_KEY="sk-..."                      # from Dashboard → Endpoint → API Keys
```

All requests: `${KROUTER_URL}/v1/...` with header `Authorization: Bearer ${KROUTER_KEY}` (`x-api-key` also works). The key is required whenever `KROUTER_URL` is remote (VPS, tunnel) or kRouter runs in Docker or behind a reverse proxy, including the `/v1/models` calls below: only a caller on the same machine that reaches kRouter directly may skip it, and Docker's published port does not count (the request arrives from the Docker network). Even that local caller needs the key once **Require API key** is on (Endpoint page) or the server runs with `REQUIRE_API_KEY=true`.

Verify: `curl $KROUTER_URL/api/health` → `{"ok":true}`

## Discover models

```bash
curl $KROUTER_URL/v1/models                  # chat/LLM (default)
curl $KROUTER_URL/v1/models/image            # image-gen
curl $KROUTER_URL/v1/models/tts              # text-to-speech
curl $KROUTER_URL/v1/models/embedding        # embeddings
curl $KROUTER_URL/v1/models/web              # web search + fetch (entries have `kind` field)
curl $KROUTER_URL/v1/models/stt              # speech-to-text
curl $KROUTER_URL/v1/models/image-to-text    # vision
```

Use `data[].id` as `model` field in requests. Combos appear with `owned_by:"combo"`. Exception: web search/fetch ids (`tavily/search`) are sent without the `/search` or `/fetch` suffix; see those skills.

Response shape:
```json
{ "object": "list", "data": [
  { "id": "openai/gpt-5", "object": "model", "owned_by": "openai" },
  { "id": "tavily/search", "object": "model", "kind": "webSearch", "owned_by": "tavily" }
]}
```

## Capability skills

When the user needs a specific capability, fetch that skill's `SKILL.md` from its raw URL:

| Capability | Raw URL |
|---|---|
| Chat / code-gen | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-image/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-web-fetch/SKILL.md |

## Errors

- 401 → set/refresh `KROUTER_KEY` (Dashboard → Endpoint → API Keys)
- 400 `Invalid model format` → check `model` exists in `/v1/models/<kind>`
- 503 `All accounts unavailable` → wait `retry-after` or add another provider account
