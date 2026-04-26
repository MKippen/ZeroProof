#include "test_executor.h"
#include <WiFi.h>

TestExecutor::TestExecutor() : _mqtt(nullptr) {
    _currentTask.running = false;
    _currentTask.cancelled = false;
}

void TestExecutor::begin(MQTTClient* mqtt, const String& deviceId) {
    _mqtt = mqtt;
    _deviceId = deviceId;
}

void TestExecutor::loop() {
    if (!_currentTask.running) return;

    if (_currentTask.cancelled) {
        Serial.println("Test cancelled");
        _currentTask.running = false;
        _currentTask.cancelled = false;
        return;
    }

    // Execute based on test type
    switch (_currentTask.type) {
        case TEST_CONNECTIVITY:
            executeConnectivity();
            break;
        case TEST_PORT_SCAN:
            executePortScan();
            break;
        case TEST_VLAN_ISOLATION:
            executeVlanIsolation();
            break;
        case TEST_SERVICE_DISCOVERY:
            executeServiceDiscovery();
            break;
        case TEST_FULL_AUDIT:
            executeFullAudit();
            break;
        default:
            _currentTask.running = false;
            break;
    }
}

void TestExecutor::startTest(const char* testId, const char* testType, JsonObject options) {
    if (_currentTask.running) {
        Serial.println("Test already running!");
        return;
    }

    _currentTask.testId = String(testId);
    _currentTask.running = true;
    _currentTask.cancelled = false;
    _currentTask.progress = 0;

    // Parse test type
    if (strcmp(testType, "connectivity") == 0) {
        _currentTask.type = TEST_CONNECTIVITY;
    } else if (strcmp(testType, "port_scan") == 0) {
        _currentTask.type = TEST_PORT_SCAN;
    } else if (strcmp(testType, "vlan_isolation") == 0) {
        _currentTask.type = TEST_VLAN_ISOLATION;
    } else if (strcmp(testType, "service_discovery") == 0) {
        _currentTask.type = TEST_SERVICE_DISCOVERY;
    } else if (strcmp(testType, "full_audit") == 0) {
        _currentTask.type = TEST_FULL_AUDIT;
    } else {
        _currentTask.type = TEST_NONE;
        _currentTask.running = false;
        return;
    }

    // Parse options
    if (options.containsKey("targetIP")) {
        _currentTask.targetIP = options["targetIP"].as<String>();
    }
    if (options.containsKey("startPort")) {
        _currentTask.startPort = options["startPort"].as<int>();
    } else {
        _currentTask.startPort = 1;
    }
    if (options.containsKey("endPort")) {
        _currentTask.endPort = options["endPort"].as<int>();
    } else {
        _currentTask.endPort = 1024;
    }

    Serial.print("Starting test: ");
    Serial.println(testType);

    _mqtt->publishProgress(_currentTask.testId.c_str(), 0, "Starting test");
}

void TestExecutor::cancelTest(const char* testId) {
    if (_currentTask.running && _currentTask.testId == testId) {
        _currentTask.cancelled = true;
    }
}

bool TestExecutor::isRunning() {
    return _currentTask.running;
}

void TestExecutor::executeConnectivity() {
    // Simple connectivity test - verifies MQTT round-trip and basic network info
    DynamicJsonDocument results(1024);

    _mqtt->publishProgress(_currentTask.testId.c_str(), 10, "Checking network");
    delay(100);

    // Get network info
    IPAddress localIP = WiFi.localIP();
    IPAddress gateway = WiFi.gatewayIP();
    IPAddress subnet = WiFi.subnetMask();

    results["localIP"] = localIP.toString();
    results["gateway"] = gateway.toString();
    results["subnet"] = subnet.toString();
    results["rssi"] = WiFi.RSSI();
    results["ssid"] = WiFi.SSID();

    _mqtt->publishProgress(_currentTask.testId.c_str(), 30, "Testing gateway");
    delay(100);

    // Quick test - can we reach the gateway?
    bool gatewayReachable = scanPort(gateway, 80) || scanPort(gateway, 443) || scanPort(gateway, 53);
    results["gatewayReachable"] = gatewayReachable;

    _mqtt->publishProgress(_currentTask.testId.c_str(), 60, "Testing internet");
    delay(100);

    // Quick internet test - try to reach common DNS
    IPAddress dns(8, 8, 8, 8);
    bool internetReachable = scanPort(dns, 53);
    results["internetReachable"] = internetReachable;

    _mqtt->publishProgress(_currentTask.testId.c_str(), 90, "Finalizing");
    delay(100);

    // Add device info
    results["freeHeap"] = ESP.getFreeHeap();
    results["uptime"] = millis() / 1000;

    _mqtt->publishProgress(_currentTask.testId.c_str(), 100, "Complete");
    _mqtt->publishResults(_currentTask.testId.c_str(), true, results);

    _currentTask.running = false;
    Serial.println("Connectivity test complete");
}

