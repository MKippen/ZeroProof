/**
 * ZeroProof - ESP32 Firmware
 * Main entry point
 */

#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include "config.h"
#include "wifi_manager.h"
#include "mqtt_client.h"
#include "test_executor.h"
#include "command_executor.h"
#include "honeypot_service.h"

// Global objects
WiFiManager wifiManager;
MQTTClient mqttClient;
TestExecutor testExecutor;        // Legacy test executor (backward compat)
CommandExecutor commandExecutor;  // New command-based executor
HoneypotService honeypotService;  // Honeypot listener service
Preferences preferences;

// Device ID (MAC-based)
String deviceId;

// Timing
unsigned long lastHeartbeat = 0;
unsigned long lastWifiCheck = 0;

// Serial command buffer
String serialBuffer = "";
bool serialConfigMode = false;

// Forward declarations
void handleSerialCommand(String command);
void sendSerialResponse(const char* response);
void handleMQTTMessage(char* topic, byte* payload, unsigned int length);
void sendHeartbeat();

void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n================================");
    Serial.println("ZeroProof - Network Security Probe");
    Serial.println("Firmware: " FIRMWARE_VERSION);
    Serial.println("================================\n");

    // Initialize LED pins
    pinMode(LED_STATUS_PIN, OUTPUT);
    pinMode(LED_ACTIVITY_PIN, OUTPUT);
    digitalWrite(LED_STATUS_PIN, LOW);
    digitalWrite(LED_ACTIVITY_PIN, LOW);

    // Generate device ID from MAC address
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char macStr[18];
    sprintf(macStr, "%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    deviceId = String(DEVICE_NAME_PREFIX) + String(macStr);

    Serial.print("Device ID: ");
    Serial.println(deviceId);

    // Initialize preferences for persistent storage
    preferences.begin(CONFIG_NAMESPACE, false);

    // Load saved WiFi credentials
    String savedSSID = preferences.getString("wifi_ssid", "");
    String savedPassword = preferences.getString("wifi_pass", "");

    // Initialize WiFi manager
    wifiManager.begin(deviceId);

    // Try to connect to saved WiFi
    if (savedSSID.length() > 0) {
        Serial.println("Connecting to saved WiFi...");
        if (wifiManager.connect(savedSSID, savedPassword)) {
            Serial.println("WiFi connected!");
            Serial.print("IP: ");
            Serial.println(WiFi.localIP());
        }
    }

    // If not connected, start AP mode for configuration
    if (!wifiManager.isConnected()) {
        Serial.println("Starting AP mode for configuration...");
        wifiManager.startAPMode();
    }

    // Load MQTT settings
    String mqttBroker = preferences.getString("mqtt_broker", "");
    String mqttUser = preferences.getString("mqtt_user", "");
    String mqttPass = preferences.getString("mqtt_pass", "");

    // Initialize MQTT client
    if (mqttBroker.length() > 0 && wifiManager.isConnected()) {
        mqttClient.begin(deviceId, mqttBroker, MQTT_PORT, mqttUser, mqttPass);
        mqttClient.setCallback(handleMQTTMessage);
        mqttClient.connect();
    }

    // Initialize test executors
    testExecutor.begin(&mqttClient, deviceId);
    commandExecutor.begin(&mqttClient, deviceId);

    // Initialize honeypot service
    honeypotService.begin(&mqttClient, deviceId);
    // Test listener will be started once WiFi is connected (in loop)

    Serial.println("\nSetup complete!");
    digitalWrite(LED_STATUS_PIN, HIGH);
}

