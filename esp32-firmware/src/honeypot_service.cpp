#include "honeypot_service.h"
#include "config.h"
#include <ArduinoJson.h>

// Report interval (send logs every 10 seconds if there are unreported logs)
#define REPORT_INTERVAL 10000

// Realistic service banners
static const char* BANNER_SSH = "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.1\r\n";
static const char* BANNER_TELNET = "\r\nUbuntu 22.04.1 LTS\r\nLogin: ";
static const char* BANNER_FTP = "220 ProFTPD Server (Debian) [::ffff:192.168.1.1]\r\n";
static const char* BANNER_HTTP = "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"Router\"\r\nContent-Type: text/html\r\n\r\n<html><body><h1>401 Unauthorized</h1></body></html>";
static const char* BANNER_MYSQL = "5.7.38-0ubuntu0.22.04.1"; // MySQL sends binary protocol, this is simplified
static const char* BANNER_REDIS = "-ERR Authentication required\r\n";
static const char* BANNER_SMB = ""; // SMB is binary, we just log connection attempts
static const char* BANNER_GENERIC = ""; // No banner, just log

HoneypotService::HoneypotService() :
    _mqtt(nullptr),
    _enabled(false),
    _initialized(false),
    _portCount(0),
    _logHead(0),
    _logCount(0),
    _totalConnections(0),
    _lastReportTime(0),
    _zeroproofDeviceCount(0),
    _testServer(nullptr),
    _testListenerEnabled(false),
    _testResultHead(0),
    _testResultCount(0)
{
    memset(_ports, 0, sizeof(_ports));
    memset(_logs, 0, sizeof(_logs));
    memset(_zeroproofDevices, 0, sizeof(_zeroproofDevices));
    memset(_testResults, 0, sizeof(_testResults));
}

void HoneypotService::begin(MQTTClient* mqtt, String deviceId) {
    _mqtt = mqtt;
    _deviceId = deviceId;
    _initialized = true;

    Serial.println("[Honeypot] Service initialized");
}

void HoneypotService::loop() {
    if (!_initialized) return;

    unsigned long now = millis();

    // Handle test listener (always active if enabled, even when honeypot is disabled)
    if (_testListenerEnabled && _testServer) {
        WiFiClient client = _testServer->available();
        if (client) {
            handleTestConnection(client);
        }
    }

    // Honeypot functionality
    if (_enabled) {
        // Check each port for incoming connections
        for (uint8_t i = 0; i < _portCount; i++) {
            HoneypotPort& hp = _ports[i];
            if (!hp.enabled || !hp.server) continue;

            WiFiClient client = hp.server->available();
            if (client) {
                // Check if this is a ZeroProof device - don't log as honeypot hit
                if (isZeroProofDevice(client.remoteIP())) {
                    Serial.printf("[Honeypot] ZeroProof device connection on port %d from %s - not logging\n",
                                  hp.port, client.remoteIP().toString().c_str());
                    client.stop();
                    continue;
                }
                handleConnection(hp, client);
            }
        }
    }

    // Report logs periodically
    if (now - _lastReportTime > REPORT_INTERVAL) {
        _lastReportTime = now;
        if (getUnreportedLogs() > 0) {
            reportLogs();
        }
        // Also report test results
        reportTestResults();
    }
}

