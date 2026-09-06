#!/usr/bin/env bash
# Exercise Linux ownership semantics and real authenticated MQTT without
# touching the application stack, host ports, or operator credentials.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
fixture="zeroproof-mqtt-permissions-$RANDOM-$$"
volume="$fixture-config"
broker="$fixture-broker"
cleanup() {
    docker rm -f "$broker" > /dev/null 2>&1 || true
    docker volume rm "$volume" > /dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "$volume" > /dev/null
docker run --rm --user 0:0 --entrypoint sh \
    -v "$volume:/mosquitto/config" \
    -v "$ROOT/mosquitto/config/mosquitto.conf:/fixture.conf:ro" \
    eclipse-mosquitto:2 -ec 'cp /fixture.conf /mosquitto/config/mosquitto.conf'
MQTT_USERNAME=fixture-app MQTT_PASSWORD=fixture-password \
    bash "$ROOT/scripts/configure-mqtt.sh" "$volume"
MQTT_USERNAME=fixture-extra MQTT_PASSWORD=retained-password \
    bash "$ROOT/scripts/configure-mqtt.sh" "$volume"
# Updating one application credential must retain manually-added users.
MQTT_USERNAME=fixture-app MQTT_PASSWORD=fixture-password \
    bash "$ROOT/scripts/configure-mqtt.sh" "$volume"
docker run --rm --user 1883:1883 --entrypoint sh -v "$volume:/config:ro" eclipse-mosquitto:2 -ec '
    test "$(stat -c "%a:%u:%g" /config/passwd)" = 600:1883:1883
    grep -q "^fixture-app:" /config/passwd
    grep -q "^fixture-extra:" /config/passwd
'

# Reproduce a historical installer: root creates 0600, host runner cannot
# chmod it, and a read-only broker mount cannot repair source ownership.
docker run --rm --user 0:0 --entrypoint sh -v "$volume:/config" eclipse-mosquitto:2 -ec 'chown 0:0 /config/passwd; chmod 600 /config/passwd'
docker run --rm --user 1001:1001 --entrypoint sh -v "$volume:/config" eclipse-mosquitto:2 -ec '
    if chmod 644 /config/passwd 2>/dev/null; then
        echo "Fixture did not reproduce unprivileged chmod failure" >&2
        exit 1
    fi
'
docker run --rm -d --name "$broker" --user 0:0 --entrypoint /bin/sh \
    -v "$volume:/mosquitto/config:ro" \
    -v "$ROOT/scripts/mosquitto-entrypoint.sh:/bootstrap.sh:ro" \
    eclipse-mosquitto:2 /bootstrap.sh > /dev/null
ready=false
for attempt in {1..10}; do
    if docker exec "$broker" mosquitto_pub -h 127.0.0.1 -u fixture-app -P fixture-password \
        -t ci/permissions -m preserved -r 2>/dev/null; then
        ready=true
        break
    fi
    sleep 1
done
[ "$ready" = true ] || { docker logs "$broker"; exit 1; }
message=$(docker exec "$broker" mosquitto_sub -h 127.0.0.1 -u fixture-extra -P retained-password -t ci/permissions -C 1 -W 5)
[ "$message" = preserved ]
if docker exec "$broker" mosquitto_pub -h 127.0.0.1 -u fixture-app -P wrong-password -t ci/permissions -m invalid 2>/dev/null; then
    echo "Broker accepted an incorrect password" >&2
    exit 1
fi
[ "$(docker exec "$broker" awk '/^Uid:/ {print $2}' /proc/1/status)" = 1883 ]
[ "$(docker exec "$broker" stat -c '%a:%u:%g' /mosquitto/config/passwd)" = 600:0:0 ]
[ "$(docker inspect "$broker" --format '{{.State.Status}}:{{.RestartCount}}')" = running:0 ]
echo "MQTT ownership, preserved users, unprivileged runtime, and authenticated messaging passed."
