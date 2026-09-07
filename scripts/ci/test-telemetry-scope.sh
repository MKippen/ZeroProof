#!/usr/bin/env bash
# Verify both fresh and historical upgrades in disposable PostgreSQL databases.
# Caller DATABASE_URL is deliberately ignored; operator services are never used.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
fixture="zeroproof-telemetry-scope-$RANDOM-$$"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/zeroproof-telemetry-scope.XXXXXX")
cleanup() {
    docker rm -fv "$fixture" > /dev/null 2>&1 || true
    rm -rf -- "$fixture_dir"
}
trap cleanup EXIT

if [ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]; then
    echo "Telemetry integration tests require Node.js 24." >&2
    exit 1
fi
fixture_password=$(openssl rand -hex 24)
docker run --detach --name "$fixture" \
    --label zeroproof.fixture=telemetry-scope \
    --publish 127.0.0.1::5432 \
    --env POSTGRES_USER=telemetry_fixture \
    --env POSTGRES_DB=telemetry_fresh \
    --env "POSTGRES_PASSWORD=$fixture_password" \
    postgres:15-alpine > /dev/null
ready=false
for _ in {1..30}; do
    if docker exec "$fixture" pg_isready -U telemetry_fixture -d telemetry_fresh > /dev/null 2>&1; then
        ready=true
        break
    fi
    sleep 1
done
[ "$ready" = true ] || { docker logs "$fixture"; exit 1; }
fixture_port=$(docker inspect "$fixture" --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}')
fixture_database_prefix="postgresql://telemetry_fixture:$fixture_password@127.0.0.1:$fixture_port"
export TELEMETRY_SCOPE_FIXTURE=isolated-postgres
export NODE_ENV=production
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
export SESSION_SECRET ENCRYPTION_KEY
export DEFAULT_ADMIN_PASSWORD=
export MQTT_BROKER=127.0.0.1 MQTT_PORT=1 MQTT_USERNAME=fixture MQTT_PASSWORD=fixture-unused
export CORS_ORIGIN=
prisma="$ROOT/backend/node_modules/.bin/prisma"
tsx="$ROOT/backend/node_modules/.bin/tsx"

# Migrate a new database through the complete release history.
export DATABASE_URL="$fixture_database_prefix/telemetry_fresh"
cd "$fixture_dir"
"$prisma" migrate deploy --schema "$ROOT/backend/prisma/schema.prisma"
"$tsx" "$ROOT/scripts/ci/test-telemetry-scope.ts" verify-fresh

# Recreate the exact prior 13-migration history, then seed old-format rows.
# These checked-in migrations are immutable; no git history/network is needed.
baseline="$fixture_dir/baseline"
mkdir -p "$baseline/migrations"
cp "$ROOT/backend/prisma/schema.prisma" "$baseline/schema.prisma"
cp "$ROOT/backend/prisma/migrations/migration_lock.toml" "$baseline/migrations/"
baseline_count=0
for migration in "$ROOT"/backend/prisma/migrations/*/; do
    name=$(basename "$migration")
    if [ "${name:0:14}" -lt 20260530000000 ]; then
        cp -R "$migration" "$baseline/migrations/$name"
        baseline_count=$((baseline_count + 1))
    fi
done
[ "$baseline_count" = 13 ] || { echo "Expected the reviewed 13-migration baseline; found $baseline_count." >&2; exit 1; }
docker exec "$fixture" createdb -U telemetry_fixture telemetry_upgrade
export DATABASE_URL="$fixture_database_prefix/telemetry_upgrade"
"$prisma" migrate deploy --schema "$baseline/schema.prisma"
"$tsx" "$ROOT/scripts/ci/test-telemetry-scope.ts" seed-legacy
"$prisma" migrate deploy --schema "$ROOT/backend/prisma/schema.prisma"
"$tsx" "$ROOT/scripts/ci/test-telemetry-scope.ts" verify-upgrade
echo "Fresh and historical telemetry-scope migration fixtures passed."
