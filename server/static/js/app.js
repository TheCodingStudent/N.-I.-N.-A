const connection = document.querySelector('#connection');
const clientIdentity = document.querySelector('#client-identity');
const scopeRoot = document.querySelector('#scope-root');

const controllableVariables = new Set([
  'global.active',
  'devices.esp32_demo.active'
]);

let scopes = {};
let socket;
let reconnectTimer;
let actionsEnabled = false;

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

function fullName(scope, variable) {
  return `${scope}.${variable}`;
}

function boolLabel(value) {
  return value ? 'Encendido' : 'Apagado';
}

function valueLabel(value) {
  if (typeof value === 'boolean') return boolLabel(value);
  if (value === null) return 'Sin dato';
  if (value === '') return 'Vacio';
  return String(value);
}

function groupDescription(groupName) {
  if (groupName === 'global') return 'Variables compartidas';
  if (groupName === 'server') return 'Laptop anfitriona';
  if (groupName === 'clients') return 'Clientes navegador';
  if (groupName === 'devices') return 'Dispositivos fisicos';
  return 'Scope';
}

function isVariableMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  return Object.values(value).every((item) => {
    return item === null || typeof item !== 'object' || Array.isArray(item);
  });
}

function groupedScopes(nextScopes) {
  return Object.entries(nextScopes).map(([groupName, groupValue]) => {
    if (isVariableMap(groupValue)) {
      return {
        name: groupName,
        type: 'single',
        sections: [{ name: null, scope: groupName, values: groupValue }]
      };
    }

    const sections = Object.entries(groupValue || {})
      .filter(([, itemValue]) => isVariableMap(itemValue))
      .map(([itemName, itemValue]) => ({
        name: itemName,
        scope: `${groupName}.${itemName}`,
        values: itemValue
      }));

    return {
      name: groupName,
      type: 'group',
      sections
    };
  });
}

function findValue(scopeName, variable) {
  if (!scopeName.includes('.')) {
    return scopes?.[scopeName]?.[variable];
  }

  const [groupName, itemName] = scopeName.split('.');
  return scopes?.[groupName]?.[itemName]?.[variable];
}

function rememberedOpenGroups() {
  const openGroups = new Set();

  scopeRoot.querySelectorAll('.scope-frame').forEach((frame) => {
    if (frame.open) openGroups.add(frame.dataset.group);
  });

  return openGroups;
}

function createElement(tagName, options = {}) {
  const element = document.createElement(tagName);

  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([name, value]) => {
      element.setAttribute(name, value);
    });
  }

  return element;
}

function createIndicator(value) {
  return createElement('div', {
    className: `indicator ${value ? 'active' : ''}`,
    attributes: {
      role: 'status',
      'aria-label': valueLabel(value)
    }
  });
}

function createValueMarker() {
  return createElement('div', {
    className: 'value-marker',
    attributes: { 'aria-hidden': 'true' }
  });
}

function createVariableRow(scopeName, variable, value) {
  const row = createElement('article', { className: 'widget-card' });

  row.appendChild(
    typeof value === 'boolean' ? createIndicator(value) : createValueMarker()
  );

  const copy = createElement('div', { className: 'state-copy' });
  copy.appendChild(createElement('h2', { text: variable }));
  copy.appendChild(createElement('p', { text: valueLabel(value) }));
  row.appendChild(copy);

  if (typeof value === 'boolean' && controllableVariables.has(fullName(scopeName, variable))) {
    const button = createElement('button', {
      text: value ? 'Apagar' : 'Encender',
      attributes: {
        type: 'button',
        'data-action': 'toggle',
        'data-scope': scopeName,
        'data-variable': variable
      }
    });

    button.disabled = !actionsEnabled;
    row.appendChild(button);
  }

  return row;
}

function createEmptyRow(text = 'Este scope todavia no tiene datos.') {
  const row = createElement('article', { className: 'widget-card empty-card' });
  row.appendChild(createValueMarker());

  const copy = createElement('div', { className: 'state-copy' });
  copy.appendChild(createElement('h2', { text: 'Sin variables' }));
  copy.appendChild(createElement('p', { text }));
  row.appendChild(copy);

  return row;
}

function createSection(section) {
  const sectionElement = createElement('section', { className: 'scope-section' });

  if (section.name) {
    sectionElement.appendChild(createElement('h3', { text: section.name }));
  }

  const list = createElement('div', { className: 'state-list' });
  const entries = Object.entries(section.values);

  if (entries.length === 0) {
    list.appendChild(createEmptyRow());
  } else {
    entries.forEach(([variable, value]) => {
      list.appendChild(createVariableRow(section.scope, variable, value));
    });
  }

  sectionElement.appendChild(list);
  return sectionElement;
}

function createGroupFrame(group, openGroups, index) {
  const frame = createElement('details', {
    className: 'scope-frame',
    attributes: { 'data-group': group.name }
  });

  if (openGroups.has(group.name) || index < 2) {
    frame.open = true;
  }

  const summary = createElement('summary');
  summary.appendChild(createElement('span', { text: group.name }));
  summary.appendChild(createElement('small', { text: groupDescription(group.name) }));
  frame.appendChild(summary);

  const body = createElement('div', { className: 'scope-body' });

  if (group.sections.length === 0) {
    body.appendChild(createEmptyRow('Este grupo todavia no tiene elementos.'));
  } else {
    group.sections.forEach((section) => {
      body.appendChild(createSection(section));
    });
  }

  frame.appendChild(body);
  return frame;
}

function renderState(nextScopes) {
  scopes = { ...nextScopes };

  const openGroups = rememberedOpenGroups();
  const groups = groupedScopes(scopes);
  scopeRoot.innerHTML = '';

  groups.forEach((group, index) => {
    scopeRoot.appendChild(createGroupFrame(group, openGroups, index));
  });
}

function setActionsEnabled(enabled) {
  actionsEnabled = enabled;

  document.querySelectorAll('[data-action][data-scope][data-variable]').forEach((button) => {
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

  connection.textContent = 'Conectando con el servidor...';
  setActionsEnabled(false);

  socket.addEventListener('open', () => {
    connection.textContent = 'Sincronizando estado...';
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
    connection.textContent = 'Sin conexion. Reconectando...';
    setActionsEnabled(false);
    reconnectTimer = setTimeout(connect, 2000);
  });

  socket.addEventListener('error', () => socket.close());
}

scopeRoot.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="toggle"]');
  if (!button) return;

  const scope = button.dataset.scope;
  const variable = button.dataset.variable;
  const currentValue = Boolean(findValue(scope, variable));

  sendVariable(scope, variable, !currentValue);
});

connect();
