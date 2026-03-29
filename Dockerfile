FROM node:24-alpine AS base

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Copy package.json files for all packages
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/

# Install all dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# ── Build frontend ──────────────────────────────────────────────────
FROM base AS frontend-builder

COPY packages/frontend/ packages/frontend/
RUN pnpm --filter frontend build

# ── Build backend ───────────────────────────────────────────────────
FROM base AS backend-builder

COPY packages/backend/ packages/backend/
RUN pnpm --filter backend build

# ── Production image ────────────────────────────────────────────────
FROM node:24-alpine AS production

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

RUN mkdir -p /etc/nginx-config /etc/nginx-certs /var/log/nginx-logs /var/www/acme-challenge

# Copy backend package.json and install production deps only
COPY --from=backend-builder /app/packages/backend/package.json ./
RUN pnpm install --prod --no-frozen-lockfile

# Copy backend build
COPY --from=backend-builder /app/packages/backend/dist ./dist
COPY --from=backend-builder /app/packages/backend/src/db/migrations ./src/db/migrations

# Copy frontend build into public/ for the backend to serve
COPY --from=frontend-builder /app/packages/frontend/dist ./public

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