void loop() {
    unsigned long now = millis();

    // Handle serial commands for web-based configuration
    while (Serial.available()) {
        char c = Serial.read();
        if (c == '\n') {
            serialBuffer.trim();
            if (serialBuffer.length() > 0) {
                handleSerialCommand(serialBuffer);
            }
            serialBuffer = "";
        } else if (c != '\r') {
            serialBuffer += c;
        }
    }

    // Handle WiFi manager (AP mode web server)
    wifiManager.loop();

    // Check WiFi connection periodically
    if (now - lastWifiCheck > WIFI_RECONNECT_DELAY) {
        lastWifiCheck = now;

        if (!wifiManager.isConnected()) {
            digitalWrite(LED_STATUS_PIN, LOW);
            String savedSSID = preferences.getString("wifi_ssid", "");
            String savedPassword = preferences.getString("wifi_pass", "");

            if (savedSSID.length() > 0) {
                wifiManager.connect(savedSSID, savedPassword);
            }
        } else {
            digitalWrite(LED_STATUS_PIN, HIGH);
        }
    }

    // Handle MQTT
    if (wifiManager.isConnected()) {
        if (!mqttClient.isConnected()) {
            mqttClient.reconnect();
        }
        mqttClient.loop();

        // Start test listener once WiFi is connected
        if (!honeypotService.isTestListenerRunning()) {
            honeypotService.startTestListener();
        }
    }

    // Send heartbeat
    if (now - lastHeartbeat > HEARTBEAT_INTERVAL) {
        lastHeartbeat = now;
        sendHeartbeat();
    }

    // Handle test execution (both legacy and command-based)
    testExecutor.loop();
    commandExecutor.loop();

    // Handle honeypot service (monitors fake services and test communication)
    honeypotService.loop();

    // Blink activity LED during test
    if (testExecutor.isRunning() || commandExecutor.isRunning()) {
        digitalWrite(LED_ACTIVITY_PIN, (now / 200) % 2);
    } else {
        digitalWrite(LED_ACTIVITY_PIN, LOW);
    }

    delay(10);
}

