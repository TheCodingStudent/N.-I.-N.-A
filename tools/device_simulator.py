import json
import re
import threading
from datetime import datetime, timezone

from simple_websocket import Client


VALID_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def ask(prompt, default=None):
    suffix = f" [{default}]" if default is not None else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return value or default


def ask_valid_name(prompt, default):
    while True:
        value = ask(prompt, default)
        if value and VALID_NAME.match(value):
            return value
        print("Usa solo letras, numeros y guion bajo. Debe iniciar con letra o guion bajo.")


def parse_value(raw_value):
    value = raw_value.strip()
    lowered = value.lower()

    if lowered in {"true", "on", "yes", "si", "sí", "1"}:
        return True
    if lowered in {"false", "off", "no", "0"}:
        return False
    if lowered in {"null", "none", "sin_dato"}:
        return None

    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        return value


def format_json(data):
    return json.dumps(data, indent=2, ensure_ascii=False)


class DeviceSimulator:
    def __init__(self, server_url, device_id, device_type, device_name):
        self.server_url = server_url
        self.device_id = device_id
        self.device_type = device_type
        self.device_name = device_name
        self.scope = f"devices.{device_id}"
        self.ws = None
        self.state = {}
        self.running = False

    def connect(self):
        self.ws = Client.connect(self.server_url, ping_interval=15)
        self.running = True
        self.register()
        threading.Thread(target=self.receive_loop, daemon=True).start()

    def register(self):
        self.send({
            "type": "register_device",
            "device_id": self.device_id,
            "device_type": self.device_type,
            "name": self.device_name,
        })
        self.set_variable("last_seen", now_iso())

    def send(self, message):
        self.ws.send(json.dumps(message))

    def set_variable(self, variable, value, scope=None):
        self.send({
            "type": "set_variable",
            "scope": scope or self.scope,
            "variable": variable,
            "value": value,
        })

    def receive_loop(self):
        while self.running:
            try:
                raw_message = self.ws.receive()
            except Exception as error:
                if self.running:
                    print(f"\nConexion cerrada: {error}")
                self.running = False
                break

            if raw_message is None:
                self.running = False
                break

            try:
                message = json.loads(raw_message)
            except json.JSONDecodeError:
                continue

            if message.get("type") == "state":
                self.state = message.get("scopes", {})

    def own_state(self):
        current = self.state
        for part in self.scope.split("."):
            current = current.get(part, {})
        return current

    def print_help(self):
        print("""
Comandos:
  set <variable> <valor>        Cambia/crea una variable del dispositivo
  global <variable> <valor>     Cambia/crea una variable global
  show                          Muestra las variables de este dispositivo
  state                         Muestra todo el estado recibido
  help                          Muestra esta ayuda
  exit                          Cierra el simulador

Valores:
  true/false, on/off, 1/0, numeros, null o texto

Ejemplos:
  set temperature 25.5
  set active true
  set message hola
  global active false
""".strip())

    def command_loop(self):
        self.print_help()

        while self.running:
            try:
                raw_command = input(f"\n{self.scope}> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break

            if not raw_command:
                continue

            parts = raw_command.split(maxsplit=2)
            command = parts[0].lower()

            if command in {"exit", "quit", "salir"}:
                break

            if command == "help":
                self.print_help()
                continue

            if command == "show":
                print(format_json(self.own_state()))
                continue

            if command == "state":
                print(format_json(self.state))
                continue

            if command in {"set", "global"}:
                if len(parts) < 3:
                    print("Formato: set <variable> <valor>")
                    continue

                variable = parts[1]
                if not VALID_NAME.match(variable):
                    print("Nombre de variable invalido.")
                    continue

                value = parse_value(parts[2])
                scope = "global" if command == "global" else self.scope
                self.set_variable(variable, value, scope)
                print(f"Enviado: {scope}.{variable} = {value!r}")
                continue

            print("Comando no reconocido. Escribe help.")

        self.close()

    def close(self):
        self.running = False

        if self.ws:
            try:
                self.set_variable("last_seen", now_iso())
                self.ws.close()
            except Exception:
                pass


def main():
    print("N. I. N. A - simulador de dispositivo Python")
    host = ask("Host del servidor Flask", "127.0.0.1")
    port = ask("Puerto", "5000")
    device_id = ask_valid_name("ID del dispositivo", "python_sim")
    device_type = ask_valid_name("Tipo", "python_simulator")
    device_name = ask("Nombre visible", device_id)

    server_url = f"ws://{host}:{port}/ws"
    simulator = DeviceSimulator(server_url, device_id, device_type, device_name)

    print(f"Conectando a {server_url} como {simulator.scope}...")
    simulator.connect()
    print("Conectado.")
    simulator.command_loop()
    print("Simulador cerrado.")


if __name__ == "__main__":
    main()
