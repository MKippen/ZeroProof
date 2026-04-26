#include "mqtt_client.h"

MQTTClient::MQTTClient() : _mqttClient(_wifiClient), _callback(nullptr), _lastReconnectAttempt(0) {}

void MQTTClient::begin(const String& deviceId, const String& broker, int port,
                       const String& username, const String& password) {
    _deviceId = deviceId;
    _broker = broker;
    _port = port;
    _username = username;
    _password = password;

    _mqttClient.setServer(_broker.c_str(), _port);
    _mqttClient.setBufferSize(MQTT_BUFFER_SIZE);
    _mqttClient.setKeepAlive(MQTT_KEEPALIVE);
}

void MQTTClient::setCallback(MessageCallback callback) {
    _callback = callback;
    _mqttClient.setCallback(callback);
}

bool MQTTClient::connect() {
    if (_broker.length() == 0) return false;

    Serial.print("Connecting to MQTT broker: ");
    Serial.println(_broker);

    bool connected = false;
    if (_username.length() > 0) {
        connected = _mqttClient.connect(_deviceId.c_str(), _username.c_str(), _password.c_str());
    } else {
        connected = _mqttClient.connect(_deviceId.c_str());
    }

    if (connected) {
        Serial.println("MQTT connected!");

        // Subscribe to command topic
        String cmdTopic = getCommandTopic();
        _mqttClient.subscribe(cmdTopic.c_str());
        Serial.print("Subscribed to: ");
        Serial.println(cmdTopic);

        return true;
    } else {
        Serial.print("MQTT connection failed, rc=");
        Serial.println(_mqttClient.state());
        return false;
    }
}

void MQTTClient::reconnect() {
    if (_broker.length() == 0) return;

    unsigned long now = millis();
    if (now - _lastReconnectAttempt > MQTT_RECONNECT_DELAY) {
        _lastReconnectAttempt = now;

        if (!_mqttClient.connected()) {
            Serial.println("Attempting MQTT reconnection...");
            connect();
        }
    }
}

void MQTTClient::disconnect() {
    _mqttClient.disconnect();
}

bool MQTTClient::isConnected() {
    return _mqttClient.connected();
}

void MQTTClient::loop() {
    _mqttClient.loop();
}

bool MQTTClient::publish(const char* topic, const char* payload) {
    if (!isConnected()) return false;
    return _mqttClient.publish(topic, payload);
}

bool MQTTClient::subscribe(const char* topic) {
    if (!isConnected()) return false;
    return _mqttClient.subscribe(topic);
}

String MQTTClient::getCommandTopic() {
    return String(MQTT_TOPIC_BASE) + _deviceId + MQTT_TOPIC_COMMAND;
}

void MQTTClient::publishProgress(const char* testId, int progress, const char* step) {
    if (!isConnected()) return;

    StaticJsonDocument<256> doc;
    doc["testId"] = testId;
    doc["deviceId"] = _deviceId;
    doc["progress"] = progress;
    doc["currentStep"] = step;

    String payload;
    serializeJson(doc, payload);

    String topic = String(MQTT_TOPIC_BASE) + _deviceId + MQTT_TOPIC_TEST_PROGRESS;
    publish(topic.c_str(), payload.c_str());
}

void MQTTClient::publishResults(const char* testId, bool success, const JsonDocument& results, const char* error) {
    if (!isConnected()) return;

    const size_t estimatedResultsSize = measureJson(results);
    size_t docCapacity = estimatedResultsSize + 1536;
    if (docCapacity < 4096) docCapacity = 4096;
    if (docCapacity > 32768) docCapacity = 32768;

    DynamicJsonDocument doc(docCapacity);
    doc["testId"] = testId;
    doc["deviceId"] = _deviceId;
    doc["success"] = success;
    doc["results"] = results;
    if (error) {
        doc["error"] = error;
    }
    doc["duration"] = millis() / 1000;  // Approximate

    String payload;
    serializeJson(doc, payload);

    String topic = String(MQTT_TOPIC_BASE) + _deviceId + MQTT_TOPIC_TEST_RESULTS;
    if (payload.length() <= MQTT_MAX_DIRECT_RESULTS_BYTES) {
        publish(topic.c_str(), payload.c_str());
        return;
    }

    Serial.print("Results payload too large for direct publish (");
    Serial.print(payload.length());
    Serial.println(" bytes), using chunked fallback.");

    if (!publishChunkedResults(testId, payload, success, error)) {
        Serial.println("Chunked publish failed, sending transport error payload.");
        DynamicJsonDocument errorDoc(768);
        errorDoc["testId"] = testId;
        errorDoc["deviceId"] = _deviceId;
        errorDoc["success"] = false;
        errorDoc["error"] = "Result payload exceeded MQTT limits and chunk publish failed";
        JsonObject transport = errorDoc.createNestedObject("transport");
        transport["chunked"] = true;
        transport["truncated"] = true;
        transport["incomplete"] = true;
        transport["reason"] = "chunk_publish_failed";
        errorDoc.createNestedArray("results");
        errorDoc["duration"] = millis() / 1000;

        String fallbackPayload;
        serializeJson(errorDoc, fallbackPayload);
        publish(topic.c_str(), fallbackPayload.c_str());
    }
}

bool MQTTClient::publishChunkedResults(const char* testId, const String& payload, bool success, const char* error) {
    if (!isConnected()) return false;

    const size_t totalLength = payload.length();
    const int chunkCount = static_cast<int>((totalLength + MQTT_RESULTS_CHUNK_SIZE - 1) / MQTT_RESULTS_CHUNK_SIZE);
    String chunkTopic = String(MQTT_TOPIC_BASE) + _deviceId + MQTT_TOPIC_TEST_RESULTS_CHUNK;

    for (int chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
        const size_t offset = static_cast<size_t>(chunkIndex) * MQTT_RESULTS_CHUNK_SIZE;
        const size_t remaining = totalLength - offset;
        const size_t length = remaining > MQTT_RESULTS_CHUNK_SIZE ? MQTT_RESULTS_CHUNK_SIZE : remaining;
        String chunkPayload = payload.substring(offset, offset + length);

        DynamicJsonDocument chunkDoc(MQTT_BUFFER_SIZE > 2048 ? MQTT_BUFFER_SIZE : 2048);
        chunkDoc["testId"] = testId;
        chunkDoc["deviceId"] = _deviceId;
        chunkDoc["chunkIndex"] = chunkIndex;
        chunkDoc["chunkCount"] = chunkCount;
        chunkDoc["payload"] = chunkPayload;
        chunkDoc["success"] = success;
        if (error) {
            chunkDoc["error"] = error;
        }
        chunkDoc["duration"] = millis() / 1000;

        String envelope;
        serializeJson(chunkDoc, envelope);
        if (!publish(chunkTopic.c_str(), envelope.c_str())) {
            Serial.print("Failed to publish chunk ");
            Serial.print(chunkIndex + 1);
            Serial.print("/");
            Serial.println(chunkCount);
            return false;
        }

        delay(5);
    }

    return true;
}
