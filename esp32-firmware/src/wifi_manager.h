#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include "config.h"

class WiFiManager {
public:
    WiFiManager();
    void begin(const String& deviceId);
    void loop();
    bool connect(const String& ssid, const String& password);
    void disconnect();
    bool isConnected();
    void startAPMode();
    void stopAPMode();
    String getSSID();

private:
    String _deviceId;
    String _apSSID;
    AsyncWebServer* _server;
    bool _apMode;
    unsigned long _connectStartTime;

    void setupWebServer();
    String generateConfigPage();
};

#endif