void HoneypotService::handleConnection(HoneypotPort& port, WiFiClient& client) {
    port.connectionCount++;
    _totalConnections++;

    IPAddress sourceIP = client.remoteIP();
    uint16_t sourcePort = client.remotePort();

    Serial.printf("[Honeypot] Connection on port %d from %s:%d\n",
                  port.port, sourceIP.toString().c_str(), sourcePort);

    // Blink activity LED
    digitalWrite(LED_ACTIVITY_PIN, HIGH);

    // Send appropriate banner
    const char* banner = getBanner(port.serviceType);
    if (strlen(banner) > 0) {
        client.print(banner);
    }

    // Wait briefly for any data the attacker might send
    char dataBuffer[128] = {0};
    uint16_t dataLen = 0;
    unsigned long startTime = millis();

    while (client.connected() && (millis() - startTime) < 3000) {
        if (client.available()) {
            int bytesRead = client.readBytes(dataBuffer + dataLen,
                                            sizeof(dataBuffer) - dataLen - 1);
            if (bytesRead > 0) {
                dataLen += bytesRead;
                if (dataLen >= sizeof(dataBuffer) - 1) break;
            }
        }
        delay(10);
    }

    // Log received data (if any)
    if (dataLen > 0) {
        dataBuffer[dataLen] = '\0';
        Serial.printf("[Honeypot] Data received (%d bytes): ", dataLen);
        // Print as hex for binary data
        for (int i = 0; i < min((int)dataLen, 32); i++) {
            Serial.printf("%02X ", (uint8_t)dataBuffer[i]);
        }
        Serial.println();
    }

    // Add to log
    addLog(sourceIP, sourcePort, port.port, port.serviceType, dataBuffer, dataLen);

    // Close connection
    client.stop();
    digitalWrite(LED_ACTIVITY_PIN, LOW);
}

void HoneypotService::addLog(IPAddress sourceIP, uint16_t sourcePort, uint16_t destPort,
                             HoneypotServiceType type, const char* data, uint16_t dataLen) {
    // Circular buffer - overwrite oldest if full
    HoneypotLog& log = _logs[_logHead];

    log.timestamp = millis();
    log.sourceIP = sourceIP;
    log.sourcePort = sourcePort;
    log.destPort = destPort;
    log.serviceType = type;
    log.dataLength = min(dataLen, (uint16_t)(sizeof(log.dataReceived) - 1));
    memcpy(log.dataReceived, data, log.dataLength);
    log.dataReceived[log.dataLength] = '\0';
    log.reported = false;

    _logHead = (_logHead + 1) % MAX_HONEYPOT_LOGS;
    if (_logCount < MAX_HONEYPOT_LOGS) _logCount++;
}

void HoneypotService::reportLogs() {
    if (!_mqtt || !_mqtt->isConnected()) return;

    // Build JSON with unreported logs
    DynamicJsonDocument doc(2048);
    doc["deviceId"] = _deviceId;
    doc["type"] = "honeypot_logs";
    doc["timestamp"] = millis();
    doc["uptime"] = millis() / 1000;

    JsonArray logs = doc.createNestedArray("logs");
    int reported = 0;

    for (uint8_t i = 0; i < _logCount && reported < 10; i++) {
        HoneypotLog& log = _logs[i];
        if (log.reported) continue;

        JsonObject entry = logs.createNestedObject();
        entry["ts"] = log.timestamp;
        entry["srcIp"] = log.sourceIP.toString();
        entry["srcPort"] = log.sourcePort;
        entry["dstPort"] = log.destPort;
        entry["service"] = getServiceName(log.serviceType);

        // Encode data as base64 or hex for binary safety
        if (log.dataLength > 0) {
            // Convert to hex string for safe transmission
            String hexData;
            for (int j = 0; j < log.dataLength; j++) {
                char hex[3];
                sprintf(hex, "%02X", (uint8_t)log.dataReceived[j]);
                hexData += hex;
            }
            entry["dataHex"] = hexData;
            entry["dataLen"] = log.dataLength;

            // Also try to include as string if printable
            bool printable = true;
            for (int j = 0; j < log.dataLength; j++) {
                if (log.dataReceived[j] < 32 && log.dataReceived[j] != '\r' &&
                    log.dataReceived[j] != '\n' && log.dataReceived[j] != '\t') {
                    printable = false;
                    break;
                }
            }
            if (printable) {
                entry["dataStr"] = log.dataReceived;
            }
        }

        log.reported = true;
        reported++;
    }

    if (reported > 0) {
        // Add stats
        doc["totalConnections"] = _totalConnections;
        doc["logsReported"] = reported;

        String payload;
        serializeJson(doc, payload);

        String topic = String(MQTT_TOPIC_BASE) + _deviceId + "/honeypot";
        _mqtt->publish(topic.c_str(), payload.c_str());

        Serial.printf("[Honeypot] Reported %d log entries\n", reported);
    }
}

