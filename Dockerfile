ARG NODE_IMAGE=docker.io/library/node:24-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f

FROM ${NODE_IMAGE} AS base

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Copy package.json files for all packages
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
COPY packages/status-page/package.json packages/status-page/

# Install all dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# ── Build frontend ──────────────────────────────────────────────────
FROM base AS frontend-builder

COPY packages/frontend/ packages/frontend/
RUN pnpm --filter frontend build

# ── Build public status page ────────────────────────────────────────
FROM base AS status-page-builder

COPY packages/status-page/ packages/status-page/
RUN pnpm --filter status-page build

# ── Build backend ───────────────────────────────────────────────────
FROM base AS backend-builder

COPY packages/backend/ packages/backend/
RUN pnpm --filter backend build

# ── Production image ────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS production

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

RUN apk add --no-cache nginx && \
    mkdir -p /var/lib/gateway/tls && \
    corepack enable && \
    corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy backend package.json and install production deps only
COPY --from=backend-builder /app/packages/backend/package.json ./
RUN pnpm install --prod --no-frozen-lockfile

# Copy backend build
COPY --from=backend-builder /app/packages/backend/dist ./dist
COPY --from=backend-builder /app/packages/backend/src/db/migrations ./src/db/migrations
COPY config/update-trust/update-signing-public-key.pem ./dist/lib/update-signing-public-key.pem

# Copy proto file (loaded at runtime by @grpc/proto-loader)
COPY proto/ ./proto/

# Copy frontend build into public/ for the backend to serve
COPY --from=frontend-builder /app/packages/frontend/dist ./public

# Copy public status page build into status-public/
COPY --from=status-page-builder /app/packages/status-page/dist ./status-public

ENV NODE_ENV=production
ENV PORT=3000
ENV GRPC_PORT=9443

EXPOSE 3000
EXPOSE 9443

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
