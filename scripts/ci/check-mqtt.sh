#!/usr/bin/env bash
# CI probe for issue #50: a responsive API can hide a crashlooping MQTT broker.
set -euo pipefail

ready=false
deadline=$((SECONDS + 60))
while [ "$SECONDS" -lt "$deadline" ]; do
    state=$(docker inspect zeroproof-mqtt --format '{{.State.Status}}')
    restarts=$(docker inspect zeroproof-mqtt --format '{{.RestartCount}}')
    if [ "$restarts" -ne 0 ]; then
        echo "MQTT broker restarted $restarts time(s); the install/upgrade is not clean."
        docker logs --tail=30 zeroproof-mqtt
        exit 1
    fi
    # Probe the backend directly: nginx's own /health never checks MQTT.
    # mqtt=true means the application authenticated and connected to the broker.
    if [ "$state" = running ] && curl -fsS --max-time 3 http://127.0.0.1:3000/health \
        | jq -e '.mqtt == true' > /dev/null; then
        ready=true
        break
    fi
    sleep 3
done

if [ "$ready" != true ]; then
    echo "Backend did not establish an authenticated MQTT connection within 60s."
    docker logs --tail=30 zeroproof-mqtt
    exit 1
fi

# A briefly connected client must not hide a broker that immediately exits.
sleep 5
state=$(docker inspect zeroproof-mqtt --format '{{.State.Status}}:{{.RestartCount}}')
[ "$state" = running:0 ] || { echo "MQTT broker did not stay healthy: $state"; exit 1; }
curl -fsS --max-time 3 http://127.0.0.1:3000/health | jq -e '.mqtt == true' > /dev/null
echo "MQTT broker is stable and the backend is authenticated."
