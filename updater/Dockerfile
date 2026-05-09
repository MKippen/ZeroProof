# ZeroProof updater sidecar.
#
# Privileged container that orchestrates self-upgrades on behalf of the
# backend. Receives HMAC-signed apply requests on a loopback HTTP port,
# shells out to scripts/upgrade.sh in the mounted working tree.
#
# Trust boundary: this image gets the Docker socket. Keep deps minimal so
# the attack surface stays small. Only what upgrade.sh needs to run.

FROM node:20-alpine AS build

WORKDIR /build
COPY updater/package.json updater/tsconfig.json ./
COPY updater/src ./src
RUN npm install --no-audit --no-fund && npx tsc

FROM node:20-alpine
# bash:        upgrade.sh shebang
# git:         scripts/upgrade.sh fetches tags, checks out refs
# curl:        upgrade.sh's health-check loop
# docker-cli:  upgrade.sh runs `docker compose up -d --build`
# docker-cli-compose: provides the compose v2 plugin
RUN apk add --no-cache bash git curl docker-cli docker-cli-compose

WORKDIR /app
COPY --from=build /build/dist ./dist
COPY --from=build /build/package.json ./package.json
# Same source-of-truth pattern as the backend image: copy CHANGELOG.md
# in so /version reads the running release from the same file the
# backend reads, no parallel version tracking.
COPY CHANGELOG.md ./CHANGELOG.md

# Run as root inside the container — we need to talk to the Docker socket
# and write into /var/run/zeroproof. The socket itself is the privilege
# boundary; user-level isolation here doesn't add meaningful protection.

EXPOSE 9090
CMD ["node", "dist/index.js"]
