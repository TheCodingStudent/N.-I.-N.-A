# Conexión local mínima

Una página compartida entre el teléfono y la laptop. El estado vive en el
servidor Flask: al pulsar el botón desde un dispositivo, el servidor informa
el cambio inmediatamente a los demás mediante WebSocket.

## Ejecutar

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

Si Windows lo solicita, permite a Python comunicarse en redes privadas. El
estado se guarda solamente en memoria y vuelve a apagado al reiniciar Flask.

## Estructura

```text
server/
|-- app.py
|-- requirements.txt
|-- static/
|   |-- css/style.css
|   `-- js/app.js
`-- templates/index.html
```
