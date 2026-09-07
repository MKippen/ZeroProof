#!/usr/bin/env bash
# Run the real API/session middleware against a new, disposable PostgreSQL DB.
# Always replace caller connection settings; never touch an operator database.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
fixture="zeroproof-auth-sessions-$RANDOM-$$"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/zeroproof-auth-sessions.XXXXXX")
cleanup() {
    docker rm -fv "$fixture" > /dev/null 2>&1 || true
    rm -rf -- "$fixture_dir"
}
trap cleanup EXIT

if [ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]; then
    echo "Authentication integration tests require Node.js 24." >&2
    exit 1
fi
fixture_password=$(openssl rand -hex 24)
docker run --detach --name "$fixture" \
    --label zeroproof.fixture=auth-sessions \
    --publish 127.0.0.1::5432 \
    --env POSTGRES_USER=auth_fixture \
    --env POSTGRES_DB=auth_fixture \
    --env "POSTGRES_PASSWORD=$fixture_password" \
    postgres:15-alpine > /dev/null
ready=false
for _ in {1..30}; do
    if docker exec "$fixture" pg_isready -U auth_fixture -d auth_fixture > /dev/null 2>&1; then
        ready=true
        break
    fi
    sleep 1
done
[ "$ready" = true ] || { docker logs "$fixture"; exit 1; }
fixture_port=$(docker inspect "$fixture" --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}')
export DATABASE_URL="postgresql://auth_fixture:$fixture_password@127.0.0.1:$fixture_port/auth_fixture"
export AUTH_SESSION_FIXTURE=isolated-postgres
export AUTH_SESSION_FIXTURE_DIR="$fixture_dir"
export NODE_ENV=production
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
export SESSION_SECRET ENCRYPTION_KEY
export DEFAULT_ADMIN_PASSWORD=
export MQTT_BROKER=127.0.0.1 MQTT_PORT=1 MQTT_USERNAME=fixture MQTT_PASSWORD=fixture-unused
export CORS_ORIGIN=

# Exercise secure cookies over trusted fixture TLS without disabling validation.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
    -subj '/CN=localhost' -addext 'subjectAltName=IP:127.0.0.1,DNS:localhost' \
    -keyout "$fixture_dir/key.pem" -out "$fixture_dir/cert.pem" > /dev/null 2>&1
chmod 600 "$fixture_dir/key.pem"
"$ROOT/backend/node_modules/.bin/prisma" migrate deploy --schema "$ROOT/backend/prisma/schema.prisma"
# Keep generated logs and dotenv discovery outside the operator checkout.
cd "$fixture_dir"
"$ROOT/backend/node_modules/.bin/tsx" "$ROOT/scripts/ci/test-auth-sessions.ts"
