#include "command_executor.h"

CommandExecutor::CommandExecutor() : _mqtt(nullptr), _running(false), _cancelled(false), _commandsDoc(nullptr), _results(nullptr) {}

void CommandExecutor::begin(MQTTClient* mqtt, const String& deviceId) {
    _mqtt = mqtt;
    _deviceId = deviceId;
}

bool CommandExecutor::isRunning() {
    return _running;
}

void CommandExecutor::cancel() {
    _cancelled = true;
}

void CommandExecutor::executeBatch(const char* testId, JsonArray commands) {
    if (_running) {
        Serial.println("Already running a job");
        return;
    }

    _currentTestId = String(testId);
    _running = true;
    _cancelled = false;
    _currentCommandIndex = 0;
    _totalCommands = commands.size();

    // Allocate results document
    if (_results) delete _results;
    _results = new DynamicJsonDocument(8192);
    (*_results)["testId"] = testId;
    (*_results)["deviceId"] = _deviceId;
    (*_results).createNestedArray("results");

    // Deep copy commands by serializing and re-parsing the entire array
    // (source doc will be destroyed after MQTT callback returns)
    if (_commandsDoc) delete _commandsDoc;
    _commandsDoc = new DynamicJsonDocument(4096);

    // Serialize the commands array to string
    String commandsJson;
    serializeJson(commands, commandsJson);
    Serial.print("Commands JSON: ");
    Serial.println(commandsJson);

    // Deserialize into our persistent document
    DeserializationError copyError = deserializeJson(*_commandsDoc, commandsJson);
    if (copyError) {
        Serial.print("Failed to copy commands: ");
        Serial.println(copyError.c_str());
        _running = false;
        return;
    }
    _pendingCommands = _commandsDoc->as<JsonArray>();

    Serial.print("Starting batch job with ");
    Serial.print(_totalCommands);
    Serial.println(" commands");

    _mqtt->publishProgress(testId, 0, "Starting");
}

void CommandExecutor::loop() {
    if (!_running || !_commandsDoc) return;

    if (_cancelled) {
        Serial.println("Job cancelled");
        _mqtt->publishProgress(_currentTestId.c_str(), 100, "Cancelled");

        // Send partial results
        (*_results)["cancelled"] = true;
        _mqtt->publishResults(_currentTestId.c_str(), false, *_results, "Cancelled by user");

        _running = false;
        delete _results;
        _results = nullptr;
        delete _commandsDoc;
        _commandsDoc = nullptr;
        return;
    }

    // Execute next command
    if (_currentCommandIndex < _totalCommands) {
        JsonObject cmd = _pendingCommands[_currentCommandIndex];
        const char* op = cmd["op"] | "unknown";

        // Update progress
        int progress = (_currentCommandIndex * 100) / _totalCommands;
        char step[64];
        snprintf(step, sizeof(step), "Executing: %s (%d/%d)", op, _currentCommandIndex + 1, _totalCommands);
        _mqtt->publishProgress(_currentTestId.c_str(), progress, step);

        Serial.print("Executing command: ");
        Serial.println(op);

        // Execute and store result
        JsonArray resultsArray = (*_results)["results"];
        JsonObject result = resultsArray.createNestedObject();
        result["op"] = op;
        result["index"] = _currentCommandIndex;

        executeCommand(cmd, result);

        _currentCommandIndex++;
        yield();  // Allow other tasks to run
    }

    // Check if done
    if (_currentCommandIndex >= _totalCommands) {
        Serial.println("Batch job complete");
        _mqtt->publishProgress(_currentTestId.c_str(), 100, "Complete");
        _mqtt->publishResults(_currentTestId.c_str(), true, *_results);

        _running = false;
        delete _results;
        _results = nullptr;
        delete _commandsDoc;
        _commandsDoc = nullptr;
    }
}

JsonObject CommandExecutor::executeCommand(JsonObject cmd, JsonObject result) {
    const char* op = cmd["op"] | "unknown";

    if (strcmp(op, OP_GET_NETWORK_INFO) == 0) {
        opGetNetworkInfo(result);
    } else if (strcmp(op, OP_TCP_CONNECT) == 0) {
        opTcpConnect(cmd, result);
    } else if (strcmp(op, OP_TCP_BANNER) == 0) {
        opTcpBanner(cmd, result);
    } else if (strcmp(op, OP_ARP_SCAN) == 0) {
        opArpScan(cmd, result);
    } else if (strcmp(op, OP_DNS_LOOKUP) == 0) {
        opDnsLookup(cmd, result);
    } else if (strcmp(op, OP_PING) == 0) {
        opPing(cmd, result);
    } else {
        result["success"] = false;
        result["error"] = "Unknown operation";
    }

    return result;
}

void CommandExecutor::opGetNetworkInfo(JsonObject result) {
    result["success"] = true;
    JsonObject data = result.createNestedObject("data");

    data["localIP"] = WiFi.localIP().toString();
    data["gateway"] = WiFi.gatewayIP().toString();
    data["subnet"] = WiFi.subnetMask().toString();
    data["dns"] = WiFi.dnsIP().toString();
    data["mac"] = WiFi.macAddress();
    data["ssid"] = WiFi.SSID();
    data["rssi"] = WiFi.RSSI();
    data["channel"] = WiFi.channel();
    data["freeHeap"] = ESP.getFreeHeap();
    data["uptime"] = millis() / 1000;
}

