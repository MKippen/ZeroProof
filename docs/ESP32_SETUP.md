# ESP32 Setup Guide

## Hardware Requirements

- ESP32 development board (ESP32-DevKit, ESP32-C3, etc.)
- USB cable for programming
- (Optional) External antenna for better WiFi range

## Software Requirements

- [PlatformIO IDE](https://platformio.org/install/ide?install=vscode) (VS Code extension)
- Or PlatformIO Core (CLI)

## Flashing the Firmware

### Using PlatformIO IDE (Recommended)

1. Open VS Code with PlatformIO extension installed
2. Open the `esp32-firmware` folder
3. Connect your ESP32 via USB
4. Click the "Upload" button (→) in the bottom toolbar

### Using PlatformIO CLI

```bash
cd esp32-firmware

# Install PlatformIO if needed
pip3 install platformio

# Build firmware
pio run

# Upload to ESP32 (if already has bootloader)
pio run --target upload

# Monitor serial output
pio device monitor
```

### Building Merged Firmware (for fresh ESP32 or web flashing)

Fresh ESP32 devices or web-based flashing require a merged binary that includes the bootloader, partition table, and application. This is also required for the ZeroProof web UI firmware flashing feature.

```bash
cd esp32-firmware

# Build first
pio run

# Install esptool if needed
pip3 install esptool

# Create merged binary (includes bootloader + partitions + app)
esptool.py --chip esp32 merge_bin \
  -o ../backend/firmware/zeroproof-esp32.bin \
  --flash_mode dio \
  --flash_size 4MB \
  0x1000 .pio/build/esp32dev/bootloader.bin \
  0x8000 .pio/build/esp32dev/partitions.bin \
  0x10000 .pio/build/esp32dev/firmware.bin

# Update firmware.json with new size and checksum
ls -la ../backend/firmware/zeroproof-esp32.bin
shasum -a 256 ../backend/firmware/zeroproof-esp32.bin
```

The open-source repository does not commit prebuilt firmware binaries because build artifacts can embed local machine paths. After building a release binary, update `backend/firmware/firmware.json` with the new version, size, and checksum before distributing it.

### Flashing Merged Binary Manually

```bash
# Flash merged binary at offset 0x0
esptool.py --port /dev/cu.usbserial-XXXX write_flash 0x0 backend/firmware/zeroproof-esp32.bin
```

## Initial Configuration

### Method 1: Web Interface (Recommended)

1. Flash the firmware
2. The ESP32 will create a WiFi access point: `ZeroProof-Setup`
3. Connect to this network with your phone/laptop
4. Open `http://192.168.4.1` in a browser
5. Enter your WiFi credentials and MQTT settings
6. Click "Save Configuration"
7. The device will reboot and connect to your network

### Method 2: Serial Configuration

1. Connect to the ESP32 via serial monitor (115200 baud)
2. Send JSON configuration:

```json
{"command":"configure_wifi","ssid":"YourWiFi","password":"YourPassword"}
{"command":"configure_mqtt","broker":"192.168.1.x","username":"auditor","password":"mqtt_password"}
```

## LED Indicators

| LED | Status |
|-----|--------|
| Status LED (GPIO 2) | Solid = WiFi connected, Off = Disconnected |
| Activity LED (GPIO 4) | Blinking = Test running, Off = Idle |

## MQTT Topics

The device communicates via MQTT:

| Topic | Direction | Description |
|-------|-----------|-------------|
| `zeroproof/devices/{id}/status` | → Server | Heartbeat (every 30s) |
| `zeroproof/devices/{id}/command` | ← Server | Commands |
| `zeroproof/devices/{id}/test/progress` | → Server | Test progress |
| `zeroproof/devices/{id}/test/results` | → Server | Test results |

## Commands

Commands sent via MQTT:

```json
// Start a test
{
  "command": "start_test",
  "testId": "test-123",
  "testType": "port_scan",
  "options": {
    "startPort": 1,
    "endPort": 1024
  }
}

// Cancel test
{
  "command": "cancel_test",
  "testId": "test-123"
}

// Configure WiFi
{
  "command": "configure_wifi",
  "ssid": "NetworkName",
  "password": "NetworkPassword"
}

// Reboot device
{
  "command": "reboot"
}

// Factory reset
{
  "command": "factory_reset"
}
```

## Test Types

| Type | Description |
|------|-------------|
| `port_scan` | Scan for open ports on discovered hosts |
| `vlan_isolation` | Test if VLANs are properly isolated |
| `service_discovery` | Discover and identify network services |
| `full_audit` | Run all security tests |

## Troubleshooting

### Device not appearing in dashboard

1. Check WiFi connection (Status LED should be solid)
2. Verify MQTT broker address is correct
3. Check MQTT credentials
4. Ensure firmware version matches backend expectations (MQTT topic: `zeroproof/devices/...`)
5. View serial output for errors:
   ```bash
   pio device monitor
   ```

### Devices stuck as ONLINE after disconnecting

The scheduler process marks devices as OFFLINE after 5 minutes of no heartbeat. In development, make sure the scheduler is running:

```bash
cd backend
pnpm dev:scheduler
```

Check scheduler logs for cleanup activity:
```bash
# Should see "Marked X devices as offline" when stale devices are found
```

### WiFi connection failing

1. Ensure WiFi is 2.4GHz (ESP32 doesn't support 5GHz)
2. Check password is correct
3. Verify router allows new devices
4. Try moving closer to the router

### MQTT connection failing

1. Verify broker IP address
2. Check MQTT username/password
3. Ensure MQTT port 1883 is not blocked
4. Test with mosquitto_sub:
   ```bash
   mosquitto_sub -h broker_ip -u auditor -P password -t "#" -v
   ```

### "No Firmware Installed" error when flashing via web UI

This occurs when flashing a fresh ESP32 that has no bootloader. The web UI expects a merged binary that includes bootloader + partitions + application.

Solution: Build and deploy the merged firmware (see "Building Merged Firmware" section above), then retry the web flash.

### Factory Reset

If the device is misconfigured:

1. Connect via serial
2. Send: `{"command":"factory_reset"}`
3. Or hold BOOT button for 10 seconds during startup

## Multiple Devices

To deploy multiple ESP32 devices:

1. Flash the same firmware to each device
2. Each device gets a unique ID based on its MAC address
3. Configure each device with WiFi and MQTT settings
4. All devices appear automatically in the dashboard

## Power Consumption

- Idle: ~80mA
- WiFi connected: ~120mA
- During test: ~150mA

For battery operation, consider:
- ESP32-C3 (lower power)
- Deep sleep between tests
- External battery pack with 5V output
