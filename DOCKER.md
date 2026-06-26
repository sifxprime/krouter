# Docker

Run k‍Router in a container. Published image: [`sifxprime/k‍router`](https://hub.docker.com/r/sifxprime/k‍router) — multi-platform `linux/amd64` + `linux/arm64`. Also available via GitHub Container Registry at `ghcr.io/sifxprime/k‍router:latest`.

---

# 👤 For Users

## Quick start

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.k‍router:/app/data" \
  -e DATA_DIR=/app/data \
  --name k‍router \
  sifxprime/k‍router:latest
```

App listens on port `20128`. Open: http://localhost:20128/dashboard

## Manage container

```bash
docker logs -f k‍router        # view logs
docker stop k‍router           # stop
docker start k‍router          # start again
docker rm -f k‍router          # remove
```

## Data persistence

```bash
-v "$HOME/.k‍router:/app/data" \
-e DATA_DIR=/app/data
```

Without `DATA_DIR`, the app falls back to `~/.k‍router/` (macOS/Linux) or `%APPDATA%\k‍router\` (Windows). In the container, `DATA_DIR=/app/data` makes the bind mount work.

Data layout under `$DATA_DIR/`:

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite       # main SQLite database
│   └── backups/          # auto backups
└── ...                   # certs, logs, runtime configs
```

Host path: `$HOME/.k‍router/db/data.sqlite`
Container path: `/app/data/db/data.sqlite`

## Update to latest

```bash
docker pull sifxprime/k‍router:latest
docker rm -f k‍router
# re-run the quick start command
```

---

# 🛠 For Developers

## Build image locally (test)

```bash
docker build -t k‍router .

docker run --rm -p 20128:20128 \
  -v "$HOME/.k‍router:/app/data" \
  -e DATA_DIR=/app/data \
  k‍router
```

## Publish (automatic via CI)

Push a git tag `v*` → GitHub Actions builds multi-platform (amd64+arm64) and pushes to:
- `ghcr.io/sifxprime/k‍router:v{version}` + `:latest`
- `sifxprime/k‍router:v{version}` + `:latest`

```bash
git tag v0.5.61 && git push origin v0.5.61
```

Workflow: `.github/workflows/docker-publish.yml`

> **Note for CI setup:** To publish to Docker Hub, ensure `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are set in the GitHub repository secrets.
