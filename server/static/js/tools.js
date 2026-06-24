const toolList = document.querySelector('#tool-list');
const variableList = document.querySelector('#variable-list');
const runtimeRoot = document.querySelector('#tools-runtime');
const connection = document.querySelector('#tools-connection');
const titleInput = document.querySelector('#tool-title');
const saveButton = document.querySelector('#save-tool');
const deleteButton = document.querySelector('#delete-tool');
const newButton = document.querySelector('#new-tool');
const editorTabButton = document.querySelector('#show-editor-tab');
const toolSelect = document.querySelector('#tool-tab-select');
const editorWorkspace = document.querySelector('#editor-workspace');
const toolWorkspace = document.querySelector('#tool-workspace');
const activeToolTitle = document.querySelector('#active-tool-title');
const backToEditorButton = document.querySelector('#back-to-editor');
const tabButtons = document.querySelectorAll('[data-code-tab]');
const editors = {
  html: document.querySelector('#code-html'),
  css: document.querySelector('#code-css'),
  js: document.querySelector('#code-js')
};

let socket;
let reconnectTimer;
let scopes = {};
let tools = [];
let selectedToolId = null;
let runtimeToolId = null;
let pendingOpenToolId = null;
let activeTab = 'html';
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

  if (/iPhone|Android.*Mobile|Windows Phone/i.test(userAgent)) return 'phone';
  if (/iPad|Android/i.test(userAgent) || navigator.maxTouchPoints > 1) return 'tablet';
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

  return {
    clientType,
    clientId: `${clientId}_tools`
  };
}

const identity = getClientIdentity();

function createElement(tagName, options = {}) {
  const element = document.createElement(tagName);

  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.html !== undefined) element.innerHTML = options.html;
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([name, value]) => {
      element.setAttribute(name, value);
    });
  }

  return element;
}

function parsePath(path) {
  if (typeof path !== 'string') return null;

  const parts = path.split('.');
  if (parts.length < 2) return null;

  if (parts[0] === 'devices' || parts[0] === 'clients') {
    if (parts.length !== 3) return null;
    return { scope: `${parts[0]}.${parts[1]}`, variable: parts[2] };
  }

  if (parts.length !== 2) return null;
  return { scope: parts[0], variable: parts[1] };
}

function getValue(path) {
  const parsed = parsePath(path);
  if (!parsed) return undefined;

  if (!parsed.scope.includes('.')) {
    return scopes?.[parsed.scope]?.[parsed.variable];
  }

  const [groupName, itemName] = parsed.scope.split('.');
  return scopes?.[groupName]?.[itemName]?.[parsed.variable];
}

function sendVariable(path, value) {
  const parsed = parsePath(path);
  if (!parsed || socket?.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({
    type: 'set_variable',
    scope: parsed.scope,
    variable: parsed.variable,
    value
  }));
}

function allVariablePaths() {
  const paths = [];

  Object.entries(scopes || {}).forEach(([groupName, groupValue]) => {
    if (!groupValue || typeof groupValue !== 'object' || Array.isArray(groupValue)) return;

    const isFlatScope = Object.values(groupValue).every((value) => {
      return value === null || typeof value !== 'object' || Array.isArray(value);
    });

    if (isFlatScope) {
      Object.keys(groupValue).forEach((variable) => paths.push(`${groupName}.${variable}`));
      return;
    }

    Object.entries(groupValue).forEach(([itemName, itemValue]) => {
      if (!itemValue || typeof itemValue !== 'object' || Array.isArray(itemValue)) return;
      Object.keys(itemValue).forEach((variable) => {
        paths.push(`${groupName}.${itemName}.${variable}`);
      });
    });
  });

  return paths.sort();
}

function selectedTool() {
  return tools.find((tool) => tool.id === selectedToolId) || null;
}

function runtimeTool() {
  return tools.find((tool) => tool.id === runtimeToolId) || null;
}

function setEditorValue(tool) {
  titleInput.value = tool?.title || '';
  editors.html.value = tool?.html || defaultHtml();
  editors.css.value = tool?.css || defaultCss();
  editors.js.value = tool?.js || defaultJs();
  deleteButton.disabled = !tool || !actionsEnabled;
}

function defaultHtml() {
  return `<div class="nina-card">\n  <h2>Mi herramienta</h2>\n  <p>Selecciona una variable del sidebar.</p>\n</div>`;
}

function defaultCss() {
  return `.nina-card {\n  padding: 14px;\n  border: 1px solid rgba(255,255,255,.55);\n  border-radius: 10px;\n  background: rgba(255,255,255,.08);\n}`;
}

function defaultJs() {
  return `// tool = contenedor de esta herramienta\n// NINA.get(path), NINA.set(path, value), NINA.toggle(path), NINA.on(path, callback)\n`;
}