uint32_t HoneypotService::getUnreportedLogs() const {
    uint32_t count = 0;
    for (uint8_t i = 0; i < _logCount; i++) {
        if (!_logs[i].reported) count++;
    }
    return count;
}

void HoneypotService::addPort(uint16_t port, HoneypotServiceType type) {
    if (_portCount >= MAX_HONEYPOT_PORTS) {
        Serial.println("[Honeypot] Max ports reached");
        return;
    }

    // Check if port already exists
    for (uint8_t i = 0; i < _portCount; i++) {
        if (_ports[i].port == port) {
            Serial.printf("[Honeypot] Port %d already configured\n", port);
            return;
        }
    }

    HoneypotPort& hp = _ports[_portCount];
    hp.port = port;
    hp.serviceType = type;
    hp.enabled = true;
    hp.server = nullptr;
    hp.connectionCount = 0;

    _portCount++;

    Serial.printf("[Honeypot] Added port %d (%s)\n", port, getServiceName(type));

    // If enabled, start listener immediately
    if (_enabled) {
        hp.server = new WiFiServer(port);
        hp.server->begin();
        Serial.printf("[Honeypot] Listening on port %d\n", port);
    }
}

void HoneypotService::removePort(uint16_t port) {
    for (uint8_t i = 0; i < _portCount; i++) {
        if (_ports[i].port == port) {
            if (_ports[i].server) {
                _ports[i].server->end();
                delete _ports[i].server;
            }
            // Shift remaining ports
            for (uint8_t j = i; j < _portCount - 1; j++) {
                _ports[j] = _ports[j + 1];
            }
            _portCount--;
            Serial.printf("[Honeypot] Removed port %d\n", port);
            return;
        }
    }
}

void HoneypotService::clearPorts() {
    stopListeners();
    _portCount = 0;
    Serial.println("[Honeypot] Cleared all ports");
}

void HoneypotService::setEnabled(bool enabled) {
    if (enabled == _enabled) return;

    _enabled = enabled;

    if (enabled) {
        startListeners();
        Serial.println("[Honeypot] Enabled");
    } else {
        stopListeners();
        Serial.println("[Honeypot] Disabled");
    }
}

void HoneypotService::configureFromJson(JsonObject& config) {
    // Stop existing listeners
    stopListeners();
    clearPorts();

    // Parse ports array
    JsonArray ports = config["ports"];
    for (JsonObject portConfig : ports) {
        uint16_t port = portConfig["port"];
        const char* service = portConfig["service"] | "generic";

        HoneypotServiceType type = HoneypotServiceType::GENERIC;
        if (strcmp(service, "ssh") == 0) type = HoneypotServiceType::SSH;
        else if (strcmp(service, "telnet") == 0) type = HoneypotServiceType::TELNET;
        else if (strcmp(service, "http") == 0) type = HoneypotServiceType::HTTP;
        else if (strcmp(service, "ftp") == 0) type = HoneypotServiceType::FTP;
        else if (strcmp(service, "mysql") == 0) type = HoneypotServiceType::MYSQL;
        else if (strcmp(service, "redis") == 0) type = HoneypotServiceType::REDIS;
        else if (strcmp(service, "smb") == 0) type = HoneypotServiceType::SMB;

        addPort(port, type);
    }

    // Enable if requested
    bool enable = config["enabled"] | false;
    setEnabled(enable);
}

void HoneypotService::startListeners() {
    for (uint8_t i = 0; i < _portCount; i++) {
        HoneypotPort& hp = _ports[i];
        if (hp.enabled && !hp.server) {
            hp.server = new WiFiServer(hp.port);
            hp.server->begin();
            Serial.printf("[Honeypot] Started listener on port %d\n", hp.port);
        }
    }
}

void HoneypotService::stopListeners() {
    for (uint8_t i = 0; i < _portCount; i++) {
        if (_ports[i].server) {
            _ports[i].server->end();
            delete _ports[i].server;
            _ports[i].server = nullptr;
        }
    }
    Serial.println("[Honeypot] Stopped all listeners");
}