void handleMQTTMessage(char* topic, byte* payload, unsigned int length) {
    // Parse the JSON payload (larger buffer for command batches)
    DynamicJsonDocument doc(4096);
    DeserializationError error = deserializeJson(doc, payload, length);

    if (error) {
        Serial.print("JSON parse error: ");
        Serial.println(error.c_str());
        return;
    }

    const char* command = doc["command"];

    Serial.print("Command received: ");
    Serial.println(command);

    // New command-based executor
    if (strcmp(command, "execute") == 0) {
        const char* testId = doc["testId"];
        JsonArray commands = doc["commands"];

        if (testId && commands) {
            commandExecutor.executeBatch(testId, commands);
        } else {
            Serial.println("Missing testId or commands in execute payload");
        }
    }
    // Cancel command executor
    else if (strcmp(command, "cancel") == 0) {
        commandExecutor.cancel();
        testExecutor.cancelTest(doc["testId"]);
    }
    // Legacy test executor (backward compatibility)
    else if (strcmp(command, "start_test") == 0) {
        const char* testId = doc["testId"];
        const char* testType = doc["testType"];
        JsonObject options = doc["options"];

        testExecutor.startTest(testId, testType, options);
    }
    else if (strcmp(command, "cancel_test") == 0) {
        const char* testId = doc["testId"];
        testExecutor.cancelTest(testId);
    }
    else if (strcmp(command, "configure_wifi") == 0) {
        const char* ssid = doc["ssid"];
        const char* password = doc["password"];

        // Save WiFi credentials
        preferences.putString("wifi_ssid", ssid);
        preferences.putString("wifi_pass", password);

        Serial.println("WiFi credentials saved, reconnecting...");
        wifiManager.connect(ssid, password);
    }
    else if (strcmp(command, "configure_mqtt") == 0) {
        const char* broker = doc["broker"];
        const char* user = doc["username"];
        const char* pass = doc["password"];

        preferences.putString("mqtt_broker", broker);
        preferences.putString("mqtt_user", user);
        preferences.putString("mqtt_pass", pass);

        Serial.println("MQTT settings saved, reconnecting...");
        mqttClient.begin(deviceId, broker, MQTT_PORT, user, pass);
        mqttClient.connect();
    }
    else if (strcmp(command, "reboot") == 0) {
        Serial.println("Rebooting...");
        delay(1000);
        ESP.restart();
    }
    else if (strcmp(command, "factory_reset") == 0) {
        Serial.println("Factory reset...");
        preferences.clear();
        delay(1000);
        ESP.restart();
    }
    // Honeypot configuration
    else if (strcmp(command, "configure_honeypot") == 0) {
        JsonObject config = doc["config"];
        if (!config.isNull()) {
            honeypotService.configureFromJson(config);
            Serial.println("Honeypot configured");
        }
    }
    else if (strcmp(command, "honeypot_enable") == 0) {
        bool enable = doc["enabled"] | false;
        honeypotService.setEnabled(enable);
        Serial.printf("Honeypot %s\n", enable ? "enabled" : "disabled");
    }
    // ZeroProof device registration (whitelist)
    else if (strcmp(command, "register_zeroproof_device") == 0) {
        const char* mac = doc["mac"];
        const char* devId = doc["deviceId"];
        const char* ipStr = doc["ip"];

        if (mac && devId && ipStr) {
            IPAddress ip;
            ip.fromString(ipStr);
            honeypotService.addZeroProofDevice(mac, devId, ip);
            Serial.printf("Registered ZeroProof device: %s\n", devId);
        }
    }
    else if (strcmp(command, "clear_zeroproof_devices") == 0) {
        honeypotService.clearZeroProofDevices();
        Serial.println("Cleared ZeroProof device whitelist");
    }
    // ESP32-to-ESP32 test probe
    else if (strcmp(command, "send_test_probe") == 0) {
        const char* targetIpStr = doc["targetIp"];
        uint16_t targetPort = doc["port"] | ZEROPROOF_TEST_PORT;
        const char* testId = doc["testId"] | "manual";

        if (targetIpStr) {
            IPAddress targetIP;
            targetIP.fromString(targetIpStr);

            Serial.printf("Sending test probe to %s:%d\n", targetIpStr, targetPort);
            bool result = honeypotService.sendTestProbe(targetIP, targetPort, testId);

            // Send immediate result via MQTT
            StaticJsonDocument<256> resultDoc;
            resultDoc["command"] = "test_probe_result";
            resultDoc["testId"] = testId;
            resultDoc["targetIp"] = targetIpStr;
            resultDoc["port"] = targetPort;
            resultDoc["success"] = result;

            String resultPayload;
            serializeJson(resultDoc, resultPayload);

            String resultTopic = String(MQTT_TOPIC_BASE) + deviceId + "/test_probe";
            mqttClient.publish(resultTopic.c_str(), resultPayload.c_str());
        }
    }
}

void sendHeartbeat() {
    if (!mqttClient.isConnected()) return;

    StaticJsonDocument<384> doc;
    doc["online"] = true;
    doc["name"] = deviceId;
    doc["mac"] = WiFi.macAddress();
    doc["ip"] = WiFi.localIP().toString();
    doc["firmware"] = FIRMWARE_VERSION;
    doc["rssi"] = WiFi.RSSI();
    doc["uptime"] = millis() / 1000;
    doc["freeHeap"] = ESP.getFreeHeap();

    // Honeypot status
    JsonObject honeypot = doc.createNestedObject("honeypot");
    honeypot["enabled"] = honeypotService.isEnabled();
    honeypot["connections"] = honeypotService.getTotalConnections();
    honeypot["testListener"] = honeypotService.isTestListenerRunning();

    String payload;
    serializeJson(doc, payload);

    String topic = String(MQTT_TOPIC_BASE) + deviceId + MQTT_TOPIC_STATUS;
    mqttClient.publish(topic.c_str(), payload.c_str());
}

// Serial command handling for web-based setup wizard
void sendSerialResponse(const char* response) {
    Serial.println(response);
}

