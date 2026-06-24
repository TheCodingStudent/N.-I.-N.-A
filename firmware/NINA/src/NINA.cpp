#include "NINA.h"
#include <math.h>

NINA::NINA() : boolListenerCount(0), floatPublisherCount(0), websocketConnected(false) {
  setDeviceId("esp32_demo");
}

NINA::NINA(const char* deviceId) : boolListenerCount(0), floatPublisherCount(0), websocketConnected(false) {
  setDeviceId(deviceId);
}

void NINA::setDeviceId(const char* deviceId) {
  if (deviceId == nullptr || strlen(deviceId) == 0) {
    deviceId = "esp32_demo";
  }

  snprintf(this->deviceId, MAX_DEVICE_ID_LENGTH, "%s", deviceId);
  snprintf(deviceScope, MAX_SCOPE_LENGTH, "devices.%s", this->deviceId);
}

void NINA::begin(
  const char* wifiSsid,
  const char* wifiPassword,
  const char* serverHost,
  uint16_t serverPort,
  const char* serverPath
) {
  connectWiFi(wifiSsid, wifiPassword);

  webSocket.begin(serverHost, serverPort, serverPath);
  webSocket.onEvent([this](WStype_t type, uint8_t* payload, size_t length) {
    handleWebSocketEvent(type, payload, length);
  });

  webSocket.enableHeartbeat(15000, 3000, 2);
  webSocket.setReconnectInterval(2000);
}

void NINA::loop() {
  webSocket.loop();
  publishFloatReaders();
}

bool NINA::listenBool(const char* variable, BoolCallback callback, bool user_input) {
  if (variable == nullptr || callback == nullptr) {
    return false;
  }

  if (boolListenerCount >= MAX_BOOL_LISTENERS) {
    return false;
  }

  boolListeners[boolListenerCount] = { deviceScope, variable, callback, user_input };
  boolListenerCount++;
  return true;
}

bool NINA::listenGlobalBool(const char* variable, BoolCallback callback, bool user_input) {
  if (variable == nullptr || callback == nullptr) {
    return false;
  }

  if (boolListenerCount >= MAX_BOOL_LISTENERS) {
    return false;
  }

  boolListeners[boolListenerCount] = { "global", variable, callback, user_input };
  boolListenerCount++;
  return true;
}

bool NINA::listenFloat(const char* variable, FloatReader reader, unsigned long intervalMs, bool user_input) {
  return addFloatPublisher(deviceScope, variable, reader, intervalMs, user_input);
}

bool NINA::listenGlobalFloat(const char* variable, FloatReader reader, unsigned long intervalMs, bool user_input) {
  return addFloatPublisher("global", variable, reader, intervalMs, user_input);
}

void NINA::setBool(const char* variable, bool value) {
  sendBool(deviceScope, variable, value);
}

void NINA::setGlobalBool(const char* variable, bool value) {
  sendBool("global", variable, value);
}

void NINA::setInt(const char* variable, int value) {
  sendInt(deviceScope, variable, value);
}

void NINA::setGlobalInt(const char* variable, int value) {
  sendInt("global", variable, value);
}

void NINA::setFloat(const char* variable, float value) {
  sendFloat(deviceScope, variable, value);
}

void NINA::setGlobalFloat(const char* variable, float value) {
  sendFloat("global", variable, value);
}

void NINA::setString(const char* variable, const char* value) {
  sendString(deviceScope, variable, value);
}

void NINA::setGlobalString(const char* variable, const char* value) {
  sendString("global", variable, value);
}

bool NINA::isConnected() const {
  return websocketConnected;
}

void NINA::connectWiFi(const char* wifiSsid, const char* wifiPassword) {
  Serial.print("Conectando a Wi-Fi: ");
  Serial.println(wifiSsid);

  WiFi.begin(wifiSsid, wifiPassword);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("Wi-Fi conectado");
  Serial.print("IP del ESP32: ");
  Serial.println(WiFi.localIP());
}

void NINA::registerDevice() {
  StaticJsonDocument<256> doc;
  doc["type"] = "register_device";
  doc["device_id"] = deviceId;
  doc["device_type"] = "esp32";
  doc["name"] = deviceId;

  String message;
  serializeJson(doc, message);
  webSocket.sendTXT(message);
}

void NINA::ensureBoolListeners() {
  for (uint8_t i = 0; i < boolListenerCount; i++) {
    ensureBool(boolListeners[i].scope, boolListeners[i].variable, false);
  }
}

void NINA::declareUserInputs() {
  for (uint8_t i = 0; i < boolListenerCount; i++) {
    if (boolListeners[i].userInput) {
      declareInput(boolListeners[i].scope, boolListeners[i].variable, "toggle");
    }
  }

  for (uint8_t i = 0; i < floatPublisherCount; i++) {
    if (floatPublishers[i].userInput) {
      declareInput(floatPublishers[i].scope, floatPublishers[i].variable, "number");
    }
  }
}

void NINA::handleWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      websocketConnected = true;
      Serial.print("WebSocket conectado al servidor NINA como ");
      Serial.println(deviceScope);
      registerDevice();
      ensureBoolListeners();
      declareUserInputs();
      break;

    case WStype_DISCONNECTED:
      websocketConnected = false;
      Serial.println("WebSocket desconectado");
      break;

    case WStype_TEXT:
      handleTextMessage(payload, length);
      break;

    case WStype_ERROR:
      websocketConnected = false;
      Serial.println("Error en WebSocket");
      break;

    default:
      break;
  }
}

