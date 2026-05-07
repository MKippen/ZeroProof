# Backend image — built from the repo root so the build context can see
# `packages/*` workspace dependencies (e.g. @uguard/unifi-client).
FROM node:20-alpine

WORKDIR /repo

RUN apk add --no-cache openssl
RUN npm install -g pnpm

# Workspace manifests + lockfile first (for cache-friendly install layer).
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY backend/package.json backend/
COPY packages/unifi-client/package.json packages/unifi-client/

RUN pnpm install --frozen-lockfile

# Source for the lib + backend.
COPY packages/unifi-client packages/unifi-client/
COPY backend/prisma backend/prisma/
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src/

# Build lib first (backend imports its compiled output).
RUN pnpm --filter @uguard/unifi-client build

# Generate Prisma client and build backend.
WORKDIR /repo/backend
RUN pnpm exec prisma generate
RUN pnpm build

# Runtime user / dirs.
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs && \
    mkdir -p logs && \
    chown -R nodejs:nodejs /repo

USER nodejs

EXPOSE 3000

CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/index.js"]
