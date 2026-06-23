const indicator = document.querySelector('#indicator');
const stateText = document.querySelector('#state-text');
const toggle = document.querySelector('#toggle');
const connection = document.querySelector('#connection');

let active = false;
let socket;
let reconnectTimer;

function render(state) {
  active = state.active;
  indicator.classList.toggle('active', active);
  indicator.setAttribute('aria-label', active ? 'Encendido' : 'Apagado');
  stateText.textContent = active ? 'Encendido' : 'Apagado';
  toggle.textContent = active ? 'Apagar' : 'Encender';
}

function connect() {
  clearTimeout(reconnectTimer);

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}/ws`);

  connection.textContent = 'Conectando con el servidor…';
  toggle.disabled = true;

  socket.addEventListener('open', () => {
    connection.textContent = 'Sincronizando estado…';
  });

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === 'state') {
      render(message);
      connection.textContent = 'Servidor conectado';
      toggle.disabled = false;
    }
  });

  socket.addEventListener('close', () => {
    connection.textContent = 'Sin conexión. Reconectando…';
    toggle.disabled = true;
    reconnectTimer = setTimeout(connect, 2000);
  });

  socket.addEventListener('error', () => socket.close());
}

toggle.addEventListener('click', () => {
  if (socket?.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({
    type: 'set_active',
    active: !active
  }));
});

connect();
