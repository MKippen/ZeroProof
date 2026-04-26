#ifndef MQTT_CLIENT_H
#define MQTT_CLIENT_H

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "config.h"

typedef void (*MessageCallback)(char* topic, byte* payload, unsigned int length);

class MQTTClient {
public:
    MQTTClient();
    void begin(const String& deviceId, const String& broker, int port,
               const String& username, const String& password);
    void setCallback(MessageCallback callback);
    bool connect();
    void reconnect();
    void disconnect();
    bool isConnected();
    void loop();
    bool publish(const char* topic, const char* payload);
    bool subscribe(const char* topic);

    void publishProgress(const char* testId, int progress, const char* step);
    void publishResults(const char* testId, bool success, const JsonDocument& results, const char* error = nullptr);

private:
    WiFiClient _wifiClient;
    PubSubClient _mqttClient;
    String _deviceId;
    String _broker;
    int _port;
    String _username;
    String _password;
    MessageCallback _callback;
    unsigned long _lastReconnectAttempt;

    String getCommandTopic();
    bool publishChunkedResults(const char* testId, const String& payload, bool success, const char* error);
};

#endif
