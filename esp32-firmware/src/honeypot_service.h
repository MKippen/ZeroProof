#ifndef HONEYPOT_SERVICE_H
#define HONEYPOT_SERVICE_H

#include <Arduino.h>
#include <WiFi.h>
#include <vector>
#include "mqtt_client.h"

// Maximum number of honeypot ports
#define MAX_HONEYPOT_PORTS 8

// Maximum connections to track
#define MAX_HONEYPOT_LOGS 50

// Maximum ZeroProof devices to whitelist
#define MAX_ZEROPROOF_DEVICES 16

// ZeroProof device identification magic header
#define ZEROPROOF_MAGIC "ZEROPROOF:"
#define ZEROPROOF_MAGIC_LEN 7

// Test communication port (dedicated for ESP32-to-ESP32 tests)
#define ZEROPROOF_TEST_PORT 9999

// Service type definitions with their banners
enum class HoneypotServiceType {
    SSH,
    TELNET,
    HTTP,
    FTP,
    MYSQL,
    REDIS,
    SMB,
    GENERIC
};

// Honeypot port configuration
struct HoneypotPort {
    uint16_t port;
    HoneypotServiceType serviceType;
    bool enabled;
    WiFiServer* server;
    uint32_t connectionCount;
};

// Connection log entry
struct HoneypotLog {
    uint32_t timestamp;      // millis() when connection occurred
    IPAddress sourceIP;
    uint16_t sourcePort;
    uint16_t destPort;
    HoneypotServiceType serviceType;
    char dataReceived[128];  // First 128 bytes of data received
    uint16_t dataLength;
    bool reported;           // Has this been sent to backend?
};

// ZeroProof device entry (whitelisted devices)
struct ZeroProofDevice {
    char mac[18];            // MAC address string
    char deviceId[32];       // Device ID from backend
    IPAddress ip;            // Last known IP
    uint32_t lastSeen;       // millis() when last seen
    bool active;             // Is this entry in use?
};

// Test communication result (ESP32-to-ESP32)
struct TestCommResult {
    uint32_t timestamp;
    char sourceDeviceId[32];
    IPAddress sourceIP;
    char targetDeviceId[32];
    IPAddress targetIP;
    uint16_t port;
    bool success;
    uint16_t latencyMs;
    bool reported;
};

class HoneypotService {
public:
    HoneypotService();

    // Initialize with MQTT client for reporting
    void begin(MQTTClient* mqtt, String deviceId);

    // Main loop - call from main loop()
    void loop();

    // Configuration
    void addPort(uint16_t port, HoneypotServiceType type);
    void removePort(uint16_t port);
    void clearPorts();
    void setEnabled(bool enabled);
    bool isEnabled() const { return _enabled; }

    // Configure from JSON (received via MQTT)
    void configureFromJson(JsonObject& config);

    // Get stats
    uint32_t getTotalConnections() const { return _totalConnections; }
    uint32_t getUnreportedLogs() const;

    // Get service banner for a service type
    static const char* getBanner(HoneypotServiceType type);
    static const char* getServiceName(HoneypotServiceType type);

    // ZeroProof device whitelisting
    void addZeroProofDevice(const char* mac, const char* deviceId, IPAddress ip);
    void removeZeroProofDevice(const char* mac);
    void clearZeroProofDevices();
    bool isZeroProofDevice(IPAddress ip);
    bool isZeroProofDevice(const char* mac);
    void updateZeroProofDeviceIP(const char* mac, IPAddress ip);

    // ESP32-to-ESP32 test communication
    bool sendTestProbe(IPAddress targetIP, uint16_t port, const char* testId);
    void startTestListener();
    void stopTestListener();
    bool isTestListenerRunning() const { return _testListenerEnabled; }

private:
    MQTTClient* _mqtt;
    String _deviceId;
    bool _enabled;
    bool _initialized;

    HoneypotPort _ports[MAX_HONEYPOT_PORTS];
    uint8_t _portCount;

    HoneypotLog _logs[MAX_HONEYPOT_LOGS];
    uint8_t _logHead;
    uint8_t _logCount;

    uint32_t _totalConnections;
    uint32_t _lastReportTime;

    // ZeroProof device whitelist
    ZeroProofDevice _zeroproofDevices[MAX_ZEROPROOF_DEVICES];
    uint8_t _zeroproofDeviceCount;

    // Test communication listener
    WiFiServer* _testServer;
    bool _testListenerEnabled;
    TestCommResult _testResults[MAX_HONEYPOT_LOGS];
    uint8_t _testResultHead;
    uint8_t _testResultCount;

    // Handle incoming connection
    void handleConnection(HoneypotPort& port, WiFiClient& client);

    // Handle ZeroProof test communication
    void handleTestConnection(WiFiClient& client);

    // Add log entry
    void addLog(IPAddress sourceIP, uint16_t sourcePort, uint16_t destPort,
                HoneypotServiceType type, const char* data, uint16_t dataLen);

    // Add test result
    void addTestResult(const char* sourceDeviceId, IPAddress sourceIP,
                       uint16_t port, bool success, uint16_t latencyMs);

    // Report logs to backend
    void reportLogs();
    void reportTestResults();

    // Start listening on configured ports
    void startListeners();
    void stopListeners();
};

#endif // HONEYPOT_SERVICE_H
