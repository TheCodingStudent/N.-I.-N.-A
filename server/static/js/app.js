const connection = document.querySelector('#connection');
const clientIdentity = document.querySelector('#client-identity');
const widgets = document.querySelectorAll('[data-widget][data-scope][data-variable]');
const actionButtons = document.querySelectorAll('[data-action][data-scope][data-variable]');

let scopes = {};
let socket;
let reconnectTimer;

function validId(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function createClientId(type) {
  const random = crypto.randomUUID?.().slice(0, 8) ?? Math.random().toString(16).slice(2, 10);
  return `${type}_${random}`.replace(/[^A-Za-z0-9_]/g, '_');
}

function detectClientType() {
  const userAgent = navigator.userAgent || '';

  if (/iPhone|Android.*Mobile|Windows Phone/i.test(userAgent)) {
    return 'phone';
  }

  if (/iPad|Android/i.test(userAgent) || navigator.maxTouchPoints > 1) {
    return 'tablet';
  }

  return 'laptop';
}

function getClientIdentity() {
  let clientType = localStorage.getItem('ninaClientType');
  let clientId = localStorage.getItem('ninaClientId');

  if (!validId(clientType || '')) {
    clientType = detectClientType();
    localStorage.setItem('ninaClientType', clientType);
  }

  if (!validId(clientId || '')) {
    clientId = createClientId(clientType);
    localStorage.setItem('ninaClientId', clientId);
  }

  return { clientId, clientType };
}

const identity = getClientIdentity();

if (clientIdentity) {
  clientIdentity.textContent = `Cliente: ${identity.clientId} (${identity.clientType})`;
}

function boolLabel(element, value) {
  return value ? element.dataset.true ?? 'Encendido' : element.dataset.false ?? 'Apagado';
}

function scopedValue(scope, variable) {
  let current = scopes;

  for (const part of scope.split('.')) {
    current = current?.[part];
  }

  return current?.[variable];
}

function renderWidget(element, value) {
  if (element.dataset.widget === 'indicator') {
    element.classList.toggle('active', Boolean(value));
    element.setAttribute('aria-label', boolLabel(element, value));
    return;
  }

  if (element.dataset.widget === 'text') {
    element.textContent = boolLabel(element, value);
    return;
  }

  if (element.dataset.widget === 'button') {
    element.textContent = boolLabel(element, value);
  }
}

function renderState(nextScopes) {
  scopes = { ...nextScopes };

  widgets.forEach((element) => {
    const value = scopedValue(element.dataset.scope, element.dataset.variable);
    renderWidget(element, value);
  });
}

function setActionsEnabled(enabled) {
  actionButtons.forEach((button) => {
    button.disabled = !enabled;
  });
}

function sendVariable(scope, variable, value) {
  if (socket?.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({
    type: 'set_variable',
    scope,
    variable,
    value
  }));
}

function registerClient() {
  socket.send(JSON.stringify({
    type: 'register_client',
    client_id: identity.clientId,
    client_type: identity.clientType,
    user_agent: navigator.userAgent
  }));
}

function connect() {
  clearTimeout(reconnectTimer);

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}/ws`);

  connection.textContent = 'Conectando con el servidor…';
  setActionsEnabled(false);

  socket.addEventListener('open', () => {
    connection.textContent = 'Sincronizando estado…';
    registerClient();
  });

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === 'state') {
      renderState(message.scopes);
      connection.textContent = 'Servidor conectado';
      setActionsEnabled(true);
    }
  });

  socket.addEventListener('close', () => {
    connection.textContent = 'Sin conexión. Reconectando…';
    setActionsEnabled(false);
    reconnectTimer = setTimeout(connect, 2000);
  });

  socket.addEventListener('error', () => socket.close());
}

actionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const scope = button.dataset.scope;
    const variable = button.dataset.variable;

    if (button.dataset.action === 'toggle') {
      sendVariable(scope, variable, !Boolean(scopedValue(scope, variable)));
    }
  });
});

connect();
