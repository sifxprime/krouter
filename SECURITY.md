# Security Policy

kRouter sits between your coding tools and your AI providers, so it holds API keys
and OAuth tokens. We take reports seriously and would much rather hear about a
problem privately than read about it in public.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub:
**[Report a vulnerability](https://github.com/sifxprime/krouter/security/advisories/new)**
(Security tab → *Report a vulnerability*).

If you cannot use GitHub, email **krouter@kodelyth.com** with "SECURITY" in the subject.

Helpful to include:

- the kRouter version (`krouter --version`), OS and Node.js version
- what an attacker can do, and what they need first (network access, a local account, a malicious provider response…)
- steps to reproduce, or a proof of concept
- any logs, **with API keys and tokens removed**

We aim to acknowledge reports within a few days and will keep you updated until it is resolved.
With your permission we are glad to credit you in the release notes.

## Supported versions

Fixes land in the **latest release** on npm (`@sifxprime/krouter`). Please check
the issue still reproduces there before reporting:

```bash
npm i -g @sifxprime/krouter@latest
```

## Things worth knowing when assessing impact

These are deliberate design choices, not vulnerabilities on their own — but they
shape what a real attack looks like:

- **The dashboard binds to `0.0.0.0` by default**, so it is reachable from your local
  network. Run with `--host 127.0.0.1` to keep it to this machine.
- **The default dashboard password (`123456`) is refused for remote logins.** It only
  works from the machine kRouter runs on, and only until you set your own.
- **PII redaction fails closed.** When it is enabled and the Presidio sidecar is
  unreachable, requests are rejected (`503` / `502`) rather than sent unredacted.
- **Published packages are checked for secrets.** The build fails if a JWT secret,
  machine ID or SQLite database would be shipped.

## Upstream

kRouter is a fork of [decolua/9router](https://github.com/decolua/9router). If a
problem also affects upstream, please tell them too — or tell us and we will pass it on.
