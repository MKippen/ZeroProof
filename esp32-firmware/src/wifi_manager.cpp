#include "wifi_manager.h"
#include <Preferences.h>

extern Preferences preferences;

WiFiManager::WiFiManager() : _server(nullptr), _apMode(false), _connectStartTime(0) {}

void WiFiManager::begin(const String& deviceId) {
    _deviceId = deviceId;
    _apSSID = "ZeroProof-Setup";

    // Set hostname so UniFi/router can identify the device
    WiFi.setHostname(deviceId.c_str());
    WiFi.mode(WIFI_STA);
}

void WiFiManager::loop() {
    // Handle connection timeout
    if (_connectStartTime > 0 && !isConnected()) {
        if (millis() - _connectStartTime > WIFI_CONNECT_TIMEOUT) {
            Serial.println("WiFi connection timeout");
            _connectStartTime = 0;
            if (!_apMode) {
                startAPMode();
            }
        }
    }
}

bool WiFiManager::connect(const String& ssid, const String& password) {
    if (ssid.length() == 0) return false;

    Serial.print("Connecting to WiFi: ");
    Serial.println(ssid);

    WiFi.disconnect();
    delay(100);

    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), password.c_str());

    _connectStartTime = millis();

    // Wait for connection
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 60) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    Serial.println();

    _connectStartTime = 0;

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("Connected!");
        Serial.print("IP: ");
        Serial.println(WiFi.localIP());

        if (_apMode) {
            stopAPMode();
        }
        return true;
    }

    Serial.println("Connection failed");
    return false;
}

void WiFiManager::disconnect() {
    WiFi.disconnect();
}

bool WiFiManager::isConnected() {
    return WiFi.status() == WL_CONNECTED;
}

void WiFiManager::startAPMode() {
    Serial.println("Starting AP mode...");

    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(_apSSID.c_str());

    Serial.print("AP SSID: ");
    Serial.println(_apSSID);
    Serial.print("AP IP: ");
    Serial.println(WiFi.softAPIP());

    _apMode = true;
    setupWebServer();
}

void WiFiManager::stopAPMode() {
    if (_server) {
        _server->end();
        delete _server;
        _server = nullptr;
    }
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_STA);
    _apMode = false;
    Serial.println("AP mode stopped");
}

String WiFiManager::getSSID() {
    return WiFi.SSID();
}

