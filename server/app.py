import re
import copy
import json
import uuid
import socket
import atexit
import platform
from pathlib import Path
from threading import Lock
from datetime import datetime, timezone

from flask_sock import Sock
from flask import Flask, jsonify, render_template
from markupsafe import Markup, escape

try:
    import markdown as markdown_lib
except ImportError:
    markdown_lib = None


JSON_DIR = Path(__file__).with_name("json")
README_FILE = Path(__file__).resolve().parent.parent / "README.md"
STATE_FILE = JSON_DIR / "state.json"
UI_FILE = JSON_DIR / "ui.json"
TOOLS_FILE = JSON_DIR / "tools.json"

VALID_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
VALID_VALUE_TYPES = (bool, int, float, str, type(None))
INPUT_TYPES = {"toggle", "number", "text"}

DEFAULT_STATE = {
    "scopes": {
        "global": {},
        "server": {
            "online": True,
            "hostname": socket.gethostname(),
            "platform": platform.system(),
            "started_at": None,
            "stopped_at": None,
        },
        "clients": {},
        "devices": {},
    }
}

DEFAULT_UI = {
    "controls": {}
}

DEFAULT_TOOLS = {
    "tools": []
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


class JsonStore:
    """Reads and writes one JSON file."""

    def __init__(self, path, default_data):
        self.path = path
        self.default_data = default_data

    def load(self):
        if not self.path.exists():
            data = copy.deepcopy(self.default_data)
            self.save(data)
            return data

        try:
            return json.loads(self.path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError:
            corrupt_path = self.path.with_suffix(f".corrupt{self.path.suffix}")
            self.path.replace(corrupt_path)
            data = copy.deepcopy(self.default_data)
            self.save(data)
            return data

    def save(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_file = self.path.with_suffix(f"{self.path.suffix}.tmp")
        temporary_file.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        temporary_file.replace(self.path)


class Validator:
    """Keeps the naming and value rules in one place."""

    @staticmethod
    def valid_scope(scope):
        if not isinstance(scope, str):
            return False
        if scope in {"global", "server"}:
            return True

        parts = scope.split(".")
        if len(parts) != 2:
            return False

        group, item_id = parts
        return group in {"clients", "devices"} and bool(VALID_NAME.match(item_id))

    @staticmethod
    def valid_variable(variable):
        return isinstance(variable, str) and bool(VALID_NAME.match(variable))

    @staticmethod
    def valid_value(value):
        return isinstance(value, VALID_VALUE_TYPES)


class StateManager:
    """Owns state.json and all scope/value mutations."""

    def __init__(self, store):
        self.store = store
        self.lock = Lock()
        self.state = self._load()

    def _load(self):
        loaded_state = self.store.load()
        migrated_state = self._migrate(loaded_state)
        changed = migrated_state != loaded_state
        changed = self._ensure_defaults(migrated_state) or changed

        server_scope = migrated_state["scopes"]["server"]
        server_scope["online"] = True
        server_scope["hostname"] = socket.gethostname()
        server_scope["platform"] = platform.system()
        server_scope["started_at"] = now_iso()
        server_scope["stopped_at"] = None
        changed = True

        if changed:
            self.store.save(migrated_state)

        return migrated_state

    def _migrate(self, loaded_state):
        if isinstance(loaded_state, dict) and "scopes" in loaded_state:
            return loaded_state

        old_values = {}
        if isinstance(loaded_state, dict):
            old_values = loaded_state.get("values", {})

        migrated_state = copy.deepcopy(DEFAULT_STATE)
        if isinstance(old_values, dict):
            migrated_state["scopes"]["global"].update(old_values)
        return migrated_state

    def _ensure_defaults(self, loaded_state):
        changed = False
        scopes = loaded_state.setdefault("scopes", {})

        for scope_name, default_value in DEFAULT_STATE["scopes"].items():
            if scope_name not in scopes:
                scopes[scope_name] = copy.deepcopy(default_value)
                changed = True
                continue

            if not isinstance(default_value, dict):
                continue

            if not isinstance(scopes[scope_name], dict):
                scopes[scope_name] = copy.deepcopy(default_value)
                changed = True
                continue

            for name, value in default_value.items():
                if name not in scopes[scope_name]:
                    scopes[scope_name][name] = copy.deepcopy(value)
                    changed = True

        changed = self._ensure_mapping(scopes, "clients") or changed
        changed = self._ensure_mapping(scopes, "devices") or changed
        return changed

    @staticmethod
    def _ensure_mapping(parent, name):
        if name not in parent or not isinstance(parent[name], dict):
            parent[name] = {}
            return True
        return False

    def snapshot(self):
        with self.lock:
            return {"scopes": copy.deepcopy(self.state["scopes"])}

    def _scope_values(self, scope, create=False):
        if scope in {"global", "server"}:
            return self.state["scopes"][scope]

        group, item_id = scope.split(".")
        group_values = self.state["scopes"].setdefault(group, {})

        if create:
            return group_values.setdefault(item_id, {})

        return group_values.get(item_id)

    def update_scope(self, scope, updates):
        if not Validator.valid_scope(scope) or not isinstance(updates, dict):
            return False

        clean_updates = {}
        for name, value in updates.items():
            if not Validator.valid_variable(name):
                continue
            if not Validator.valid_value(value):
                continue
            clean_updates[name] = value

        if not clean_updates:
            return False

        with self.lock:
            scope_values = self._scope_values(scope, create=True)
            changed = False

            for name, value in clean_updates.items():
                if scope_values.get(name) == value:
                    continue
                scope_values[name] = value
                changed = True

            if not changed:
                return False

            self.store.save(self.state)
            return True

    def set_variable(self, scope, variable, value):
        return self.update_scope(scope, {variable: value})

    def ensure_variable(self, scope, variable, value):
        if not Validator.valid_scope(scope) or not Validator.valid_variable(variable):
            return False
        if not Validator.valid_value(value):
            return False

        with self.lock:
            scope_values = self._scope_values(scope, create=True)

            if variable in scope_values:
                return False

            scope_values[variable] = value
            self.store.save(self.state)
            return True

    def delete_device(self, device_id):
        if not isinstance(device_id, str) or not VALID_NAME.match(device_id):
            return False

        with self.lock:
            devices = self.state["scopes"].setdefault("devices", {})

            if device_id not in devices:
                return False

            del devices[device_id]
            self.store.save(self.state)
            return True

    def register_client(self, message):
        client_id = message.get("client_id")
        client_type = message.get("client_type")

        if not isinstance(client_id, str) or not VALID_NAME.match(client_id):
            return None
        if not isinstance(client_type, str) or not VALID_NAME.match(client_type):
            client_type = "unknown"

        client_scope = f"clients.{client_id}"
        self.update_scope(
            client_scope,
            {
                "type": client_type,
                "online": True,
                "last_seen": now_iso(),
                "user_agent": str(message.get("user_agent") or "")[:300],
            },
        )
        return client_scope

    def register_device(self, message):
        device_id = message.get("device_id")
        device_type = message.get("device_type")
        device_name = message.get("name")

        if not isinstance(device_id, str) or not VALID_NAME.match(device_id):
            return None
        if not isinstance(device_type, str) or not VALID_NAME.match(device_type):
            device_type = "simulator"

        device_scope = f"devices.{device_id}"
        updates = {
            "type": device_type,
            "online": True,
            "last_seen": now_iso(),
        }

        if isinstance(device_name, str) and device_name.strip():
            updates["name"] = device_name.strip()[:80]

        self.update_scope(device_scope, updates)
        return device_scope

    def mark_offline(self, scope):
        return self.update_scope(
            scope,
            {
                "online": False,
                "last_seen": now_iso(),
            },
        )

    def mark_server_offline(self):
        with self.lock:
            server_scope = self.state["scopes"]["server"]
            server_scope["online"] = False
            server_scope["stopped_at"] = now_iso()
            self.store.save(self.state)


class UiManager:
    """Owns ui.json and control declarations."""

    def __init__(self, store):
        self.store = store
        self.lock = Lock()
        self.ui = self._load()

    def _load(self):
        loaded_ui = self.store.load()

        if not isinstance(loaded_ui, dict):
            loaded_ui = copy.deepcopy(DEFAULT_UI)

        if "controls" not in loaded_ui or not isinstance(loaded_ui["controls"], dict):
            loaded_ui["controls"] = {}
            self.store.save(loaded_ui)

        return loaded_ui

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.ui)

    def declare_input(self, scope, variable, input_type):
        if not Validator.valid_scope(scope) or not Validator.valid_variable(variable):
            return False
        if input_type not in INPUT_TYPES:
            return False

        control_key = f"{scope}.{variable}"
        next_control = {"type": input_type}

        with self.lock:
            controls = self.ui.setdefault("controls", {})

            if controls.get(control_key) == next_control:
                return False

            controls[control_key] = next_control
            self.store.save(self.ui)
            return True

    def delete_scope_controls(self, scope):
        if not Validator.valid_scope(scope):
            return False

        prefix = f"{scope}."

        with self.lock:
            controls = self.ui.setdefault("controls", {})
            removable_keys = [
                key for key in controls
                if key.startswith(prefix)
            ]

            if not removable_keys:
                return False

            for key in removable_keys:
                del controls[key]

            self.store.save(self.ui)
            return True


class ToolManager:
    """Owns tools.json and custom HTML/CSS/JS tools."""

    def __init__(self, store):
        self.store = store
        self.lock = Lock()
        self.tools = self._load()

    def _load(self):
        loaded_tools = self.store.load()

        if not isinstance(loaded_tools, dict):
            loaded_tools = copy.deepcopy(DEFAULT_TOOLS)

        if "tools" not in loaded_tools or not isinstance(loaded_tools["tools"], list):
            loaded_tools["tools"] = []
            self.store.save(loaded_tools)

        return loaded_tools

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.tools)

    def save_tool(self, message):
        title = message.get("title")
        html = message.get("html")
        css = message.get("css")
        js = message.get("js")
        tool_id = message.get("tool_id") or message.get("id")
        enabled = message.get("enabled", True)

        if not isinstance(title, str) or not title.strip():
            title = "Nueva herramienta"
        if not isinstance(html, str):
            html = ""
        if not isinstance(css, str):
            css = ""
        if not isinstance(js, str):
            js = ""
        if not isinstance(enabled, bool):
            enabled = True
        if not isinstance(tool_id, str) or not VALID_NAME.match(tool_id):
            tool_id = f"tool_{uuid.uuid4().hex[:8]}"

        next_tool = {
            "id": tool_id,
            "title": title.strip()[:80],
            "html": html,
            "css": css,
            "js": js,
            "enabled": enabled,
            "updated_at": now_iso(),
        }

        with self.lock:
            tools = self.tools.setdefault("tools", [])

            for index, tool in enumerate(tools):
                if isinstance(tool, dict) and tool.get("id") == tool_id:
                    next_tool["created_at"] = tool.get("created_at") or now_iso()
                    tools[index] = next_tool
                    self.store.save(self.tools)
                    return next_tool

            next_tool["created_at"] = now_iso()
            tools.append(next_tool)
            self.store.save(self.tools)
            return next_tool

    def delete_tool(self, tool_id):
        if not isinstance(tool_id, str) or not VALID_NAME.match(tool_id):
            return False

        with self.lock:
            tools = self.tools.setdefault("tools", [])
            next_tools = [
                tool for tool in tools
                if not isinstance(tool, dict) or tool.get("id") != tool_id
            ]

            if len(next_tools) == len(tools):
                return False

            self.tools["tools"] = next_tools
            self.store.save(self.tools)
            return True


class ConnectionManager:
    """Tracks WebSocket clients and the scope attached to each connection."""

    def __init__(self):
        self.lock = Lock()
        self.clients = set()
        self.scopes = {}

    def add(self, client):
        with self.lock:
            self.clients.add(client)

    def remove(self, client):
        with self.lock:
            self.clients.discard(client)
            return self.scopes.pop(client, None)

    def bind_scope(self, client, scope):
        with self.lock:
            self.scopes[client] = scope

    def unbind_scope(self, scope):
        with self.lock:
            removable_clients = [
                client for client, client_scope in self.scopes.items()
                if client_scope == scope
            ]

            for client in removable_clients:
                self.scopes.pop(client, None)

    def broadcast(self, message):
        with self.lock:
            recipients = list(self.clients)

        disconnected = set()
        for client in recipients:
            try:
                client.send(json.dumps(message))
            except Exception:
                disconnected.add(client)

        if disconnected:
            with self.lock:
                self.clients.difference_update(disconnected)
                for client in disconnected:
                    self.scopes.pop(client, None)


class NinaServer:
    """Coordinates state, UI metadata and WebSocket messages."""

    def __init__(self, state, ui, tools, connections):
        self.state = state
        self.ui = ui
        self.tools = tools
        self.connections = connections

    def state_message(self):
        return {
            "type": "state",
            **self.state.snapshot(),
            "ui": self.ui.snapshot(),
            "tools": self.tools.snapshot(),
        }

    def broadcast_state(self):
        self.connections.broadcast(self.state_message())

    def handle_client(self, client):
        self.connections.add(client)
        client.send(json.dumps(self.state_message()))

        try:
            while True:
                raw_message = client.receive()
                if raw_message is None:
                    break

                message = self._decode_message(raw_message)
                if message is None:
                    continue

                self.handle_message(client, message)
        finally:
            connection_scope = self.connections.remove(client)
            if connection_scope and self.state.mark_offline(connection_scope):
                self.broadcast_state()

    @staticmethod
    def _decode_message(raw_message):
        try:
            message = json.loads(raw_message)
        except (TypeError, json.JSONDecodeError):
            return None

        if not isinstance(message, dict):
            return None

        return message

    def handle_message(self, client, message):
        message_type = message.get("type")

        if message_type == "register_client":
            scope = self.state.register_client(message)
            if scope:
                self.connections.bind_scope(client, scope)
                self.broadcast_state()
            return

        if message_type == "register_device":
            scope = self.state.register_device(message)
            if scope:
                self.connections.bind_scope(client, scope)
                self.broadcast_state()
            return

        if message_type == "ensure_variable":
            self._handle_ensure_variable(message)
            return

        if message_type == "declare_input":
            self._handle_declare_input(message)
            return

        if message_type == "delete_device":
            self._handle_delete_device(message)
            return

        if message_type == "save_tool":
            self._handle_save_tool(message)
            return

        if message_type == "delete_tool":
            self._handle_delete_tool(message)
            return

        if message_type == "set_variable":
            self._handle_set_variable(message)

    def _safe_scope_variable(self, message):
        scope = message.get("scope")
        variable = message.get("variable")

        if not Validator.valid_scope(scope):
            return None, None
        if scope == "server":
            return None, None
        if not Validator.valid_variable(variable):
            return None, None

        return scope, variable

    def _handle_ensure_variable(self, message):
        scope, variable = self._safe_scope_variable(message)
        if scope is None:
            return

        if self.state.ensure_variable(scope, variable, message.get("value")):
            self.broadcast_state()

    def _handle_declare_input(self, message):
        scope, variable = self._safe_scope_variable(message)
        if scope is None:
            return

        input_type = message.get("input_type") or message.get("input")
        if not isinstance(input_type, str):
            return

        if self.ui.declare_input(scope, variable, input_type):
            self.broadcast_state()

    def _handle_set_variable(self, message):
        scope, variable = self._safe_scope_variable(message)
        if scope is None:
            return

        if self.state.set_variable(scope, variable, message.get("value")):
            self.broadcast_state()

    def _handle_delete_device(self, message):
        device_id = message.get("device_id")

        if not isinstance(device_id, str) or not VALID_NAME.match(device_id):
            return

        device_scope = f"devices.{device_id}"
        state_changed = self.state.delete_device(device_id)
        ui_changed = self.ui.delete_scope_controls(device_scope)
        self.connections.unbind_scope(device_scope)

        if state_changed or ui_changed:
            self.broadcast_state()

    def _handle_save_tool(self, message):
        saved_tool = self.tools.save_tool(message)

        if saved_tool:
            self.broadcast_state()

    def _handle_delete_tool(self, message):
        tool_id = message.get("tool_id") or message.get("id")

        if self.tools.delete_tool(tool_id):
            self.broadcast_state()


app = Flask(__name__)
sock = Sock(app)

state_store = JsonStore(STATE_FILE, DEFAULT_STATE)
ui_store = JsonStore(UI_FILE, DEFAULT_UI)
tools_store = JsonStore(TOOLS_FILE, DEFAULT_TOOLS)
state_manager = StateManager(state_store)
ui_manager = UiManager(ui_store)
tool_manager = ToolManager(tools_store)
connections = ConnectionManager()
nina = NinaServer(state_manager, ui_manager, tool_manager, connections)

atexit.register(state_manager.mark_server_offline)


@app.after_request
def disable_browser_cache(response):
    # Durante el desarrollo, obliga a telÃ©fonos y computadoras a cargar
    # siempre la versiÃ³n actual del HTML, CSS y JavaScript.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/docs")
def docs():
    if README_FILE.exists():
        readme_text = README_FILE.read_text(encoding="utf-8-sig")
    else:
        readme_text = "# README no encontrado\n\nCrea un archivo `README.md` en la raíz del proyecto."

    if markdown_lib:
        readme_html = markdown_lib.markdown(
            readme_text,
            extensions=["fenced_code", "tables", "toc"],
            output_format="html5",
        )
    else:
        readme_html = f"<pre>{escape(readme_text)}</pre>"

    return render_template("docs.html", readme_html=Markup(readme_html))


@app.get("/tools")
def tools():
    return render_template("tools.html")


@app.get("/api/tools")
def api_tools():
    return jsonify(tool_manager.snapshot())


@sock.route("/ws")
def websocket(client):
    nina.handle_client(client)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

