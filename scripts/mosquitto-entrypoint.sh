#!/bin/sh
# Old installers left a root-owned 0600 password file behind a read-only
# bind mount. Stage a private runtime copy so even an upgrade launched by
# an older script recovers, while configuration stays read-only and the
# broker still runs as its unprivileged mosquitto user.
set -eu
source_dir=/mosquitto/config
if [ ! -s "$source_dir/passwd" ]; then
    echo "MQTT password file is missing or empty; run scripts/configure-mqtt.sh." >&2
    exit 1
fi
runtime_dir=$(mktemp -d /tmp/zeroproof-mqtt.XXXXXX)
cp "$source_dir/passwd" "$runtime_dir/passwd"
sed "s|^password_file[[:space:]].*|password_file $runtime_dir/passwd|" \
    "$source_dir/mosquitto.conf" > "$runtime_dir/mosquitto.conf"
chmod 600 "$runtime_dir/passwd" "$runtime_dir/mosquitto.conf"
chown -R mosquitto:mosquitto "$runtime_dir"
exec /docker-entrypoint.sh mosquitto -c "$runtime_dir/mosquitto.conf"