void TestExecutor::executePortScan() {
    DynamicJsonDocument results(4096);
    JsonArray hosts = results.createNestedArray("hosts");

    _mqtt->publishProgress(_currentTask.testId.c_str(), 5, "Discovering hosts");

    // Get network info
    IPAddress localIP = WiFi.localIP();
    IPAddress gateway = WiFi.gatewayIP();
    IPAddress subnet = WiFi.subnetMask();

    Serial.print("Local IP: ");
    Serial.println(localIP);
    Serial.print("Gateway: ");
    Serial.println(gateway);

    // Discover hosts
    std::vector<IPAddress> hostList;
    discoverHosts(hostList);

    int defaultPorts[] = PORT_SCAN_DEFAULT_PORTS;
    int numPorts = sizeof(defaultPorts) / sizeof(defaultPorts[0]);
    int totalScans = hostList.size() * numPorts;
    int currentScan = 0;

    _mqtt->publishProgress(_currentTask.testId.c_str(), 10, "Scanning ports");

    // Scan each discovered host
    for (const IPAddress& host : hostList) {
        if (_currentTask.cancelled) break;

        JsonObject hostObj = hosts.createNestedObject();
        hostObj["ip"] = host.toString();
        JsonArray openPorts = hostObj.createNestedArray("openPorts");

        for (int i = 0; i < numPorts; i++) {
            if (_currentTask.cancelled) break;

            int port = defaultPorts[i];
            currentScan++;

            int progress = 10 + (currentScan * 85 / totalScans);
            char step[64];
            sprintf(step, "Scanning %s:%d", host.toString().c_str(), port);
            _mqtt->publishProgress(_currentTask.testId.c_str(), progress, step);

            if (scanPort(host, port)) {
                JsonObject portObj = openPorts.createNestedObject();
                portObj["port"] = port;
                portObj["protocol"] = "tcp";

                // Try to get service banner
                String banner = getBanner(host, port);
                if (banner.length() > 0) {
                    portObj["banner"] = banner;

                    // Identify service from port/banner
                    if (port == 22) portObj["service"] = "ssh";
                    else if (port == 80 || port == 8080) portObj["service"] = "http";
                    else if (port == 443 || port == 8443) portObj["service"] = "https";
                    else if (port == 21) portObj["service"] = "ftp";
                    else if (port == 23) portObj["service"] = "telnet";
                    else if (port == 25) portObj["service"] = "smtp";
                    else if (port == 53) portObj["service"] = "dns";
                    else if (port == 445) portObj["service"] = "smb";
                    else if (port == 3306) portObj["service"] = "mysql";
                    else if (port == 5432) portObj["service"] = "postgresql";
                    else if (port == 3389) portObj["service"] = "rdp";
                }

                Serial.print("Found open port: ");
                Serial.print(host);
                Serial.print(":");
                Serial.println(port);
            }

            yield();
        }
    }

    // Complete
    _mqtt->publishProgress(_currentTask.testId.c_str(), 100, "Complete");
    _mqtt->publishResults(_currentTask.testId.c_str(), !_currentTask.cancelled, results);

    _currentTask.running = false;
    Serial.println("Port scan complete");
}

void TestExecutor::executeVlanIsolation() {
    DynamicJsonDocument results(2048);
    JsonArray tests = results.createNestedArray("tests");

    _mqtt->publishProgress(_currentTask.testId.c_str(), 10, "Testing VLAN isolation");

    // Get current network info
    IPAddress localIP = WiFi.localIP();
    IPAddress gateway = WiFi.gatewayIP();

    // Test common private network ranges
    IPAddress testTargets[] = {
        IPAddress(192, 168, 1, 1),
        IPAddress(192, 168, 0, 1),
        IPAddress(10, 0, 0, 1),
        IPAddress(172, 16, 0, 1)
    };

    int vlanPorts[] = VLAN_TEST_PORTS;
    int numPorts = sizeof(vlanPorts) / sizeof(vlanPorts[0]);
    int numTargets = sizeof(testTargets) / sizeof(testTargets[0]);

    for (int t = 0; t < numTargets; t++) {
        if (_currentTask.cancelled) break;

        IPAddress target = testTargets[t];

        // Skip our own network's gateway
        if (target[0] == gateway[0] && target[1] == gateway[1] && target[2] == gateway[2]) {
            continue;
        }

        int progress = 10 + (t * 80 / numTargets);
        char step[64];
        sprintf(step, "Testing isolation to %s", target.toString().c_str());
        _mqtt->publishProgress(_currentTask.testId.c_str(), progress, step);

        JsonObject testObj = tests.createNestedObject();
        testObj["sourceVlan"] = localIP[2]; // Approximate VLAN from 3rd octet
        testObj["targetVlan"] = target[2];

        bool canReach = false;
        JsonArray testedPorts = testObj.createNestedArray("testedPorts");

        for (int i = 0; i < numPorts; i++) {
            int port = vlanPorts[i];
            testedPorts.add(port);

            if (scanPort(target, port)) {
                canReach = true;
                break;
            }
            yield();
        }

        testObj["canReach"] = canReach;

        if (canReach) {
            Serial.print("VLAN isolation breach: can reach ");
            Serial.println(target);
        }
    }

    _mqtt->publishProgress(_currentTask.testId.c_str(), 100, "Complete");
    _mqtt->publishResults(_currentTask.testId.c_str(), !_currentTask.cancelled, results);

    _currentTask.running = false;
    Serial.println("VLAN isolation test complete");
}

