#!/usr/bin/env bash
# Create/update the application credential as the broker's user, even when
# the host caller cannot chmod/chown files created by a root Docker daemon.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
config_source="${1:-$ROOT/mosquitto/config}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD is required to configure MQTT authentication}"
export MQTT_USERNAME="${MQTT_USERNAME:-auditor}"
export MQTT_PASSWORD

docker run --rm --user 0:0 --entrypoint sh \
    -e MQTT_USERNAME -e MQTT_PASSWORD \
    -v "$config_source:/mosquitto/config" eclipse-mosquitto:2 -ec '
    password_file=/mosquitto/config/passwd
    if [ -e "$password_file" ]; then
        mosquitto_passwd -b "$password_file" "$MQTT_USERNAME" "$MQTT_PASSWORD"
    else
        mosquitto_passwd -b -c "$password_file" "$MQTT_USERNAME" "$MQTT_PASSWORD"
    fi
    chown mosquitto:mosquitto "$password_file"
    chmod 600 "$password_file"
'
