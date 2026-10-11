# Setpoint in one container: Node 24 runs the server's TypeScript directly (no server build step)
# and serves the API, the live stream and the built web app from one origin. SQLite lives in /data,
# a mounted volume; migrations run at start. Build from a commit, not a working tree:
#
#   git archive --format=tar HEAD | docker build -t setpoint:$(git rev-parse --short HEAD) -
#
# OPERATIONS.md has the variables, the volume, the CLI and the import from v1.
ARG NODE_VERSION=24.19.0

# The web app, built with every workspace's dev dependencies (Vite, TypeScript).
FROM node:${NODE_VERSION}-slim AS web
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY shared shared
COPY web web
RUN npm run build -w web

# The server: production dependencies only. better-sqlite3 ships prebuilt glibc binaries, so install
# scripts are skipped and the image needs no compiler.
FROM node:${NODE_VERSION}-slim
ENV NODE_ENV=production \
    SETPOINT_DATA_DIR=/data \
    SETPOINT_WEB_DIR=/app/web/dist \
    SETPOINT_PORT=7430 \
    npm_config_cache=/tmp/npm \
    npm_config_update_notifier=false
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w server -w shared \
    && npm cache clean --force \
    && rm -rf /tmp/npm \
    && mkdir /data \
    && chown node:node /data
COPY shared/src shared/src
COPY server/src server/src
COPY server/drizzle server/drizzle
COPY --from=web /src/web/dist web/dist
USER node
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.SETPOINT_PORT}/health`, {signal: AbortSignal.timeout(4000)}).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "server/src/server.ts"]
