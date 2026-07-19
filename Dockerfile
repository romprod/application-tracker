# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install --yes --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/romprod/application-tracker"
LABEL org.opencontainers.image.licenses="Elastic-2.0"

ENV BACKUP_DIRECTORY=/app/backups \
    DATABASE_PATH=/app/data/application-tracker.sqlite \
    HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=3333

WORKDIR /app

RUN mkdir --parents /app/backups /app/data \
  && chown --recursive node:node /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3333/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "dist/server/server/http.js"]
