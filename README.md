# Conexión local mínima

Una página compartida entre el teléfono, la laptop y dispositivos como ESP32.
El estado vive en `server/state.json`: cuando un dispositivo cambia una
variable, Flask actualiza ese archivo y avisa inmediatamente a los demás
mediante WebSocket.

## Ejecutar servidor

```powershell
cd server
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

En la laptop abre `http://localhost:5000`.

Para entrar desde el teléfono, ambos dispositivos deben estar en la misma red
Wi-Fi. Consulta la dirección IPv4 de la laptop con `ipconfig` y abre desde el
teléfono `http://IP-DE-LA-LAPTOP:5000`.

Si Windows lo solicita, permite a Python comunicarse en redes privadas.

## Estado persistente con scopes

Las variables están guardadas en:

```text
server/state.json
```

El estado usa scopes para evitar conflictos entre el servidor, navegadores y
dispositivos:

```json
{
  "scopes": {
    "global": {
      "active": false
    },
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

Esto significa que estas variables son distintas:

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

## Widgets

La página principal se construye dinámicamente desde el estado que envía Flask.
El HTML solo contiene el contenedor `#scope-root`; `app.js` recorre `scopes` y
crea un frame colapsable por cada scope, con una fila por cada variable.

Por ahora las variables controlables se configuran en `app.js`:

```js
const controllableVariables = new Set([
  'global.active',
  'devices.esp32_demo.active'
]);
```

Las variables booleanas muestran foco de estado. Si además están en
`controllableVariables`, también muestran botón.

## Librería ESP32

La librería Arduino está en:

```text
firmware/NINA
```

El ejemplo principal está en:

```text
firmware/NINA/examples/esp32_active_client/esp32_active_client.ino
```

El `.ino` está dentro de una carpeta con el mismo nombre para evitar conflictos
con Arduino IDE.

Para usarla desde Arduino IDE, copia la carpeta `firmware/NINA` dentro de tu
carpeta de librerías de Arduino, por ejemplo:

```text
Documentos/Arduino/libraries/NINA
```

Después abre el ejemplo `esp32_active_client`.

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

  // Escucha devices.esp32_demo.active.
  nina.listenBool("active", applyActiveState);
  nina.begin("TU_WIFI", "TU_PASSWORD", "192.168.1.119");
}

void loop() {
  nina.loop();
}
```

Si quieres escuchar una variable global, usa:

```cpp
nina.listenGlobalBool("active", applyActiveState);
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

## Estructura

```text
firmware/
`-- NINA/
    |-- library.properties
    |-- src/
    |   |-- NINA.cpp
    |   `-- NINA.h
    `-- examples/
        `-- esp32_active_client/
            `-- esp32_active_client.ino
server/
|-- app.py
|-- requirements.txt
|-- state.json
|-- static/
|   |-- css/style.css
|   `-- js/app.js
`-- templates/index.html
```
