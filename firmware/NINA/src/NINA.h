#ifndef NINA_H
#define NINA_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <WiFi.h>

class NINA {
 public:
  typedef void (*BoolCallback)(bool value);

  NINA();
  explicit NINA(const char* deviceId);

  void setDeviceId(const char* deviceId);

  void begin(
    const char* wifiSsid,
    const char* wifiPassword,
    const char* serverHost,
    uint16_t serverPort = 5000,
    const char* serverPath = "/ws"
  );

  void loop();

  bool listenBool(const char* variable, BoolCallback callback);
  bool listenGlobalBool(const char* variable, BoolCallback callback);

  void setBool(const char* variable, bool value);
  void setGlobalBool(const char* variable, bool value);

  bool isConnected() const;

 private:
  static const uint8_t MAX_BOOL_LISTENERS = 8;
  static const uint8_t MAX_DEVICE_ID_LENGTH = 32;
  static const uint8_t MAX_SCOPE_LENGTH = 48;

  struct BoolListener {
    const char* scope;
    const char* variable;
    BoolCallback callback;
  };

  WebSocketsClient webSocket;
  BoolListener boolListeners[MAX_BOOL_LISTENERS];
  uint8_t boolListenerCount;
  bool websocketConnected;
  char deviceId[MAX_DEVICE_ID_LENGTH];
  char deviceScope[MAX_SCOPE_LENGTH];

  void connectWiFi(const char* wifiSsid, const char* wifiPassword);
  void registerDevice();
  void handleWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);
  void handleTextMessage(const uint8_t* payload, size_t length);
  void notifyBoolListeners(JsonObject scopes);
  void sendBool(const char* scope, const char* variable, bool value);
  JsonVariant getScopedValue(JsonObject scopes, const char* scope, const char* variable);
};

#endif
