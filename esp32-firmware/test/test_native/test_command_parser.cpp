/**
 * Native tests for command parsing functionality
 * These tests run on the host machine without ESP32 hardware
 */

#include <unity.h>
#include <string.h>
#include <stdlib.h>

// Mock ArduinoJson for native testing
#define ARDUINOJSON_ENABLE_STD_STRING 1
#include <ArduinoJson.h>

void setUp(void) {
    // Set up before each test
}

void tearDown(void) {
    // Clean up after each test
}

/**
 * Test JSON command parsing
 */
void test_parse_simple_command(void) {
    const char* json = "{\"command\":\"reboot\"}";

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_EQUAL_STRING("reboot", doc["command"]);
}

void test_parse_wifi_config_command(void) {
    const char* json = "{\"command\":\"configure_wifi\",\"ssid\":\"TestNetwork\",\"password\":\"test123\"}";

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_EQUAL_STRING("configure_wifi", doc["command"]);
    TEST_ASSERT_EQUAL_STRING("TestNetwork", doc["ssid"]);
    TEST_ASSERT_EQUAL_STRING("test123", doc["password"]);
}

void test_parse_test_command(void) {
    const char* json = "{\"command\":\"start_test\",\"testId\":\"test-123\",\"testType\":\"port_scan\",\"options\":{\"startPort\":1,\"endPort\":1024}}";

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_EQUAL_STRING("start_test", doc["command"]);
    TEST_ASSERT_EQUAL_STRING("test-123", doc["testId"]);
    TEST_ASSERT_EQUAL_STRING("port_scan", doc["testType"]);
    TEST_ASSERT_EQUAL(1, doc["options"]["startPort"]);
    TEST_ASSERT_EQUAL(1024, doc["options"]["endPort"]);
}

void test_parse_invalid_json(void) {
    const char* json = "{invalid json}";

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);

    TEST_ASSERT_TRUE(error);
}

void test_parse_empty_command(void) {
    const char* json = "{}";

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);

    TEST_ASSERT_FALSE(error);
    TEST_ASSERT_TRUE(doc["command"].isNull());
}

/**
 * Test MQTT topic parsing
 */
void test_parse_mqtt_topic(void) {
    const char* topic = "zeroproof/devices/device-001/command";

    // Simple topic parsing test
    TEST_ASSERT_NOT_NULL(strstr(topic, "zeroproof/devices"));
    TEST_ASSERT_NOT_NULL(strstr(topic, "command"));
}

void test_extract_device_id_from_topic(void) {
    const char* topic = "zeroproof/devices/device-001/command";

    // Find device ID between second and third slash
    char* start = strstr(topic, "devices/") + 8;
    char* end = strstr(start, "/");

    size_t len = end - start;
    char deviceId[32];
    strncpy(deviceId, start, len);
    deviceId[len] = '\0';

    TEST_ASSERT_EQUAL_STRING("device-001", deviceId);
}

/**
 * Test result JSON generation
 */
void test_generate_status_json(void) {
    JsonDocument doc;

    doc["deviceId"] = "device-001";
    doc["status"] = "online";
    doc["firmwareVersion"] = "3.1.0";
    doc["uptime"] = 12345;

    String output;
    serializeJson(doc, output);

    TEST_ASSERT_TRUE(output.indexOf("device-001") >= 0);
    TEST_ASSERT_TRUE(output.indexOf("online") >= 0);
    TEST_ASSERT_TRUE(output.indexOf("3.1.0") >= 0);
}

void test_generate_test_result_json(void) {
    JsonDocument doc;

    doc["testId"] = "test-123";
    doc["status"] = "completed";
    doc["success"] = true;

    JsonArray results = doc["results"].to<JsonArray>();
    JsonObject result1 = results.add<JsonObject>();
    result1["port"] = 22;
    result1["open"] = true;
    result1["service"] = "ssh";

    String output;
    serializeJson(doc, output);

    TEST_ASSERT_TRUE(output.indexOf("completed") >= 0);
    TEST_ASSERT_TRUE(output.indexOf("22") >= 0);
    TEST_ASSERT_TRUE(output.indexOf("ssh") >= 0);
}

int main(int argc, char **argv) {
    UNITY_BEGIN();

    // Command parsing tests
    RUN_TEST(test_parse_simple_command);
    RUN_TEST(test_parse_wifi_config_command);
    RUN_TEST(test_parse_test_command);
    RUN_TEST(test_parse_invalid_json);
    RUN_TEST(test_parse_empty_command);

    // MQTT topic tests
    RUN_TEST(test_parse_mqtt_topic);
    RUN_TEST(test_extract_device_id_from_topic);

    // JSON generation tests
    RUN_TEST(test_generate_status_json);
    RUN_TEST(test_generate_test_result_json);

    return UNITY_END();
}