const char* HoneypotService::getBanner(HoneypotServiceType type) {
    switch (type) {
        case HoneypotServiceType::SSH: return BANNER_SSH;
        case HoneypotServiceType::TELNET: return BANNER_TELNET;
        case HoneypotServiceType::FTP: return BANNER_FTP;
        case HoneypotServiceType::HTTP: return BANNER_HTTP;
        case HoneypotServiceType::MYSQL: return BANNER_MYSQL;
        case HoneypotServiceType::REDIS: return BANNER_REDIS;
        case HoneypotServiceType::SMB: return BANNER_SMB;
        default: return BANNER_GENERIC;
    }
}

const char* HoneypotService::getServiceName(HoneypotServiceType type) {
    switch (type) {
        case HoneypotServiceType::SSH: return "ssh";
        case HoneypotServiceType::TELNET: return "telnet";
        case HoneypotServiceType::FTP: return "ftp";
        case HoneypotServiceType::HTTP: return "http";
        case HoneypotServiceType::MYSQL: return "mysql";
        case HoneypotServiceType::REDIS: return "redis";
        case HoneypotServiceType::SMB: return "smb";
        default: return "generic";
    }
}

// ============================================================================
// ZeroProof Device Whitelisting
// ============================================================================

void HoneypotService::addZeroProofDevice(const char* mac, const char* deviceId, IPAddress ip) {
    // Check if already exists
    for (uint8_t i = 0; i < MAX_ZEROPROOF_DEVICES; i++) {
        if (_zeroproofDevices[i].active && strcmp(_zeroproofDevices[i].mac, mac) == 0) {
            // Update existing
            strncpy(_zeroproofDevices[i].deviceId, deviceId, sizeof(_zeroproofDevices[i].deviceId) - 1);
            _zeroproofDevices[i].ip = ip;
            _zeroproofDevices[i].lastSeen = millis();
            Serial.printf("[Honeypot] Updated ZeroProof device: %s (%s)\n", mac, deviceId);
            return;
        }
    }

    // Find empty slot
    for (uint8_t i = 0; i < MAX_ZEROPROOF_DEVICES; i++) {
        if (!_zeroproofDevices[i].active) {
            strncpy(_zeroproofDevices[i].mac, mac, sizeof(_zeroproofDevices[i].mac) - 1);
            strncpy(_zeroproofDevices[i].deviceId, deviceId, sizeof(_zeroproofDevices[i].deviceId) - 1);
            _zeroproofDevices[i].ip = ip;
            _zeroproofDevices[i].lastSeen = millis();
            _zeroproofDevices[i].active = true;
            _zeroproofDeviceCount++;
            Serial.printf("[Honeypot] Added ZeroProof device: %s (%s) at %s\n",
                          mac, deviceId, ip.toString().c_str());
            return;
        }
    }

    Serial.println("[Honeypot] ZeroProof device list full!");
}

void HoneypotService::removeZeroProofDevice(const char* mac) {
    for (uint8_t i = 0; i < MAX_ZEROPROOF_DEVICES; i++) {
        if (_zeroproofDevices[i].active && strcmp(_zeroproofDevices[i].mac, mac) == 0) {
            _zeroproofDevices[i].active = false;
            _zeroproofDeviceCount--;
            Serial.printf("[Honeypot] Removed ZeroProof device: %s\n", mac);
            return;
        }
    }
}

void HoneypotService::clearZeroProofDevices() {
    memset(_zeroproofDevices, 0, sizeof(_zeroproofDevices));
    _zeroproofDeviceCount = 0;
    Serial.println("[Honeypot] Cleared ZeroProof device whitelist");
}

bool HoneypotService::isZeroProofDevice(IPAddress ip) {
    for (uint8_t i = 0; i < MAX_ZEROPROOF_DEVICES; i++) {
        if (_zeroproofDevices[i].active && _zeroproofDevices[i].ip == ip) {
            return true;
        }
    }
    return false;
}

