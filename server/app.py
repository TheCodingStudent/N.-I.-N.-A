import atexit
import copy
import json
import platform
import re
import socket
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from flask import Flask, render_template
from flask_sock import Sock


app = Flask(__name__)
sock = Sock(app)

STATE_FILE = Path(__file__).with_name("state.json")
DEFAULT_STATE = {
    "scopes": {
        "global": {
            "active": False,
        },
        "server": {
            "online": True,
            "hostname": socket.gethostname(),
            "platform": platform.system(),
            "started_at": None,
            "stopped_at": None,
        },
        "clients": {},
        "devices": {
            "esp32_demo": {
                "active": False,
                "temperature": None,
                "online": False,
            }
        },
    }
}

VALID_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
VALID_VALUE_TYPES = (bool, int, float, str, type(None))

state_lock = Lock()
clients_lock = Lock()
state = None
clients = set()
connection_scopes = {}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def write_state(next_state):
    temporary_file = STATE_FILE.with_suffix(".json.tmp")
    temporary_file.write_text(
        json.dumps(next_state, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    temporary_file.replace(STATE_FILE)


def save_state():
    write_state(state)


def migrate_state(loaded_state):
    if "scopes" in loaded_state:
        return loaded_state

    old_values = loaded_state.get("values", {})
    migrated_state = copy.deepcopy(DEFAULT_STATE)
    migrated_state["scopes"]["global"].update(old_values)
    return migrated_state


def ensure_mapping(parent, name):
    if name not in parent or not isinstance(parent[name], dict):
        parent[name] = {}
        return True
    return False


def ensure_defaults(loaded_state):
    changed = False
    scopes = loaded_state.setdefault("scopes", {})

    for scope_name, default_value in DEFAULT_STATE["scopes"].items():
        if scope_name not in scopes:
            scopes[scope_name] = copy.deepcopy(default_value)
            changed = True
            continue

        if isinstance(default_value, dict):
            if not isinstance(scopes[scope_name], dict):
                scopes[scope_name] = copy.deepcopy(default_value)
                changed = True
                continue

            for name, value in default_value.items():
                if name not in scopes[scope_name]:
                    scopes[scope_name][name] = copy.deepcopy(value)
                    changed = True

    changed = ensure_mapping(scopes, "clients") or changed
    changed = ensure_mapping(scopes, "devices") or changed
    return changed


def load_state():
    if not STATE_FILE.exists():
        loaded_state = copy.deepcopy(DEFAULT_STATE)
        loaded_state["scopes"]["server"]["started_at"] = now_iso()
        write_state(loaded_state)
        return loaded_state

    loaded_state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    migrated_state = migrate_state(loaded_state)
    changed = migrated_state != loaded_state
    changed = ensure_defaults(migrated_state) or changed

    server_scope = migrated_state["scopes"]["server"]
    server_scope["online"] = True
    server_scope["hostname"] = socket.gethostname()
    server_scope["platform"] = platform.system()
    server_scope["started_at"] = now_iso()
    server_scope["stopped_at"] = None
    changed = True

    if changed:
        write_state(migrated_state)

    return migrated_state


state = load_state()


@app.after_request
def disable_browser_cache(response):
    # Durante el desarrollo, obliga a teléfonos y computadoras a cargar
    # siempre la versión actual del HTML, CSS y JavaScript.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


def current_state():
    with state_lock:
        return {"scopes": copy.deepcopy(state["scopes"])}


def send_json(client, message):
    client.send(json.dumps(message))


def broadcast(message):
    with clients_lock:
        recipients = list(clients)

    disconnected = set()
    for client in recipients:
        try:
            send_json(client, message)
        except Exception:
            disconnected.add(client)

    if disconnected:
        with clients_lock:
            clients.difference_update(disconnected)
            for client in disconnected:
                connection_scopes.pop(client, None)


def valid_scope(scope):
    if scope in {"global", "server"}:
        return True

    parts = scope.split(".")
    if len(parts) != 2:
        return False

    group, item_id = parts
    return group in {"clients", "devices"} and bool(VALID_NAME.match(item_id))


def valid_variable(variable):
    return bool(VALID_NAME.match(variable))


def get_scope_values(scope, create=False):
    if scope in {"global", "server"}:
        return state["scopes"][scope]

    group, item_id = scope.split(".")
    group_values = state["scopes"].setdefault(group, {})

    if create:
        return group_values.setdefault(item_id, {})

    return group_values.get(item_id)


def update_scope(scope, updates):
    if not valid_scope(scope):
        return False

    clean_updates = {}
    for name, value in updates.items():
        if not valid_variable(name):
            continue
        if not isinstance(value, VALID_VALUE_TYPES):
            continue
        clean_updates[name] = value

    if not clean_updates:
        return False

    with state_lock:
        scope_values = get_scope_values(scope, create=True)
        changed = False

        for name, value in clean_updates.items():
            if scope_values.get(name) == value:
                continue
            scope_values[name] = value
            changed = True

        if not changed:
            return False

        save_state()

    broadcast({"type": "state", **current_state()})
    return True


def set_variable(scope, name, value):
    return update_scope(scope, {name: value})


def register_client(client, message):
    client_id = message.get("client_id")
    client_type = message.get("client_type")

    if not isinstance(client_id, str) or not VALID_NAME.match(client_id):
        return None
    if not isinstance(client_type, str) or not VALID_NAME.match(client_type):
        client_type = "unknown"

    client_scope = f"clients.{client_id}"

    with clients_lock:
        connection_scopes[client] = client_scope

    update_scope(
        client_scope,
        {
            "type": client_type,
            "online": True,
            "last_seen": now_iso(),
            "user_agent": str(message.get("user_agent") or "")[:300],
        },
    )
    return client_scope


def register_device(client, message):
    device_id = message.get("device_id")
    device_type = message.get("device_type")
    device_name = message.get("name")

    if not isinstance(device_id, str) or not VALID_NAME.match(device_id):
        return None
    if not isinstance(device_type, str) or not VALID_NAME.match(device_type):
        device_type = "simulator"

    device_scope = f"devices.{device_id}"

    with clients_lock:
        connection_scopes[client] = device_scope

    updates = {
        "type": device_type,
        "online": True,
        "last_seen": now_iso(),
    }

    if isinstance(device_name, str) and device_name.strip():
        updates["name"] = device_name.strip()[:80]

    update_scope(device_scope, updates)
    return device_scope


def mark_connection_offline(client):
    with clients_lock:
        connection_scope = connection_scopes.pop(client, None)

    if connection_scope:
        update_scope(
            connection_scope,
            {
                "online": False,
                "last_seen": now_iso(),
            },
        )


def mark_server_offline():
    if state is None:
        return

    with state_lock:
        server_scope = state["scopes"]["server"]
        server_scope["online"] = False
        server_scope["stopped_at"] = now_iso()
        save_state()


atexit.register(mark_server_offline)


@app.get("/")
def index():
    return render_template("index.html")


@sock.route("/ws")
def websocket(client):
    with clients_lock:
        clients.add(client)

    # Una conexión nueva necesita conocer el estado completo actual.
    send_json(client, {"type": "state", **current_state()})

    try:
        while True:
            raw_message = client.receive()
            if raw_message is None:
                break

            try:
                message = json.loads(raw_message)
            except (TypeError, json.JSONDecodeError):
                continue

            if message.get("type") == "register_client":
                register_client(client, message)
                continue

            if message.get("type") == "register_device":
                register_device(client, message)
                continue

            if message.get("type") != "set_variable":
                continue
            if not isinstance(message.get("scope"), str):
                continue
            if not isinstance(message.get("variable"), str):
                continue
            if message["scope"] == "server":
                continue

            # No se transmite nada si el valor ya era el solicitado.
            set_variable(
                message["scope"],
                message["variable"],
                message.get("value"),
            )
    finally:
        with clients_lock:
            clients.discard(client)
        mark_connection_offline(client)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
