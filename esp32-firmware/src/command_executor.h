#ifndef COMMAND_EXECUTOR_H
#define COMMAND_EXECUTOR_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <vector>
#include "mqtt_client.h"

// Supported operations
#define OP_GET_NETWORK_INFO "get_network_info"
#define OP_TCP_CONNECT "tcp_connect"
#define OP_TCP_BANNER "tcp_banner"
#define OP_ARP_SCAN "arp_scan"
#define OP_DNS_LOOKUP "dns_lookup"
#define OP_PING "ping"

// Default timeouts
#define DEFAULT_TCP_TIMEOUT 1000
#define DEFAULT_BANNER_TIMEOUT 2000
#define DEFAULT_ARP_TIMEOUT 50

class CommandExecutor {
public:
    CommandExecutor();
    void begin(MQTTClient* mqtt, const String& deviceId);

    // Execute a batch of commands from JSON
    void executeBatch(const char* testId, JsonArray commands);

    // Check if currently executing
    bool isRunning();

    // Cancel current execution
    void cancel();

    // Call in loop() to process commands
    void loop();

private:
    MQTTClient* _mqtt;
    String _deviceId;

    // Current job state
    bool _running;
    bool _cancelled;
    String _currentTestId;
    DynamicJsonDocument* _commandsDoc;  // Owns the commands data
    JsonArray _pendingCommands;
    DynamicJsonDocument* _results;
    int _currentCommandIndex;
    int _totalCommands;

    // Execute single command and return result
    JsonObject executeCommand(JsonObject cmd, JsonObject result);

    // Individual operation implementations
    void opGetNetworkInfo(JsonObject result);
    void opTcpConnect(JsonObject cmd, JsonObject result);
    void opTcpBanner(JsonObject cmd, JsonObject result);
    void opArpScan(JsonObject cmd, JsonObject result);
    void opDnsLookup(JsonObject cmd, JsonObject result);
    void opPing(JsonObject cmd, JsonObject result);

    // Helper functions
    bool tcpConnect(IPAddress ip, int port, int timeout);
    String tcpGetBanner(IPAddress ip, int port, int timeout);
    void discoverHosts(JsonArray hosts, int timeout);
};

#endif
