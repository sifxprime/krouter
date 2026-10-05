# Docker

Run kRouter in a container. Published image: [`sifxprime/krouter`](https://hub.docker.com/r/sifxprime/krouter) — multi-platform `linux/amd64` + `linux/arm64`. Also available via GitHub Container Registry at `ghcr.io/sifxprime/krouter:latest`.

---

# For users

## Quick start

```bash
KROUTER_PASSWORD="$(openssl rand -base64 18)" && echo "Dashboard password: $KROUTER_PASSWORD"
docker run -d \
  -p 20128:20128 \
  -e INITIAL_PASSWORD="${KROUTER_PASSWORD:?run the line above first}" \
  -v "$HOME/.krouter:/app/data" \
  -e DATA_DIR=/app/data \
  --name krouter \
  sifxprime/krouter:latest
```

App listens on port `20128`. Open: http://localhost:20128/dashboard

The first line makes a random password and prints it. Log in with it, then set your own under
**Settings → Security**; until you do, the password is whatever `INITIAL_PASSWORD` the container started with.
Under Docker the default `123456` is refused, because your browser's requests reach the container
from outside it. If `~/.krouter` already holds a password from an npm install, that one is used.

## Manage container

```bash
docker logs -f krouter        # view logs
docker stop krouter           # stop
docker start krouter          # start again
docker rm -f krouter          # remove
```

## Reset a forgotten password

The kRouter CLI is not in the image, so reset from inside the container (image 0.5.162 or newer):

```bash
docker exec krouter node scripts/reset-password.js
```

This clears the stored password. Log in with the `INITIAL_PASSWORD` the container was started with
(or start it again with a new one), then set your own under **Settings → Security**.

## Data persistence

```bash
-v "$HOME/.krouter:/app/data" \
-e DATA_DIR=/app/data
```

Without `DATA_DIR`, the app falls back to `~/.krouter/` (macOS/Linux) or `%APPDATA%\krouter\` (Windows). In the container, `DATA_DIR=/app/data` makes the bind mount work.

Data layout under `$DATA_DIR/`:

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite       # main SQLite database
│   └── backups/          # auto backups
└── ...                   # certs, logs, runtime configs
```

Host path: `$HOME/.krouter/db/data.sqlite`
Container path: `/app/data/db/data.sqlite`

## Update to latest

```bash
docker pull sifxprime/krouter:latest
docker rm -f krouter
# re-run both quick start lines; a new password is printed unless you set one under Settings → Security
```

---

# For developers

## Build image locally (test)

```bash
docker build -t krouter .

KROUTER_PASSWORD="$(openssl rand -base64 18)" && echo "Dashboard password: $KROUTER_PASSWORD"
docker run --rm -p 20128:20128 \
  -e INITIAL_PASSWORD="${KROUTER_PASSWORD:?run the line above first}" \
  -v "$HOME/.krouter:/app/data" \
  -e DATA_DIR=/app/data \
  krouter
```

## Publish (automatic via CI)

Push a git tag `v*` → GitHub Actions builds multi-platform (amd64+arm64) and pushes to:
- `ghcr.io/sifxprime/krouter:{version}` + `:latest` (e.g. `:0.5.161` — image tags have no `v`)
- `sifxprime/krouter:{version}` + `:latest`

The same tag also publishes npm (`npm-publish.yml`) and a GitHub Release.

```bash
git tag v<version> && git push origin v<version>
```

Workflow: `.github/workflows/docker-publish.yml`

> **Note for CI setup:** To publish to Docker Hub, ensure `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are set in the GitHub repository secrets. To publish to npm, the package owner must once add a Trusted Publisher for `@sifxprime/krouter` on npmjs.com (GitHub Actions, user `sifxprime`, repository `krouter`, workflow `npm-publish.yml`, no environment); until then the npm job fails with `E404` and opens an issue.
