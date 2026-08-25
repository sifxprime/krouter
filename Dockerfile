# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS base
WORKDIR /app

FROM base AS builder

RUN apk --no-cache upgrade && apk --no-cache add python3 make g++ linux-headers

COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm install

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="9router"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/custom-server.js ./custom-server.js
COPY --from=builder /app/server-peer-patch.js ./server-peer-patch.js
COPY --from=builder /app/open-sse ./open-sse
# Copy Presidio config and init script
COPY --from=builder /app/presidio-sidecar/redaction_config.yaml ./presidio-sidecar/redaction_config.yaml
COPY --from=builder /app/scripts/init-presidio-config.sh ./scripts/init-presidio-config.sh
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=builder /app/src/mitm ./src/mitm
# dns/dnsConfig.js requires this from outside src/mitm. It is not reachable from
# the Next app graph either, so nothing else pulls it into the image — without
# this line the MITM child process dies with MODULE_NOT_FOUND on start.
# tests/unit/docker-mitm-packaging.test.js fails if another such require appears.
COPY --from=builder /app/src/shared/constants/mitmToolHosts.js ./src/shared/constants/mitmToolHosts.js
# Standalone node_modules may omit deps only required by the MITM child process.
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge
# Ensure `next` is available at runtime in case tracing did not include it.
COPY --from=builder /app/node_modules/next ./node_modules/next
# sql.js loads dist/sql-wasm.wasm by path at runtime; module tracing only follows JS
# imports, so the last-resort pure-JS DB driver aborted with ENOENT on the missing
# binary — the container then had no working database at all. upstream 27f3710c
COPY --from=builder /app/node_modules/sql.js ./node_modules/sql.js

RUN mkdir -p /app/data && chown -R node:node /app && \
  mkdir -p /app/data-home && chown node:node /app/data-home && \
  ln -sf /app/data-home /root/.9router 2>/dev/null || true

# Fix permissions at runtime (handles mounted volumes)
RUN apk --no-cache upgrade && apk --no-cache add su-exec && \
  printf '#!/bin/sh\n# Presidio config init runs ONLY when the sidecar deployment is in use.\n# docker-compose sets PRESIDIO_CONFIG_PATH for that setup; without it this\n# image behaves exactly as it did before the feature was added, instead of\n# running an extra root-owned script on every start for every user.\nif [ -n "$PRESIDIO_CONFIG_PATH" ] && [ -f /app/scripts/init-presidio-config.sh ]; then\n  /app/scripts/init-presidio-config.sh || echo "[entrypoint] presidio config init failed, continuing"\n  chown -R node:node /app/config 2>/dev/null\nfi\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec su-exec node "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