void NINA::handleTextMessage(const uint8_t* payload, size_t length) {
  StaticJsonDocument<2048> doc;

  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.print("Error JSON: ");
    Serial.println(error.c_str());
    return;
  }

  const char* type = doc["type"];
  if (!type || strcmp(type, "state") != 0) {
    return;
  }

  JsonObject scopes = doc["scopes"].as<JsonObject>();
  if (scopes.isNull()) {
    return;
  }

  notifyBoolListeners(scopes);
}

void NINA::notifyBoolListeners(JsonObject scopes) {
  for (uint8_t i = 0; i < boolListenerCount; i++) {
    JsonVariant value = getScopedValue(
      scopes,
      boolListeners[i].scope,
      boolListeners[i].variable
    );

    if (value.isNull()) {
      continue;
    }

    boolListeners[i].callback(value.as<bool>());
  }
}

void NINA::publishFloatReaders() {
  if (!websocketConnected) {
    return;
  }

  unsigned long now = millis();

  for (uint8_t i = 0; i < floatPublisherCount; i++) {
    FloatPublisher* publisher = &floatPublishers[i];

    if (publisher->lastReadMs != 0 && now - publisher->lastReadMs < publisher->intervalMs) {
      continue;
    }

    publisher->lastReadMs = now;
    sendFloat(publisher->scope, publisher->variable, publisher->reader());
  }
}

bool NINA::addFloatPublisher(const char* scope, const char* variable, FloatReader reader, unsigned long intervalMs, bool userInput) {
  if (scope == nullptr || variable == nullptr || reader == nullptr || intervalMs == 0) {
    return false;
  }

  if (floatPublisherCount >= MAX_FLOAT_READERS) {
    return false;
  }

  floatPublishers[floatPublisherCount] = { scope, variable, reader, intervalMs, 0, userInput };
  floatPublisherCount++;
  return true;
}

void NINA::declareInput(const char* scope, const char* variable, const char* inputType) {
  if (!websocketConnected || scope == nullptr || variable == nullptr || inputType == nullptr) {
    return;
  }

  StaticJsonDocument<256> doc;
  doc["type"] = "declare_input";
  doc["scope"] = scope;
  doc["variable"] = variable;
  doc["input_type"] = inputType;

  String message;
  serializeJson(doc, message);
  webSocket.sendTXT(message);
}

void NINA::sendBool(const char* scope, const char* variable, bool value) {
  if (!websocketConnected || scope == nullptr || variable == nullptr) {
    return;
  }

  StaticJsonDocument<256> doc;
  doc["type"] = "set_variable";
  doc["scope"] = scope;
  doc["variable"] = variable;
  doc["value"] = value;

  String message;
  serializeJson(doc, message);
  webSocket.sendTXT(message);
}

void NINA::ensureBool(const char* scope, const char* variable, bool value) {
  if (!websocketConnected || scope == nullptr || variable == nullptr) {
    return;
  }

  StaticJsonDocument<256> doc;
  doc["type"] = "ensure_variable";
  doc["scope"] = scope;
  doc["variable"] = variable;
  doc["value"] = value;

  String message;
  serializeJson(doc, message);
  webSocket.sendTXT(message);
}

void NINA::sendInt(const char* scope, const char* variable, int value) {
  if (!websocketConnected || scope == nullptr || variable == nullptr) {
    return;
  }

  StaticJsonDocument<256> doc;
  doc["type"] = "set_variable";
  doc["scope"] = scope;
  doc["variable"] = variable;
  doc["value"] = value;

  String message;
  serializeJson(doc, message);
  webSocket.sendTXT(message);
}

void NINA::sendFloat(const char* scope, const char* variable, float value) {
  if (!websocketConnected || scope == nullptr || variable == nullptr) {
    return;
  }

  StaticJsonDocument<256> doc;
  doc["type"] = "set_variable";
  doc["scope"] = scope;
  doc["variable"] = variable;

  if (isfinite(value)) {
    doc["value"] = value;
  } else {
    doc["value"] = nullptr;
  }

  String message;
  serializeJson(doc, message);
  webSocket.sendTXT(message);
}

void NINA::sendString(const char* scope, const char* variable, const char* value) {
  if (!websocketConnected || scope == nullptr || variable == nullptr) {
    return;
  }

  StaticJsonDocument<256> doc;
  doc["type"] = "set_variable";
  doc["scope"] = scope;
  doc["variable"] = variable;
  doc["value"] = value;

  String message;
  serializeJson(doc, message);
  webSocket.sendTXT(message);
}

JsonVariant NINA::getScopedValue(JsonObject scopes, const char* scope, const char* variable) {
  if (scope == nullptr || variable == nullptr) {
    return JsonVariant();
  }

  String scopePath(scope);
  int separator = scopePath.indexOf('.');

  if (separator < 0) {
    JsonObject scopeValues = scopes[scope].as<JsonObject>();
    return scopeValues[variable];
  }

  String group = scopePath.substring(0, separator);
  String item = scopePath.substring(separator + 1);

  JsonObject groupValues = scopes[group].as<JsonObject>();
  JsonObject scopeValues = groupValues[item].as<JsonObject>();
  return scopeValues[variable];
}