void handleSerialCommand(String command) {
    Serial.print("[Serial] Command: ");
    Serial.println(command);

    // PING - Device identification
    if (command == "PING") {
        Serial.print("PONG:");
        Serial.println(deviceId);
    }
    // GET_INFO - Get device information
    else if (command == "GET_INFO") {
        Serial.print("INFO:{\"deviceId\":\"");
        Serial.print(deviceId);
        Serial.print("\",\"mac\":\"");
        Serial.print(WiFi.macAddress());
        Serial.print("\",\"firmware\":\"");
        Serial.print(FIRMWARE_VERSION);
        Serial.print("\",\"connected\":");
        Serial.print(wifiManager.isConnected() ? "true" : "false");
        if (wifiManager.isConnected()) {
            Serial.print(",\"ip\":\"");
            Serial.print(WiFi.localIP().toString());
            Serial.print("\",\"ssid\":\"");
            Serial.print(WiFi.SSID());
            Serial.print("\",\"rssi\":");
            Serial.print(WiFi.RSSI());
        }
        Serial.println("}");
    }
    // WIFI_CONFIG:ssid:password - Configure WiFi
    else if (command.startsWith("WIFI_CONFIG:")) {
        String params = command.substring(12);
        int colonIndex = params.indexOf(':');
        if (colonIndex > 0) {
            String ssid = params.substring(0, colonIndex);
            String password = params.substring(colonIndex + 1);

            sendSerialResponse("WIFI_ACK");

            // Save credentials
            preferences.putString("wifi_ssid", ssid);
            preferences.putString("wifi_pass", password);

            sendSerialResponse("WIFI_CONNECTING");

            // Attempt connection
            if (wifiManager.connect(ssid, password)) {
                Serial.print("WIFI_CONNECTED:");
                Serial.println(WiFi.localIP().toString());
            } else {
                sendSerialResponse("WIFI_FAILED:Connection timeout or wrong password");
            }
        } else {
            sendSerialResponse("ERROR:Invalid WIFI_CONFIG format");
        }
    }
    // MQTT_CONFIG:broker:port:username:password - Configure MQTT
    else if (command.startsWith("MQTT_CONFIG:")) {
        String params = command.substring(12);
        // Parse broker:port:username:password
        int idx1 = params.indexOf(':');
        int idx2 = params.indexOf(':', idx1 + 1);
        int idx3 = params.indexOf(':', idx2 + 1);

        if (idx1 > 0 && idx2 > idx1) {
            String broker = params.substring(0, idx1);
            int port = params.substring(idx1 + 1, idx2).toInt();
            String user = "";
            String pass = "";
            if (idx3 > idx2) {
                user = params.substring(idx2 + 1, idx3);
                pass = params.substring(idx3 + 1);
            }

            preferences.putString("mqtt_broker", broker);
            preferences.putString("mqtt_user", user);
            preferences.putString("mqtt_pass", pass);

            sendSerialResponse("MQTT_ACK");

            // Connect to MQTT
            if (wifiManager.isConnected()) {
                mqttClient.begin(deviceId, broker, port, user, pass);
                mqttClient.setCallback(handleMQTTMessage);  // Set callback before connect
                if (mqttClient.connect()) {
                    sendSerialResponse("MQTT_CONNECTED");
                } else {
                    sendSerialResponse("MQTT_FAILED:Connection failed");
                }
            } else {
                sendSerialResponse("MQTT_FAILED:WiFi not connected");
            }
        } else {
            sendSerialResponse("ERROR:Invalid MQTT_CONFIG format");
        }
    }
    // REBOOT - Restart device
    else if (command == "REBOOT") {
        sendSerialResponse("REBOOTING");
        delay(500);
        ESP.restart();
    }
    // FACTORY_RESET - Clear all settings
    else if (command == "FACTORY_RESET") {
        sendSerialResponse("RESETTING");
        preferences.clear();
        delay(500);
        ESP.restart();
    }
    // Unknown command
    else {
        sendSerialResponse("ERROR:Unknown command");
    }
}
