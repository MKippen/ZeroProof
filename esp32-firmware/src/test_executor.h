#ifndef TEST_EXECUTOR_H
#define TEST_EXECUTOR_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>
#include "mqtt_client.h"
#include "config.h"

enum TestType {
    TEST_NONE,
    TEST_CONNECTIVITY,
    TEST_PORT_SCAN,
    TEST_VLAN_ISOLATION,
    TEST_SERVICE_DISCOVERY,
    TEST_FULL_AUDIT
};

struct TestTask {
    String testId;
    TestType type;
    bool running;
    bool cancelled;
    int progress;

    // Options
    String targetIP;
    int startPort;
    int endPort;
    std::vector<int> targetVlans;
};

class TestExecutor {
public:
    TestExecutor();
    void begin(MQTTClient* mqtt, const String& deviceId);
    void loop();
    void startTest(const char* testId, const char* testType, JsonObject options);
    void cancelTest(const char* testId);
    bool isRunning();

private:
    MQTTClient* _mqtt;
    String _deviceId;
    TestTask _currentTask;

    void executeConnectivity();
    void executePortScan();
    void executeVlanIsolation();
    void executeServiceDiscovery();
    void executeFullAudit();

    bool scanPort(IPAddress ip, int port);
    String getBanner(IPAddress ip, int port);
    IPAddress getGatewayIP();
    IPAddress getSubnetIP(int host);
    void discoverHosts(std::vector<IPAddress>& hosts);
};

#endif
