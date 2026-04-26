#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.dev.yml"
SANDBOX_DB_NAME="${SANDBOX_DB_NAME:-zeroproof_sandbox}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-dev_password}"
MQTT_USERNAME="${MQTT_USERNAME:-auditor}"
MQTT_PASSWORD="${MQTT_PASSWORD:-mqtt_password}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required."
  exit 1
fi

if [ ! -f "$ROOT_DIR/mosquitto/config/passwd" ]; then
  echo "Generating sandbox MQTT password file..."
  mkdir -p "$ROOT_DIR/mosquitto/config"
  docker run --rm -v "$ROOT_DIR/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
    mosquitto_passwd -b -c /mosquitto/config/passwd "$MQTT_USERNAME" "$MQTT_PASSWORD" >/dev/null
  chmod 600 "$ROOT_DIR/mosquitto/config/passwd" 2>/dev/null || true
fi

echo "Starting sandbox dependencies (postgres, mosquitto, redis)..."
docker compose -f "$COMPOSE_FILE" up -d postgres mosquitto redis >/dev/null

echo "Recreating isolated sandbox database: $SANDBOX_DB_NAME"
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${SANDBOX_DB_NAME}' AND pid <> pg_backend_pid();" \
  >/dev/null
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres -d postgres -c \
  "DROP DATABASE IF EXISTS \"${SANDBOX_DB_NAME}\";" \
  >/dev/null
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres -d postgres -c \
  "CREATE DATABASE \"${SANDBOX_DB_NAME}\";" \
  >/dev/null

export NODE_ENV=development
export PORT="${PORT:-3000}"
export SESSION_SECRET="${SESSION_SECRET:-sandbox-session-secret-32-characters-minimum}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-sandbox-encryption-key-32-characters-min}"
export DEFAULT_ADMIN_PASSWORD="${DEFAULT_ADMIN_PASSWORD:-admin123!}"
export MQTT_BROKER="${MQTT_BROKER:-localhost}"
export MQTT_PORT="${MQTT_PORT:-1883}"
export MQTT_USERNAME
export MQTT_PASSWORD
export DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/${SANDBOX_DB_NAME}"

echo "Applying current Prisma schema to sandbox database..."
(
  cd "$ROOT_DIR/backend"
  pnpm exec prisma db push --skip-generate >/dev/null
)

echo "Running clean-start sandbox harness..."
(
  cd "$ROOT_DIR/backend"
  pnpm run test:sandbox "$@"
)
