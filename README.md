# N. I. N. A

Una interfaz local para comunicar navegador, laptop y dispositivos como ESP32
contra un servidor Flask. El estado se guarda en JSON y se sincroniza en tiempo
real mediante WebSocket.

## Ejecutar servidor

```powershell
cd server
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

En la laptop abre:

```text
http://localhost:5000
```

Desde el teléfono, ambos equipos deben estar en la misma red Wi-Fi. Consulta la
IPv4 de la laptop con `ipconfig` y abre:

```text
http://IP-DE-LA-LAPTOP:5000
```

Si Windows lo solicita, permite a Python comunicarse en redes privadas.

## Estado persistente con scopes

Los valores reales viven en:

```text
server/state.json
```

El estado usa scopes para evitar conflictos entre servidor, navegadores y
dispositivos:

```json
{
  "scopes": {
    "global": {},
    "server": {
      "online": true,
      "hostname": "MI-LAPTOP",
      "platform": "Windows"
    },
    "clients": {
      "phone_ab12cd34": {
        "type": "phone",
        "online": true
      }
    },
    "devices": {
      "esp32_demo": {
        "active": false,
        "temperature": null,
        "online": false
      }
    }
  }
}
```

Estas variables son distintas:

```text
global.active
server.online
clients.phone_ab12cd34.online
devices.esp32_demo.active
```

Así, dos ESP32 pueden tener su propia variable `temperature` sin pisarse:

```text
devices.esp32_sala.temperature
devices.esp32_cocina.temperature
```

## Clientes navegador

Cada navegador se identifica automáticamente al conectarse. El ID y tipo se
guardan en `localStorage`, por ejemplo:

```text
clients.phone_ab12cd34
clients.laptop_98ff12aa
```

El servidor marca ese scope como `online: true` cuando el WebSocket se registra,
y como `online: false` cuando la conexión se cierra.

## Widgets y controles de usuario

La página principal se construye dinámicamente desde el estado que envía Flask.
El HTML solo contiene el contenedor `#scope-root`; `app.js` recorre `scopes` y
crea un frame colapsable por cada grupo, con una fila por cada variable.

La información visual de la interfaz vive aparte en:

```text
server/ui.json
```

Esto separa dos ideas importantes:

```text
devices.esp32_demo.active = false
```

significa el valor actual; mientras que:

```json
{
  "controls": {
    "devices.esp32_demo.active": {
      "type": "toggle"
    }
  }
}
```

significa que la UI puede mostrar un botón para controlar esa variable.

La forma normal de declarar ese botón desde un ESP32 es pasar `true` como tercer
parámetro de `listenBool`:

```cpp
nina.listenBool("active", applyActiveState, true);
```

Si omites ese tercer parámetro, la variable aparece como indicador, pero no como
control editable:

```cpp
nina.listenBool("active", applyActiveState);
```

## Simulador Python de dispositivo

Puedes simular un ESP32/dispositivo desde Python con:

```powershell
.\.venv\Scripts\python.exe tools\device_simulator.py
```

El simulador pide host, puerto, ID, tipo y nombre visible. Después se registra
como:

```text
devices.<id_del_dispositivo>
```

Comandos útiles dentro del simulador:

```text
set temperature 25.5
set active true
set devices.esp32_demo.active false
global active false
show
state
exit
```

## Librería ESP32

La librería Arduino está en:

```text
firmware/NINA
```

El ejemplo principal está en:

```text
firmware/NINA/examples/esp32_active_client/esp32_active_client.ino
```

El ejemplo con DHT11 está en:

```text
firmware/NINA/examples/esp32_dht11_client/esp32_dht11_client.ino
```

Para usarla desde Arduino IDE, copia la carpeta `firmware/NINA` dentro de tu
carpeta de librerías de Arduino, por ejemplo:

```text
Documentos/Arduino/libraries/NINA
```

También instala estas librerías desde el Library Manager:

- `ArduinoJson`
- `WebSockets` de Markus Sattler

El sketch queda intencionalmente pequeño:

```cpp
#include <NINA.h>

NINA nina("esp32_demo");

void applyActiveState(bool active) {
  digitalWrite(2, active ? HIGH : LOW);
}

void setup() {
  pinMode(2, OUTPUT);

  // Escucha devices.esp32_demo.active y permite controlarlo desde la UI.
  nina.listenBool("active", applyActiveState, true);
  nina.begin("TU_WIFI", "TU_PASSWORD", "192.168.1.119");
}

void loop() {
  nina.loop();
}
```

Cuando el ESP32 se conecta, NINA asegura automáticamente que esa variable
exista. Si `devices.esp32_demo.active` no existe, la crea con `false`. Si ya
existe, no la sobrescribe.

Si quieres escuchar una variable global, usa:

```cpp
nina.listenGlobalBool("active", applyActiveState, true);
```

Y si el ESP32 quiere publicar un valor booleano propio:

```cpp
nina.setBool("sensor_ready", true);
```

Eso actualiza:

```text
devices.esp32_demo.sensor_ready
```

Nota: `online` ya se actualiza automáticamente cuando la librería NINA se
registra contra el servidor. Usa `setBool()` para variables propias como
`active`, `relay`, `sensor_ready`, etc.

Para publicar sensores periódicamente sin crear timers manuales:

```cpp
float readTemperature() {
  return dht.readTemperature();
}

float readHumidity() {
  return dht.readHumidity();
}

void setup() {
  dht.begin();
  nina.listenFloat("temperature", readTemperature, 5000);
  nina.listenFloat("humidity", readHumidity, 5000);
  nina.begin("TU_WIFI", "TU_PASSWORD", "192.168.1.119");
}
```

Si el sensor devuelve `NaN` o infinito, NINA lo manda como `null`.

## Estructura

```text
firmware/
`-- NINA/
    |-- library.properties
    |-- src/
    |   |-- NINA.cpp
    |   `-- NINA.h
    `-- examples/
        |-- esp32_active_client/
        |   `-- esp32_active_client.ino
        `-- esp32_dht11_client/
            `-- esp32_dht11_client.ino
server/
|-- app.py
|-- requirements.txt
|-- state.json
|-- ui.json
|-- static/
|   |-- css/style.css
|   |-- js/app.js
|   `-- js/navbar.js
`-- templates/index.html
tools/
`-- device_simulator.py
```