function renderToolList() {
  toolList.innerHTML = '';

  if (!tools.length) {
    toolList.appendChild(createElement('p', {
      className: 'empty-copy',
      text: 'Todavía no hay herramientas.'
    }));
    return;
  }

  tools.forEach((tool) => {
    const button = createElement('button', {
      className: `tool-list-item ${tool.id === selectedToolId ? 'active' : ''}`,
      text: tool.title || tool.id,
      attributes: {
        type: 'button',
        'data-tool-id': tool.id
      }
    });
    toolList.appendChild(button);
  });
}

function renderToolSelect() {
  const currentValue = runtimeToolId || '';
  toolSelect.innerHTML = '';

  toolSelect.appendChild(createElement('option', {
    text: 'Escoger herramienta...',
    attributes: { value: '' }
  }));

  tools.forEach((tool) => {
    toolSelect.appendChild(createElement('option', {
      text: tool.title || tool.id,
      attributes: { value: tool.id }
    }));
  });

  if (tools.some((tool) => tool.id === currentValue)) {
    toolSelect.value = currentValue;
  } else {
    toolSelect.value = '';
  }
}

function renderVariableList() {
  variableList.innerHTML = '';

  const paths = allVariablePaths();
  if (!paths.length) {
    variableList.appendChild(createElement('p', {
      className: 'empty-copy',
      text: 'No hay variables disponibles.'
    }));
    return;
  }

  paths.forEach((path) => {
    const value = getValue(path);
    const row = createElement('article', { className: 'variable-chip' });
    row.appendChild(createElement('strong', { text: path }));
    row.appendChild(createElement('small', { text: value === null ? 'null' : String(value) }));

    const actions = createElement('div', { className: 'snippet-actions' });
    actions.appendChild(createElement('button', {
      text: 'Valor',
      attributes: { type: 'button', 'data-snippet': 'value', 'data-path': path }
    }));

    if (typeof value === 'boolean') {
      actions.appendChild(createElement('button', {
        text: 'Toggle',
        attributes: { type: 'button', 'data-snippet': 'toggle', 'data-path': path }
      }));
    }

    row.appendChild(actions);
    variableList.appendChild(row);
  });
}

function renderRuntime() {
  runtimeRoot.innerHTML = '';
  const toolDefinition = runtimeTool();

  if (!toolDefinition) {
    activeToolTitle.textContent = 'Selecciona una herramienta';
    runtimeRoot.appendChild(createElement('p', {
      className: 'empty-copy',
      text: 'Escoge una herramienta desde el menú Tools para renderizarla aquí.'
    }));
    return;
  }

  activeToolTitle.textContent = toolDefinition.title || toolDefinition.id;

  const wrapper = createElement('section', {
    className: 'custom-tool active-tool-view',
    attributes: { 'data-tool-id': toolDefinition.id }
  });

  const body = createElement('div', { className: 'custom-tool-body' });
  body.innerHTML = toolDefinition.html || '';

  if (toolDefinition.css) {
    const style = createElement('style', { text: toolDefinition.css });
    wrapper.appendChild(style);
  }

  wrapper.appendChild(body);
  runtimeRoot.appendChild(wrapper);
  runToolScript(body, toolDefinition);
}

function runToolScript(toolElement, toolDefinition) {
  if (!toolDefinition.js?.trim()) return;

  const ninaApi = createNinaApi();

  try {
    const run = new Function('tool', 'NINA', toolDefinition.js);
    run(toolElement, ninaApi);
  } catch (error) {
    const errorBox = createElement('pre', {
      className: 'tool-error',
      text: `Error en ${toolDefinition.title || toolDefinition.id}:\n${error.message}`
    });
    toolElement.appendChild(errorBox);
  }
}

function createNinaApi() {
  return {
    get: getValue,
    set: sendVariable,
    toggle(path) {
      sendVariable(path, !Boolean(getValue(path)));
    },
    on(path, callback) {
      if (typeof callback === 'function') {
        callback(getValue(path), path);
      }
    },
    paths: allVariablePaths
  };
}

function showEditor() {
  editorWorkspace.classList.add('active');
  toolWorkspace.classList.remove('active');
  editorTabButton.classList.add('active');
  toolSelect.value = runtimeToolId || '';
}

function showTool(toolId) {
  runtimeToolId = toolId;
  editorWorkspace.classList.remove('active');
  toolWorkspace.classList.add('active');
  editorTabButton.classList.remove('active');
  renderToolSelect();
  renderRuntime();
}

function renderAll() {
  if (!selectedToolId && tools.length) {
    selectedToolId = tools[0].id;
    setEditorValue(tools[0]);
  }

  if (runtimeToolId && !tools.some((tool) => tool.id === runtimeToolId)) {
    runtimeToolId = null;
    showEditor();
  }

  renderToolList();
  renderToolSelect();
  renderVariableList();
  renderRuntime();
}

