# kRouter — Agent Skills

Drop-in skills for any AI agent (Claude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use kRouter for you.

> Tip: start with the **krouter** entry skill — it covers setup and links to all capability skills.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter/SKILL.md |
| Chat / code-gen | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-image/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter-web-fetch/SKILL.md |

## How to use

Paste to your AI (Claude, Cursor, ChatGPT, …):

```
Read this skill and use it: https://raw.githubusercontent.com/sifxprime/krouter/refs/heads/main/skills/krouter/SKILL.md
```

Then ask normally — *"generate an image of a cat"*, *"transcribe this URL"*, etc.

## Configure your shell once

```bash
export KROUTER_URL="http://localhost:20128"   # local default, or your VPS / tunnel URL
export KROUTER_KEY="sk-..."                   # from Dashboard → Endpoint → API Keys
```

The key is required whenever `KROUTER_URL` is remote (VPS, tunnel) or kRouter runs in Docker or behind a reverse proxy: kRouter only skips the key for a caller on the same machine that reaches it directly, and Docker's published port does not count (the request arrives from the Docker network). Even that local caller needs the key once **Require API key** is on (Endpoint page) or the server runs with `REQUIRE_API_KEY=true`.

Verify: `curl $KROUTER_URL/api/health` → `{"ok":true}`.

## Links

- Source: https://github.com/sifxprime/krouter
- Website: https://krouter.kodelyth.com
- Dashboard: `$KROUTER_URL/dashboard` on your own server
