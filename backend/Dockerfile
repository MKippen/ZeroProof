# Backend image — built from the repo root so the build context can see
# `packages/*` workspace dependencies (e.g. @uguard/unifi-client).
FROM node:20-alpine

WORKDIR /repo

RUN apk add --no-cache openssl
RUN npm install -g pnpm

# Workspace manifests + lockfile first (for cache-friendly install layer).
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY backend/package.json backend/
COPY packages/unifi-client/package.json packages/unifi-client/

RUN pnpm install --frozen-lockfile

# Source for the lib + backend.
COPY packages/unifi-client packages/unifi-client/
COPY backend/prisma backend/prisma/
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src/

# CHANGELOG.md is the canonical source of the running version — the
# system-update service reads the first `## [x.y.z]` heading to know what
# we are right now. Copying it in (rather than baking via ARG) keeps the
# version in lockstep with the release notes, no parallel tracking.
COPY CHANGELOG.md ./CHANGELOG.md

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