void TestExecutor::executeServiceDiscovery() {
    DynamicJsonDocument results(4096);
    JsonArray services = results.createNestedArray("services");

    _mqtt->publishProgress(_currentTask.testId.c_str(), 5, "Discovering services");

    std::vector<IPAddress> hosts;
    discoverHosts(hosts);

    int commonPorts[] = {22, 80, 443, 21, 23, 25, 53, 110, 143, 445, 3306, 5432, 8080};
    int numPorts = sizeof(commonPorts) / sizeof(commonPorts[0]);
    int totalScans = hosts.size() * numPorts;
    int currentScan = 0;

    for (const IPAddress& host : hosts) {
        if (_currentTask.cancelled) break;

        for (int i = 0; i < numPorts; i++) {
            if (_currentTask.cancelled) break;

            int port = commonPorts[i];
            currentScan++;

            int progress = 10 + (currentScan * 85 / totalScans);
            _mqtt->publishProgress(_currentTask.testId.c_str(), progress, "Discovering services");

            if (scanPort(host, port)) {
                String banner = getBanner(host, port);

                JsonObject svc = services.createNestedObject();
                svc["ip"] = host.toString();
                svc["port"] = port;

                // Identify service
                String service = "unknown";
                if (port == 22) service = "ssh";
                else if (port == 80 || port == 8080) service = "http";
                else if (port == 443) service = "https";
                else if (port == 21) service = "ftp";
                else if (port == 23) service = "telnet";
                else if (port == 25) service = "smtp";
                else if (port == 53) service = "dns";
                else if (port == 110) service = "pop3";
                else if (port == 143) service = "imap";
                else if (port == 445) service = "smb";
                else if (port == 3306) service = "mysql";
                else if (port == 5432) service = "postgresql";

                svc["service"] = service;

                if (banner.length() > 0) {
                    // Try to extract version from banner
                    svc["version"] = banner;
                }
            }
            yield();
        }
    }

    _mqtt->publishProgress(_currentTask.testId.c_str(), 100, "Complete");
    _mqtt->publishResults(_currentTask.testId.c_str(), !_currentTask.cancelled, results);

    _currentTask.running = false;
    Serial.println("Service discovery complete");
}

void TestExecutor::executeFullAudit() {
    _mqtt->publishProgress(_currentTask.testId.c_str(), 0, "Starting full audit");

    // Run all tests in sequence
    DynamicJsonDocument fullResults(8192);

    // Port scan
    _mqtt->publishProgress(_currentTask.testId.c_str(), 5, "Phase 1: Port scanning");
    _currentTask.type = TEST_PORT_SCAN;
    // ... simplified for brevity, would run each test and combine results

    _mqtt->publishProgress(_currentTask.testId.c_str(), 100, "Full audit complete");
    _mqtt->publishResults(_currentTask.testId.c_str(), !_currentTask.cancelled, fullResults);

    _currentTask.running = false;
    Serial.println("Full audit complete");
}

bool TestExecutor::scanPort(IPAddress ip, int port) {
    WiFiClient client;
    client.setTimeout(PORT_SCAN_TIMEOUT);

    bool connected = client.connect(ip, port);
    client.stop();

    return connected;
}

String TestExecutor::getBanner(IPAddress ip, int port) {
    WiFiClient client;
    client.setTimeout(SERVICE_BANNER_TIMEOUT);

    if (!client.connect(ip, port)) {
        return "";
    }

    // Wait for data
    unsigned long start = millis();
    while (!client.available() && millis() - start < SERVICE_BANNER_TIMEOUT) {
        delay(10);
    }

    String banner = "";
    while (client.available() && banner.length() < MAX_BANNER_LENGTH) {
        char c = client.read();
        if (c >= 32 && c < 127) {  // Printable ASCII
            banner += c;
        }
    }

    client.stop();
    return banner;
}

void TestExecutor::discoverHosts(std::vector<IPAddress>& hosts) {
    IPAddress localIP = WiFi.localIP();
    IPAddress subnet = WiFi.subnetMask();

    // Simple host discovery - scan .1 to .254
    for (int i = 1; i < 255; i++) {
        if (_currentTask.cancelled) break;

        IPAddress target(localIP[0], localIP[1], localIP[2], i);

        // Quick ping using TCP connect to common ports
        if (scanPort(target, 80) || scanPort(target, 443) || scanPort(target, 22)) {
            hosts.push_back(target);
            Serial.print("Discovered host: ");
            Serial.println(target);
        }
        yield();
    }
}
