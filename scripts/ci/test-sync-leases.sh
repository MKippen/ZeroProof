#!/usr/bin/env bash
# Lease and sync recovery tests always create their own databases/host ports.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
fixture="zeroproof-sync-leases-$RANDOM-$$"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/zeroproof-sync-leases.XXXXXX")
cleanup() {
    docker rm -fv "$fixture" > /dev/null 2>&1 || true
    rm -rf -- "$fixture_dir"
}
trap cleanup EXIT

if [ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]; then
    echo "Sync lease integration tests require Node.js 24." >&2
    exit 1
fi
fixture_password=$(openssl rand -hex 24)
docker run --detach --name "$fixture" \
    --label zeroproof.fixture=sync-leases \
    --publish 127.0.0.1::5432 \
    --env POSTGRES_USER=sync_fixture \
    --env POSTGRES_DB=sync_fresh \
    --env "POSTGRES_PASSWORD=$fixture_password" \
    postgres:15-alpine > /dev/null
ready=false
for _ in {1..30}; do
    if docker exec "$fixture" pg_isready -U sync_fixture -d sync_fresh > /dev/null 2>&1; then
        ready=true
        break
    fi
    sleep 1
done
[ "$ready" = true ] || { docker logs "$fixture"; exit 1; }
fixture_port=$(docker inspect "$fixture" --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}')
fixture_database_prefix="postgresql://sync_fixture:$fixture_password@127.0.0.1:$fixture_port"
export SYNC_LEASE_FIXTURE=isolated-postgres
export NODE_ENV=production
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
export SESSION_SECRET ENCRYPTION_KEY
export DEFAULT_ADMIN_PASSWORD=
export MQTT_BROKER=127.0.0.1 MQTT_PORT=1 MQTT_USERNAME=fixture MQTT_PASSWORD=fixture-unused
export CORS_ORIGIN=
prisma="$ROOT/backend/node_modules/.bin/prisma"
tsx="$ROOT/backend/node_modules/.bin/tsx"

cd "$fixture_dir"
export DATABASE_URL="$fixture_database_prefix/sync_fresh"
"$prisma" migrate deploy --schema "$ROOT/backend/prisma/schema.prisma"
"$tsx" "$ROOT/scripts/ci/test-sync-leases.ts" verify-fresh

# Preserve the reviewed pre-lease history, including immutable telemetry scopes.
baseline="$fixture_dir/baseline"
mkdir -p "$baseline/migrations"
cp "$ROOT/backend/prisma/schema.prisma" "$baseline/schema.prisma"
cp "$ROOT/backend/prisma/migrations/migration_lock.toml" "$baseline/migrations/"
baseline_count=0
for migration in "$ROOT"/backend/prisma/migrations/*/; do
    name=$(basename "$migration")
    if [ "${name:0:14}" -lt 20260906000101 ]; then
        cp -R "$migration" "$baseline/migrations/$name"
        baseline_count=$((baseline_count + 1))
    fi
done
[ "$baseline_count" = 14 ] || { echo "Expected the reviewed 14-migration baseline; found $baseline_count." >&2; exit 1; }
docker exec "$fixture" createdb -U sync_fixture sync_upgrade
export DATABASE_URL="$fixture_database_prefix/sync_upgrade"
"$prisma" migrate deploy --schema "$baseline/schema.prisma"
"$tsx" "$ROOT/scripts/ci/test-sync-leases.ts" seed-legacy
"$prisma" migrate deploy --schema "$ROOT/backend/prisma/schema.prisma"
"$tsx" "$ROOT/scripts/ci/test-sync-leases.ts" verify-upgrade
echo "Fresh and historical sync lease fixtures passed."