function setActionsEnabled(enabled) {
  actionsEnabled = enabled;
  saveButton.disabled = !enabled;
  deleteButton.disabled = !enabled || !selectedToolId;
  newButton.disabled = !enabled;
  toolSelect.disabled = !enabled;
}

function saveCurrentTool() {
  if (socket?.readyState !== WebSocket.OPEN) return;

  if (!selectedToolId) {
    selectedToolId = createToolId(titleInput.value);
  }

  pendingOpenToolId = selectedToolId;

  socket.send(JSON.stringify({
    type: 'save_tool',
    tool_id: selectedToolId,
    title: titleInput.value,
    html: editors.html.value,
    css: editors.css.value,
    js: editors.js.value,
    enabled: true
  }));
}

function createToolId(title) {
  const base = String(title || 'tool')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);

  const safeBase = /^[a-z_]/.test(base) ? base : `tool_${base}`;
  const random = Math.random().toString(16).slice(2, 8);
  return `${safeBase || 'tool'}_${random}`;
}

function deleteCurrentTool() {
  const tool = selectedTool();
  if (!tool || socket?.readyState !== WebSocket.OPEN) return;

  if (!window.confirm(`¿Borrar la herramienta "${tool.title}"?`)) return;

  socket.send(JSON.stringify({
    type: 'delete_tool',
    tool_id: tool.id
  }));

  if (runtimeToolId === tool.id) {
    runtimeToolId = null;
  }

  selectedToolId = null;
  setEditorValue(null);
  showEditor();
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const current = textarea.value;
  textarea.value = `${current.slice(0, start)}${text}${current.slice(end)}`;
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
}

function safeIdFromPath(path, suffix) {
  return `${path}_${suffix}`.replace(/[^A-Za-z0-9_]/g, '_');
}

function insertValueSnippet(path) {
  const elementId = safeIdFromPath(path, 'value');
  insertAtCursor(editors.html, `\n<span id="${elementId}"></span>`);
  insertAtCursor(editors.js, `\nNINA.on("${path}", (value) => {\n  tool.querySelector("#${elementId}").textContent = value ?? "null";\n});\n`);
}

function insertToggleSnippet(path) {
  const elementId = safeIdFromPath(path, 'toggle');
  insertAtCursor(editors.html, `\n<button id="${elementId}" type="button">Toggle ${path}</button>`);
  insertAtCursor(editors.js, `\ntool.querySelector("#${elementId}").addEventListener("click", () => {\n  NINA.toggle("${path}");\n});\n`);
}

function switchTab(tabName) {
  activeTab = tabName;

  tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.codeTab === tabName);
  });

  Object.entries(editors).forEach(([name, editor]) => {
    editor.classList.toggle('active', name === tabName);
  });
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

  connection.textContent = 'Conectando...';
  setActionsEnabled(false);

  socket.addEventListener('open', () => {
    connection.textContent = 'Sincronizando...';
    registerClient();
  });

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);

    if (message.type !== 'state') return;

    scopes = message.scopes || {};
    tools = Array.isArray(message.tools?.tools) ? message.tools.tools : [];

    if (selectedToolId && !tools.some((tool) => tool.id === selectedToolId)) {
      selectedToolId = tools[0]?.id ?? null;
      setEditorValue(selectedTool());
    }

    if (pendingOpenToolId && tools.some((tool) => tool.id === pendingOpenToolId)) {
      runtimeToolId = pendingOpenToolId;
      pendingOpenToolId = null;
      showTool(runtimeToolId);
    }

    connection.textContent = 'Conectado';
    setActionsEnabled(true);
    renderAll();
  });

  socket.addEventListener('close', () => {
    connection.textContent = 'Sin conexión. Reconectando...';
    setActionsEnabled(false);
    reconnectTimer = setTimeout(connect, 2000);
  });

  socket.addEventListener('error', () => socket.close());
}

toolList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tool-id]');
  if (!button) return;

  selectedToolId = button.dataset.toolId;
  setEditorValue(selectedTool());
  renderToolList();
  showEditor();
});

variableList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-snippet][data-path]');
  if (!button) return;

  const path = button.dataset.path;
  if (button.dataset.snippet === 'value') insertValueSnippet(path);
  if (button.dataset.snippet === 'toggle') insertToggleSnippet(path);
  switchTab(activeTab);
  showEditor();
});

tabButtons.forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.codeTab));
});

toolSelect.addEventListener('change', () => {
  if (toolSelect.value) {
    showTool(toolSelect.value);
  } else {
    showEditor();
  }
});

editorTabButton.addEventListener('click', showEditor);
backToEditorButton.addEventListener('click', showEditor);

newButton.addEventListener('click', () => {
  selectedToolId = null;
  setEditorValue(null);
  renderToolList();
  showEditor();
});

saveButton.addEventListener('click', saveCurrentTool);
deleteButton.addEventListener('click', deleteCurrentTool);

setEditorValue(null);
switchTab('html');
showEditor();
connect();
