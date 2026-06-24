#ifndef NINA_H
#define NINA_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <WiFi.h>

class NINA {
 public:
  typedef void (*BoolCallback)(bool value);
  typedef float (*FloatReader)();

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

  bool listenBool(const char* variable, BoolCallback callback, bool user_input = false);
  bool listenGlobalBool(const char* variable, BoolCallback callback, bool user_input = false);
  bool listenFloat(const char* variable, FloatReader reader, unsigned long intervalMs, bool user_input = false);
  bool listenGlobalFloat(const char* variable, FloatReader reader, unsigned long intervalMs, bool user_input = false);

  void setBool(const char* variable, bool value);
  void setGlobalBool(const char* variable, bool value);
  void setInt(const char* variable, int value);
  void setGlobalInt(const char* variable, int value);
  void setFloat(const char* variable, float value);
  void setGlobalFloat(const char* variable, float value);
  void setString(const char* variable, const char* value);
  void setGlobalString(const char* variable, const char* value);

  bool isConnected() const;

 private:
  static const uint8_t MAX_BOOL_LISTENERS = 8;
  static const uint8_t MAX_FLOAT_READERS = 8;
  static const uint8_t MAX_DEVICE_ID_LENGTH = 32;
  static const uint8_t MAX_SCOPE_LENGTH = 48;

  struct BoolListener {
    const char* scope;
    const char* variable;
    BoolCallback callback;
    bool userInput;
  };

  struct FloatPublisher {
    const char* scope;
    const char* variable;
    FloatReader reader;
    unsigned long intervalMs;
    unsigned long lastReadMs;
    bool userInput;
  };

  WebSocketsClient webSocket;
  BoolListener boolListeners[MAX_BOOL_LISTENERS];
  FloatPublisher floatPublishers[MAX_FLOAT_READERS];
  uint8_t boolListenerCount;
  uint8_t floatPublisherCount;
  bool websocketConnected;
  char deviceId[MAX_DEVICE_ID_LENGTH];
  char deviceScope[MAX_SCOPE_LENGTH];

  void connectWiFi(const char* wifiSsid, const char* wifiPassword);
  void registerDevice();
  void ensureBoolListeners();
  void declareUserInputs();
  void handleWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);
  void handleTextMessage(const uint8_t* payload, size_t length);
  void notifyBoolListeners(JsonObject scopes);
  void publishFloatReaders();
  bool addFloatPublisher(const char* scope, const char* variable, FloatReader reader, unsigned long intervalMs, bool userInput);
  void declareInput(const char* scope, const char* variable, const char* inputType);
  void sendBool(const char* scope, const char* variable, bool value);
  void ensureBool(const char* scope, const char* variable, bool value);
  void sendInt(const char* scope, const char* variable, int value);
  void sendFloat(const char* scope, const char* variable, float value);
  void sendString(const char* scope, const char* variable, const char* value);
  JsonVariant getScopedValue(JsonObject scopes, const char* scope, const char* variable);
};

#endif