bool HoneypotService::isZeroProofDevice(const char* mac) {
    for (uint8_t i = 0; i < MAX_ZEROPROOF_DEVICES; i++) {
        if (_zeroproofDevices[i].active && strcmp(_zeroproofDevices[i].mac, mac) == 0) {
            return true;
        }
    }
    return false;
}

void HoneypotService::updateZeroProofDeviceIP(const char* mac, IPAddress ip) {
    for (uint8_t i = 0; i < MAX_ZEROPROOF_DEVICES; i++) {
        if (_zeroproofDevices[i].active && strcmp(_zeroproofDevices[i].mac, mac) == 0) {
            _zeroproofDevices[i].ip = ip;
            _zeroproofDevices[i].lastSeen = millis();
            Serial.printf("[Honeypot] Updated IP for %s: %s\n", mac, ip.toString().c_str());
            return;
        }
    }
}

// ============================================================================
// ESP32-to-ESP32 Test Communication
// ============================================================================

void HoneypotService::startTestListener() {
    if (_testServer) {
        stopTestListener();
    }

    _testServer = new WiFiServer(ZEROPROOF_TEST_PORT);
    _testServer->begin();
    _testListenerEnabled = true;

    Serial.printf("[Honeypot] Test listener started on port %d\n", ZEROPROOF_TEST_PORT);
}

void HoneypotService::stopTestListener() {
    if (_testServer) {
        _testServer->end();
        delete _testServer;
        _testServer = nullptr;
    }
    _testListenerEnabled = false;
    Serial.println("[Honeypot] Test listener stopped");
}

bool HoneypotService::sendTestProbe(IPAddress targetIP, uint16_t port, const char* testId) {
    WiFiClient client;
    unsigned long startTime = millis();

    Serial.printf("[Test] Sending probe to %s:%d\n", targetIP.toString().c_str(), port);

    // Try to connect
    if (!client.connect(targetIP, port, 3000)) {
        Serial.printf("[Test] Connection failed to %s:%d\n", targetIP.toString().c_str(), port);

        // Report failure
        addTestResult("", targetIP, port, false, 0);
        return false;
    }

    unsigned long connectTime = millis() - startTime;

    // Send ZeroProof identification header
    // Format: ZEROPROOF:<deviceId>:<testId>\n
    String message = String(ZEROPROOF_MAGIC) + _deviceId + ":" + testId + "\n";
    client.print(message);

    // Wait for response
    char response[64] = {0};
    int len = 0;
    unsigned long timeout = millis() + 2000;

    while (client.connected() && millis() < timeout) {
        if (client.available()) {
            int c = client.read();
            if (c == '\n' || len >= 63) break;
            response[len++] = c;
        }
        delay(10);
    }
    response[len] = '\0';

    client.stop();

    unsigned long totalTime = millis() - startTime;

    // Check response
    bool success = (strncmp(response, "OK:", 3) == 0);

    Serial.printf("[Test] Probe result: %s (latency: %lums)\n",
                  success ? "SUCCESS" : "FAILED", totalTime);

    // Extract remote device ID from response if present
    char remoteDeviceId[32] = {0};
    if (success && len > 3) {
        strncpy(remoteDeviceId, response + 3, sizeof(remoteDeviceId) - 1);
    }

    addTestResult(remoteDeviceId, targetIP, port, success, (uint16_t)totalTime);

    return success;
}

