#include "NINA.h"

NINA::NINA() : boolListenerCount(0), websocketConnected(false) {
  setDeviceId("esp32_demo");
}

NINA::NINA(const char* deviceId) : boolListenerCount(0), websocketConnected(false) {
  setDeviceId(deviceId);
}

void NINA::setDeviceId(const char* deviceId) {
  if (deviceId == nullptr || strlen(deviceId) == 0) {
    deviceId = "esp32_demo";
  }

  snprintf(deviceScope, MAX_SCOPE_LENGTH, "devices.%s", deviceId);
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
}

bool NINA::listenBool(const char* variable, BoolCallback callback) {
  if (variable == nullptr || callback == nullptr) {
    return false;
  }

  if (boolListenerCount >= MAX_BOOL_LISTENERS) {
    return false;
  }

  boolListeners[boolListenerCount] = { deviceScope, variable, callback };
  boolListenerCount++;
  return true;
}

bool NINA::listenGlobalBool(const char* variable, BoolCallback callback) {
  if (variable == nullptr || callback == nullptr) {
    return false;
  }

  if (boolListenerCount >= MAX_BOOL_LISTENERS) {
    return false;
  }

  boolListeners[boolListenerCount] = { "global", variable, callback };
  boolListenerCount++;
  return true;
}

void NINA::setBool(const char* variable, bool value) {
  sendBool(deviceScope, variable, value);
}

void NINA::setGlobalBool(const char* variable, bool value) {
  sendBool("global", variable, value);
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

void NINA::handleWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      websocketConnected = true;
      Serial.print("WebSocket conectado al servidor NINA como ");
      Serial.println(deviceScope);
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
