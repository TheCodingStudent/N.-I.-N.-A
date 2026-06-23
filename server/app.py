import json
from threading import Lock

from flask import Flask, render_template
from flask_sock import Sock


app = Flask(__name__)
sock = Sock(app)

state_lock = Lock()
clients_lock = Lock()
state = {"active": False}
clients = set()


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
        return dict(state)


def send_json(client, message):
    client.send(json.dumps(message))


def broadcast(message):
    with clients_lock:
        recipients = list(clients)

    disconnected = set()
    for client in recipients:
        try: send_json(client, message)
        except Exception: disconnected.add(client)

    if disconnected:
        with clients_lock:
            clients.difference_update(disconnected)


def set_active(value):
    with state_lock:
        if state["active"] == value:
            return False
        state["active"] = value

    broadcast({"type": "state", **current_state()})
    return True


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

            if message.get("type") != "set_active":
                continue
            if not isinstance(message.get("active"), bool):
                continue

            # No se transmite nada si el valor ya era el solicitado.
            set_active(message["active"])
    finally:
        with clients_lock:
            clients.discard(client)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