void HoneypotService::handleTestConnection(WiFiClient& client) {
    IPAddress sourceIP = client.remoteIP();

    Serial.printf("[Test] Incoming test connection from %s\n", sourceIP.toString().c_str());

    // Blink activity LED
    digitalWrite(LED_ACTIVITY_PIN, HIGH);

    // Read incoming message
    char buffer[128] = {0};
    int len = 0;
    unsigned long timeout = millis() + 2000;

    while (client.connected() && millis() < timeout) {
        if (client.available()) {
            int c = client.read();
            if (c == '\n' || len >= 127) break;
            buffer[len++] = c;
        }
        delay(10);
    }
    buffer[len] = '\0';

    // Check for ZeroProof magic header
    if (strncmp(buffer, ZEROPROOF_MAGIC, ZEROPROOF_MAGIC_LEN) == 0) {
        // This is a legitimate ZeroProof test probe
        // Format: ZEROPROOF:<deviceId>:<testId>
        char* deviceIdStart = buffer + ZEROPROOF_MAGIC_LEN;
        char* colonPos = strchr(deviceIdStart, ':');

        char remoteDeviceId[32] = {0};
        if (colonPos) {
            int idLen = min((int)(colonPos - deviceIdStart), 31);
            strncpy(remoteDeviceId, deviceIdStart, idLen);
        }

        Serial.printf("[Test] Valid ZeroProof probe from device: %s\n", remoteDeviceId);

        // Send acknowledgment with our device ID
        String response = "OK:" + _deviceId + "\n";
        client.print(response);

        // Update device whitelist with this IP
        if (strlen(remoteDeviceId) > 0) {
            // Auto-register the device
            addZeroProofDevice("auto", remoteDeviceId, sourceIP);
        }
    } else {
        // Not a valid ZeroProof probe - could be attacker probing test port
        Serial.printf("[Test] Invalid probe data from %s: %s\n",
                      sourceIP.toString().c_str(), buffer);
        client.print("ERROR:Invalid\n");

        // Log as suspicious if honeypot is enabled
        if (_enabled) {
            addLog(sourceIP, client.remotePort(), ZEROPROOF_TEST_PORT,
                   HoneypotServiceType::GENERIC, buffer, len);
        }
    }

    client.stop();
    digitalWrite(LED_ACTIVITY_PIN, LOW);
}

void HoneypotService::addTestResult(const char* sourceDeviceId, IPAddress sourceIP,
                                    uint16_t port, bool success, uint16_t latencyMs) {
    TestCommResult& result = _testResults[_testResultHead];

    result.timestamp = millis();
    strncpy(result.sourceDeviceId, sourceDeviceId, sizeof(result.sourceDeviceId) - 1);
    result.sourceIP = sourceIP;
    strncpy(result.targetDeviceId, _deviceId.c_str(), sizeof(result.targetDeviceId) - 1);
    result.targetIP = WiFi.localIP();
    result.port = port;
    result.success = success;
    result.latencyMs = latencyMs;
    result.reported = false;

    _testResultHead = (_testResultHead + 1) % MAX_HONEYPOT_LOGS;
    if (_testResultCount < MAX_HONEYPOT_LOGS) _testResultCount++;
}

void HoneypotService::reportTestResults() {
    if (!_mqtt || !_mqtt->isConnected()) return;

    // Count unreported results
    int unreported = 0;
    for (uint8_t i = 0; i < _testResultCount; i++) {
        if (!_testResults[i].reported) unreported++;
    }

    if (unreported == 0) return;

    // Build JSON with test results
    DynamicJsonDocument doc(2048);
    doc["deviceId"] = _deviceId;
    doc["type"] = "test_results";
    doc["timestamp"] = millis();

    JsonArray results = doc.createNestedArray("results");
    int reported = 0;

    for (uint8_t i = 0; i < _testResultCount && reported < 10; i++) {
        TestCommResult& result = _testResults[i];
        if (result.reported) continue;

        JsonObject entry = results.createNestedObject();
        entry["ts"] = result.timestamp;
        entry["srcDevice"] = result.sourceDeviceId;
        entry["srcIp"] = result.sourceIP.toString();
        entry["tgtDevice"] = result.targetDeviceId;
        entry["tgtIp"] = result.targetIP.toString();
        entry["port"] = result.port;
        entry["success"] = result.success;
        entry["latencyMs"] = result.latencyMs;

        result.reported = true;
        reported++;
    }

    if (reported > 0) {
        String payload;
        serializeJson(doc, payload);

        String topic = String(MQTT_TOPIC_BASE) + _deviceId + "/test_results";
        _mqtt->publish(topic.c_str(), payload.c_str());

        Serial.printf("[Test] Reported %d test results\n", reported);
    }
}
