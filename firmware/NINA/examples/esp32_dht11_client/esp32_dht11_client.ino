#include <DHT.h>
#include <NINA.h>

const char* WIFI_SSID = "TU_WIFI";
const char* WIFI_PASSWORD = "TU_PASSWORD";
const char* SERVER_HOST = "192.168.1.119";

const int DHT_PIN = 4;
const int ACTIVE_PIN = BUILTIN_LED;

DHT dht(DHT_PIN, DHT11);
NINA nina("esp32_demo");

float readTemperature() {
  return dht.readTemperature();
}

float readHumidity() {
  return dht.readHumidity();
}

void applyActiveState(bool active) {
  digitalWrite(ACTIVE_PIN, active ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);

  pinMode(ACTIVE_PIN, OUTPUT);
  digitalWrite(ACTIVE_PIN, LOW);

  dht.begin();

  nina.listenBool("active", applyActiveState, true);
  nina.listenFloat("temperature", readTemperature, 5000);
  nina.listenFloat("humidity", readHumidity, 5000);
  nina.begin(WIFI_SSID, WIFI_PASSWORD, SERVER_HOST);
}

void loop() {
  nina.loop();
}
