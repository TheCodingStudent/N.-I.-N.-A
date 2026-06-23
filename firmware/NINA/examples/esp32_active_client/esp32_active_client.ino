#include <NINA.h>

const char* WIFI_SSID = "INFINITUM2515";
const char* WIFI_PASSWORD = "A4xVEqX74J";
const char* SERVER_HOST = "192.168.1.119";

const int ACTIVE_PIN = BUILTIN_LED;

NINA nina("esp32_demo");

void applyActiveState(bool active) {
  digitalWrite(ACTIVE_PIN, active ? HIGH : LOW);
  Serial.print("Variable active = ");
  Serial.println(active ? "true" : "false");
}

void setup() {
  Serial.begin(115200);

  pinMode(ACTIVE_PIN, OUTPUT);
  digitalWrite(ACTIVE_PIN, LOW);

  nina.listenBool("active", applyActiveState);
  nina.begin(WIFI_SSID, WIFI_PASSWORD, SERVER_HOST);
}

void loop() {
  nina.loop();
}