void CommandExecutor::opTcpConnect(JsonObject cmd, JsonObject result) {
    const char* host = cmd["host"] | "";
    int port = cmd["port"] | 80;
    int timeout = cmd["timeout"] | DEFAULT_TCP_TIMEOUT;

    if (strlen(host) == 0) {
        result["success"] = false;
        result["error"] = "Missing host parameter";
        return;
    }

    IPAddress ip;
    if (!ip.fromString(host)) {
        // Try DNS lookup
        if (WiFi.hostByName(host, ip) != 1) {
            result["success"] = false;
            result["error"] = "DNS lookup failed";
            return;
        }
    }

    bool connected = tcpConnect(ip, port, timeout);

    result["success"] = true;
    JsonObject data = result.createNestedObject("data");
    data["host"] = host;
    data["ip"] = ip.toString();
    data["port"] = port;
    data["open"] = connected;
}

void CommandExecutor::opTcpBanner(JsonObject cmd, JsonObject result) {
    const char* host = cmd["host"] | "";
    int port = cmd["port"] | 80;
    int timeout = cmd["timeout"] | DEFAULT_BANNER_TIMEOUT;

    if (strlen(host) == 0) {
        result["success"] = false;
        result["error"] = "Missing host parameter";
        return;
    }

    IPAddress ip;
    if (!ip.fromString(host)) {
        if (WiFi.hostByName(host, ip) != 1) {
            result["success"] = false;
            result["error"] = "DNS lookup failed";
            return;
        }
    }

    String banner = tcpGetBanner(ip, port, timeout);

    result["success"] = true;
    JsonObject data = result.createNestedObject("data");
    data["host"] = host;
    data["ip"] = ip.toString();
    data["port"] = port;
    data["open"] = banner.length() > 0 || tcpConnect(ip, port, timeout);
    data["banner"] = banner;
}

void CommandExecutor::opArpScan(JsonObject cmd, JsonObject result) {
    int timeout = cmd["timeout"] | DEFAULT_ARP_TIMEOUT;
    int startHost = cmd["startHost"] | 1;
    int endHost = cmd["endHost"] | 254;

    result["success"] = true;
    JsonObject data = result.createNestedObject("data");
    JsonArray hosts = data.createNestedArray("hosts");

    IPAddress localIP = WiFi.localIP();
    data["subnet"] = String(localIP[0]) + "." + String(localIP[1]) + "." + String(localIP[2]) + ".0/24";

    Serial.print("Scanning subnet, hosts ");
    Serial.print(startHost);
    Serial.print("-");
    Serial.println(endHost);

    // Scan the subnet - quick single-port probe for speed
    int scanned = 0;
    for (int i = startHost; i <= endHost && !_cancelled; i++) {
        IPAddress target(localIP[0], localIP[1], localIP[2], i);

        // Skip our own IP
        if (target == localIP) continue;

        // Quick TCP probe to port 80 only for speed (50ms timeout)
        if (tcpConnect(target, 80, 50)) {
            hosts.add(target.toString());
            Serial.print("Found: ");
            Serial.println(target);
        }

        scanned++;
        // Progress update every 50 hosts
        if (scanned % 50 == 0) {
            Serial.print("Scanned ");
            Serial.print(scanned);
            Serial.println(" hosts...");
        }
        yield();
    }

    data["count"] = hosts.size();
    Serial.print("Scan complete, found ");
    Serial.print(hosts.size());
    Serial.println(" hosts");
}

void CommandExecutor::opDnsLookup(JsonObject cmd, JsonObject result) {
    const char* hostname = cmd["hostname"] | "";

    if (strlen(hostname) == 0) {
        result["success"] = false;
        result["error"] = "Missing hostname parameter";
        return;
    }

    IPAddress ip;
    bool resolved = WiFi.hostByName(hostname, ip) == 1;

    result["success"] = true;
    JsonObject data = result.createNestedObject("data");
    data["hostname"] = hostname;
    data["resolved"] = resolved;
    if (resolved) {
        data["ip"] = ip.toString();
    }
}

void CommandExecutor::opPing(JsonObject cmd, JsonObject result) {
    // ESP32 doesn't have native ICMP ping in Arduino framework
    // We'll simulate with TCP connect to common ports
    const char* host = cmd["host"] | "";
    int timeout = cmd["timeout"] | DEFAULT_TCP_TIMEOUT;

    if (strlen(host) == 0) {
        result["success"] = false;
        result["error"] = "Missing host parameter";
        return;
    }

    IPAddress ip;
    if (!ip.fromString(host)) {
        if (WiFi.hostByName(host, ip) != 1) {
            result["success"] = false;
            result["error"] = "DNS lookup failed";
            return;
        }
    }

    unsigned long start = millis();
    bool reachable = tcpConnect(ip, 80, timeout) ||
                     tcpConnect(ip, 443, timeout) ||
                     tcpConnect(ip, 22, timeout) ||
                     tcpConnect(ip, 53, timeout);
    unsigned long elapsed = millis() - start;

    result["success"] = true;
    JsonObject data = result.createNestedObject("data");
    data["host"] = host;
    data["ip"] = ip.toString();
    data["reachable"] = reachable;
    data["latency"] = elapsed;
}

bool CommandExecutor::tcpConnect(IPAddress ip, int port, int timeout) {
    WiFiClient client;
    // Use connect() with explicit timeout in ms
    bool connected = client.connect(ip, port, timeout);
    if (connected) {
        client.stop();
    }
    return connected;
}

String CommandExecutor::tcpGetBanner(IPAddress ip, int port, int timeout) {
    WiFiClient client;

    if (!client.connect(ip, port, timeout)) {
        return "";
    }
    client.setTimeout(timeout);

    // Wait for data
    unsigned long start = millis();
    while (!client.available() && millis() - start < (unsigned long)timeout) {
        delay(10);
    }

    String banner = "";
    while (client.available() && banner.length() < 256) {
        char c = client.read();
        if (c >= 32 && c < 127) {
            banner += c;
        }
    }

    client.stop();
    return banner;
}
