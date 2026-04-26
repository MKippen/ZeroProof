#ifndef CONFIG_H
#define CONFIG_H

// Firmware version
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "3.1.0"
#endif

// Device identification - Shows as "ZeroProof-XXXX" in UniFi controller
#define DEVICE_NAME_PREFIX "ZeroProof-"
#define DEVICE_MANUFACTURER "ZeroProof"
#define DEVICE_MODEL "Security Probe"

// WiFi settings
#define WIFI_CONNECT_TIMEOUT 30000  // 30 seconds
#define WIFI_RECONNECT_DELAY 5000   // 5 seconds

// MQTT settings
#define MQTT_PORT 1883
#define MQTT_RECONNECT_DELAY 5000   // 5 seconds
#define MQTT_KEEPALIVE 60           // seconds
#define MQTT_BUFFER_SIZE 8192
#define MQTT_MAX_DIRECT_RESULTS_BYTES 3000
#define MQTT_RESULTS_CHUNK_SIZE 1200

// MQTT Topics
#define MQTT_TOPIC_BASE "zeroproof/devices/"
#define MQTT_TOPIC_STATUS "/status"
#define MQTT_TOPIC_COMMAND "/command"
#define MQTT_TOPIC_TEST_PROGRESS "/test/progress"
#define MQTT_TOPIC_TEST_RESULTS "/test/results"
#define MQTT_TOPIC_TEST_RESULTS_CHUNK "/test/results/chunk"

// Heartbeat interval
#define HEARTBEAT_INTERVAL 30000    // 30 seconds

// Port scanning settings
#define PORT_SCAN_TIMEOUT 1000      // 1 second per port
#define PORT_SCAN_DEFAULT_PORTS {21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 993, 995, 1433, 3306, 3389, 5432, 5900, 6379, 8080, 8443, 27017}
#define MAX_PORTS_TO_SCAN 100

// VLAN test settings
#define VLAN_TEST_TIMEOUT 5000      // 5 seconds
#define VLAN_TEST_PORTS {80, 443, 22, 445}

// Service discovery settings
#define SERVICE_BANNER_TIMEOUT 2000 // 2 seconds
#define MAX_BANNER_LENGTH 256

// LED pins (adjust for your board)
#define LED_STATUS_PIN 2
#define LED_ACTIVITY_PIN 4

// Storage settings
#define CONFIG_NAMESPACE "auditor"

#endif // CONFIG_H
