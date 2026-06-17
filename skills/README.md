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
export KROUTER_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

Verify: `curl $KROUTER_URL/api/health` → `{"ok":true}`.

## Links

- Source: https://github.com/sifxprime/krouter
- Dashboard: https://krouter.com