void WiFiManager::setupWebServer() {
    if (_server) {
        delete _server;
    }

    _server = new AsyncWebServer(80);

    _server->on("/", HTTP_GET, [this](AsyncWebServerRequest *request) {
        request->send(200, "text/html", generateConfigPage());
    });

    _server->on("/configure", HTTP_POST, [this](AsyncWebServerRequest *request) {
        String ssid = "";
        String password = "";
        String mqttBroker = "";
        String mqttUser = "";
        String mqttPass = "";

        if (request->hasParam("ssid", true)) {
            ssid = request->getParam("ssid", true)->value();
        }
        if (request->hasParam("password", true)) {
            password = request->getParam("password", true)->value();
        }
        if (request->hasParam("mqtt_broker", true)) {
            mqttBroker = request->getParam("mqtt_broker", true)->value();
        }
        if (request->hasParam("mqtt_user", true)) {
            mqttUser = request->getParam("mqtt_user", true)->value();
        }
        if (request->hasParam("mqtt_pass", true)) {
            mqttPass = request->getParam("mqtt_pass", true)->value();
        }

        // Save settings
        preferences.putString("wifi_ssid", ssid);
        preferences.putString("wifi_pass", password);
        if (mqttBroker.length() > 0) {
            preferences.putString("mqtt_broker", mqttBroker);
            preferences.putString("mqtt_user", mqttUser);
            preferences.putString("mqtt_pass", mqttPass);
        }

        request->send(200, "text/html",
            "<html><body><h1>Configuration Saved!</h1>"
            "<p>The device will now restart and connect to your network.</p>"
            "</body></html>");

        delay(2000);
        ESP.restart();
    });

    _server->on("/scan", HTTP_GET, [](AsyncWebServerRequest *request) {
        String json = "[";
        int n = WiFi.scanComplete();

        if (n == -2) {
            WiFi.scanNetworks(true);
        } else if (n >= 0) {
            for (int i = 0; i < n; i++) {
                if (i > 0) json += ",";
                json += "{";
                json += "\"ssid\":\"" + WiFi.SSID(i) + "\",";
                json += "\"rssi\":" + String(WiFi.RSSI(i)) + ",";
                json += "\"secure\":" + String(WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
                json += "}";
            }
            WiFi.scanDelete();
            WiFi.scanNetworks(true);
        }

        json += "]";
        request->send(200, "application/json", json);
    });

    _server->begin();
    Serial.println("Web server started on port 80");
}

String WiFiManager::generateConfigPage() {
    String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ZeroProof Setup</title>
    <style>
        body { font-family: Arial; margin: 20px; background: #0f172a; color: #e2e8f0; }
        .container { max-width: 400px; margin: 0 auto; background: #1e293b; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); }
        .logo { text-align: center; margin-bottom: 20px; }
        .logo svg { width: 60px; height: 60px; }
        h1 { color: #38bdf8; font-size: 1.5em; text-align: center; margin: 0 0 5px 0; }
        .subtitle { text-align: center; color: #94a3b8; font-size: 0.9em; margin-bottom: 20px; }
        label { display: block; margin-top: 15px; color: #94a3b8; }
        input, select { width: 100%; padding: 10px; margin-top: 5px; border: 1px solid #334155; border-radius: 4px; box-sizing: border-box; background: #0f172a; color: #e2e8f0; }
        input:focus { outline: none; border-color: #38bdf8; }
        button { width: 100%; padding: 12px; margin-top: 20px; background: #0ea5e9; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1em; }
        button:hover { background: #0284c7; }
        .networks { margin-top: 10px; }
        .network { padding: 10px; border: 1px solid #334155; margin: 5px 0; border-radius: 4px; cursor: pointer; background: #0f172a; }
        .network:hover { background: #334155; }
        .signal { float: right; color: #64748b; }
        h2 { margin-top: 30px; font-size: 1.2em; color: #38bdf8; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="45" stroke="#38bdf8" stroke-width="3" fill="none"/>
                <path d="M30 50 L45 65 L70 35" stroke="#22c55e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                <circle cx="50" cy="20" r="5" fill="#38bdf8"/>
                <circle cx="80" cy="50" r="5" fill="#38bdf8"/>
                <circle cx="50" cy="80" r="5" fill="#38bdf8"/>
                <circle cx="20" cy="50" r="5" fill="#38bdf8"/>
            </svg>
        </div>
        <h1>ZeroProof</h1>
        <p class="subtitle">Network Security Probe</p>

        <form action="/configure" method="POST">
            <h2>WiFi Settings</h2>
            <div class="networks" id="networks">Scanning...</div>

            <label>WiFi SSID</label>
            <input type="text" name="ssid" id="ssid" required>

            <label>WiFi Password</label>
            <input type="password" name="password">

            <h2>MQTT Settings</h2>
            <label>MQTT Broker IP</label>
            <input type="text" name="mqtt_broker" placeholder="192.168.1.x">

            <label>MQTT Username</label>
            <input type="text" name="mqtt_user" placeholder="auditor">

            <label>MQTT Password</label>
            <input type="password" name="mqtt_pass">

            <button type="submit">Save Configuration</button>
        </form>
    </div>

    <script>
        function loadNetworks() {
            fetch('/scan')
                .then(r => r.json())
                .then(networks => {
                    let html = '';
                    networks.forEach(n => {
                        let signal = n.rssi > -50 ? '▂▄▆█' : n.rssi > -70 ? '▂▄▆_' : n.rssi > -80 ? '▂▄__' : '▂___';
                        html += '<div class="network" onclick="document.getElementById(\'ssid\').value=\'' + n.ssid + '\'">' +
                            n.ssid + (n.secure ? ' 🔒' : '') +
                            '<span class="signal">' + signal + '</span></div>';
                    });
                    document.getElementById('networks').innerHTML = html || 'No networks found';
                })
                .catch(() => {
                    document.getElementById('networks').innerHTML = 'Scan failed';
                });
        }
        loadNetworks();
        setInterval(loadNetworks, 10000);
    </script>
</body>
</html>
)rawliteral";
    return html;
}
