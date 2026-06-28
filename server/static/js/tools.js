const toolList = document.querySelector('#tool-list');
const variableList = document.querySelector('#variable-list');
const variableSearch = document.querySelector('#variable-search');
const runtimeRoot = document.querySelector('#tools-runtime');
const titleInput = document.querySelector('#tool-title');
const saveButton = document.querySelector('#save-tool');
const exportButton = document.querySelector('#export-tool');
const editorStatus = document.querySelector('#editor-status');
const newButton = document.querySelector('#new-tool');
const codePanel = document.querySelector('.code-panel');
const editorWorkspace = document.querySelector('#editor-workspace');
const toolWorkspace = document.querySelector('#tool-workspace');
const activeToolTitle = document.querySelector('#active-tool-title');
const tabButtons = document.querySelectorAll('[data-code-tab]');
const editors = {
  html: document.querySelector('#code-html'),
  css: document.querySelector('#code-css'),
  js: document.querySelector('#code-js')
};
const codeEditors = {};

let socket;
let reconnectTimer;
let scopes = {};
let historyState = { tracked: {}, series: {} };
let tools = [];
let selectedToolId = null;
let runtimeToolId = null;
let initialRuntimeToolId = new URLSearchParams(location.search).get('tool');
let activeTab = 'html';
let actionsEnabled = false;
let pendingSavedToolId = null;
let variableSearchTerm = '';
const requestedHistoryPaths = new Set();

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
    clientId
  };
}

const identity = getClientIdentity();

function initializeCodeEditors() {
  if (!window.NinaCodeMirror) return;

  Object.entries(editors).forEach(([name, textarea]) => {
    codeEditors[name] = window.NinaCodeMirror.createFromTextarea(textarea, name);
  });
}

function getCodeValue(name) {
  return codeEditors[name]?.getValue() ?? editors[name].value;
}

function setCodeValue(name, value) {
  if (codeEditors[name]) {
    codeEditors[name].setValue(value);
    return;
  }

  editors[name].value = value;
}

function insertCodeText(name, text) {
  if (codeEditors[name]) {
    codeEditors[name].insertText(text);
    return;
  }

  insertAtCursor(editors[name], text);
}

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

function sendTrackHistory(path, points = 1000) {
  const parsed = parsePath(path);
  if (!parsed || socket?.readyState !== WebSocket.OPEN) return;

  const maxPoints = Number.isFinite(Number(points)) ? Number(points) : 1000;
  const trackKey = `${path}:${maxPoints}`;
  if (requestedHistoryPaths.has(trackKey)) return;

  requestedHistoryPaths.add(trackKey);
  socket.send(JSON.stringify({
    type: 'track_history',
    path,
    max_points: maxPoints
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
      if (groupName === 'clients' && itemName.endsWith('_tools')) return;
      Object.keys(itemValue).forEach((variable) => {
        paths.push(`${groupName}.${itemName}.${variable}`);
      });
    });
  });

  return paths.sort();
}

function groupedVariablePaths() {
  const groups = new Map();
  const query = variableSearchTerm.trim().toLowerCase();

  allVariablePaths().forEach((path) => {
    const parsed = parsePath(path);
    if (!parsed) return;

    const value = getValue(path);
    const searchable = `${path} ${value === null ? 'null' : String(value)}`.toLowerCase();
    if (query && !searchable.includes(query)) return;

    if (!groups.has(parsed.scope)) {
      groups.set(parsed.scope, []);
    }

    groups.get(parsed.scope).push({
      path,
      variable: parsed.variable,
      value
    });
  });

  return Array.from(groups.entries())
    .map(([scope, variables]) => ({ scope, variables }))
    .sort((first, second) => first.scope.localeCompare(second.scope));
}

function selectedTool() {
  return tools.find((tool) => tool.id === selectedToolId) || null;
}

function runtimeTool() {
  return tools.find((tool) => tool.id === runtimeToolId) || null;
}

function setEditorValue(tool) {
  titleInput.value = tool?.title || '';
  setCodeValue('html', tool?.html || defaultHtml());
  setCodeValue('css', tool?.css || defaultCss());
  setCodeValue('js', tool?.js || defaultJs());
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
    const row = createElement('article', {
      className: `tool-list-row ${tool.id === selectedToolId ? 'active' : ''}`
    });

    const button = createElement('button', {
      className: `tool-list-item ${tool.id === selectedToolId ? 'active' : ''}`,
      text: tool.title || tool.id,
      attributes: {
        type: 'button',
        'data-tool-id': tool.id
      }
    });

    const deleteButton = createElement('button', {
      className: 'tool-delete-button danger-button',
      text: '-',
      attributes: {
        type: 'button',
        title: `Borrar ${tool.title || tool.id}`,
        'aria-label': `Borrar ${tool.title || tool.id}`,
        'data-delete-tool-id': tool.id
      }
    });

    row.appendChild(button);
    row.appendChild(deleteButton);
    toolList.appendChild(row);
  });
}

function renderVariableList() {
  variableList.innerHTML = '';

  const groups = groupedVariablePaths();
  if (!groups.length) {
    variableList.appendChild(createElement('p', {
      className: 'empty-copy',
      text: variableSearchTerm ? 'No hay variables que coincidan.' : 'No hay variables disponibles.'
    }));
    return;
  }

  groups.forEach((group) => {
    const groupElement = createElement('section', { className: 'variable-scope-group' });
    groupElement.appendChild(createElement('h3', { text: group.scope }));

    group.variables.forEach(({ path, variable, value }) => {
      const row = createElement('article', { className: 'variable-chip' });
      row.appendChild(createElement('strong', { text: variable }));
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
      groupElement.appendChild(row);
    });

    variableList.appendChild(groupElement);
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
  initializeNinaComponents(body, createNinaApi());
  runToolScript(body, toolDefinition);
}

function initializeNinaComponents(toolElement, ninaApi) {
  toolElement.querySelectorAll('nina-graph[path]').forEach((graph) => {
    renderNinaGraph(graph, ninaApi);
  });
}

function graphPointsFromElement(graph) {
  const rawPoints = graph.getAttribute('points') || graph.getAttribute('max-points') || '80';
  const points = Number.parseInt(rawPoints, 10);
  return Number.isFinite(points) ? Math.max(2, Math.min(points, 10000)) : 80;
}

function renderNinaGraph(graph, ninaApi) {
  const path = graph.getAttribute('path');
  const points = graphPointsFromElement(graph);
  const series = ninaApi.history(path).slice(-points);

  graph.classList.add('nina-graph');
  ninaApi.trackHistory(path, points);

  if (!series.length) {
    graph.innerHTML = `
      <div class="nina-graph-header">
        <strong>${escapeHtml(path)}</strong>
        <span>Sin datos</span>
      </div>
      <div class="nina-graph-empty">Esperando actualizaciones numéricas...</div>
    `;
    return;
  }

  const values = series.map((point) => Number(point.v)).filter((value) => Number.isFinite(value));
  if (!values.length) {
    graph.innerHTML = `
      <div class="nina-graph-header">
        <strong>${escapeHtml(path)}</strong>
        <span>Sin datos numéricos</span>
      </div>
    `;
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lastValue = values[values.length - 1];
  const polyline = values.map((value, index) => {
    const x = values.length === 1 ? 100 : (index / (values.length - 1)) * 100;
    const y = 38 - ((value - min) / span) * 34;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  graph.innerHTML = `
    <div class="nina-graph-header">
      <strong>${escapeHtml(path)}</strong>
      <span>${escapeHtml(formatGraphValue(lastValue))}</span>
    </div>
    <svg class="nina-graph-canvas" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="38" x2="100" y2="38"></line>
      <polyline points="${polyline}"></polyline>
    </svg>
    <div class="nina-graph-footer">
      <span>min ${escapeHtml(formatGraphValue(min))}</span>
      <span>${values.length}/${points}</span>
      <span>max ${escapeHtml(formatGraphValue(max))}</span>
    </div>
  `;
}

function formatGraphValue(value) {
  if (!Number.isFinite(Number(value))) return 'null';
  return Number(value).toLocaleString('es-MX', {
    maximumFractionDigits: 3
  });
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
    history(path) {
      return Array.isArray(historyState?.series?.[path]) ? historyState.series[path] : [];
    },
    trackHistory: sendTrackHistory,
    paths: allVariablePaths
  };
}

function showEditor() {
  editorWorkspace.classList.add('active');
  toolWorkspace.classList.remove('active');
  if (location.search) {
    history.replaceState(null, '', '/tools');
  }
}

function showTool(toolId) {
  runtimeToolId = toolId;
  editorWorkspace.classList.remove('active');
  toolWorkspace.classList.add('active');
  renderRuntime();

  const nextUrl = `/tools?tool=${encodeURIComponent(toolId)}`;
  if (`${location.pathname}${location.search}` !== nextUrl) {
    history.replaceState(null, '', nextUrl);
  }
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

  if (initialRuntimeToolId && tools.some((tool) => tool.id === initialRuntimeToolId)) {
    runtimeToolId = initialRuntimeToolId;
    initialRuntimeToolId = null;
    showTool(runtimeToolId);
  }

  renderToolList();
  renderVariableList();
  renderRuntime();
}

function setActionsEnabled(enabled) {
  actionsEnabled = enabled;
  saveButton.disabled = !enabled;
  exportButton.disabled = !enabled;
  newButton.disabled = !enabled;

  if (editorStatus && !enabled) {
    editorStatus.textContent = 'Sin conexión';
  }
}

function saveCurrentTool() {
  if (socket?.readyState !== WebSocket.OPEN) {
    if (editorStatus) editorStatus.textContent = 'No conectado';
    return;
  }

  if (!selectedToolId) {
    selectedToolId = createToolId(titleInput.value);
  }

  pendingSavedToolId = selectedToolId;
  if (editorStatus) editorStatus.textContent = 'Guardando...';

  socket.send(JSON.stringify({
    type: 'save_tool',
    tool_id: selectedToolId,
    title: titleInput.value,
    html: getCodeValue('html'),
    css: getCodeValue('css'),
    js: getCodeValue('js'),
    enabled: true
  }));
}

function exportCurrentTool() {
  const title = titleInput.value.trim() || selectedTool()?.title || 'NINA Tool';
  const fileName = `${createExportFileName(title)}.html`;
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
${getCodeValue('css')}
  </style>
</head>
<body>
${getCodeValue('html')}
  <script>
${getCodeValue('js')}
  <\/script>
</body>
</html>
`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function createExportFileName(title) {
  return String(title || 'nina_tool')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'nina_tool';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

function deleteToolById(toolId) {
  const tool = tools.find((candidate) => candidate.id === toolId);
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
  insertCodeText('html', `\n<span id="${elementId}"></span>`);
  insertCodeText('js', `\nNINA.on("${path}", (value) => {\n  tool.querySelector("#${elementId}").textContent = value ?? "null";\n});\n`);
}

function insertToggleSnippet(path) {
  const elementId = safeIdFromPath(path, 'toggle');
  insertCodeText('html', `\n<button id="${elementId}" type="button">Toggle ${path}</button>`);
  insertCodeText('js', `\ntool.querySelector("#${elementId}").addEventListener("click", () => {\n  NINA.toggle("${path}");\n});\n`);
}

function promptVariablePath() {
  const fallback = allVariablePaths()[0] || 'global.testing';
  const path = window.prompt('Variable path', fallback);
  return parsePath(path) ? path : null;
}

function insertIndicatorComponent(path) {
  insertCodeText('html', `\n<span class="nina-indicator" data-path="${path}">${path}</span>`);
  insertCodeText('js', `\nNINA.on("${path}", (value) => {\n  const indicator = tool.querySelector('[data-path="${path}"]');\n  indicator.textContent = value ? "Encendido" : "Apagado";\n  indicator.dataset.active = Boolean(value);\n});\n`);
}

function insertValueComponent(path) {
  insertCodeText('html', `\n<span class="nina-value" data-path="${path}"></span>`);
  insertCodeText('js', `\nNINA.on("${path}", (value) => {\n  tool.querySelector('[data-path="${path}"]').textContent = value ?? "null";\n});\n`);
}

function insertToggleComponent(path) {
  insertCodeText('html', `\n<button class="nina-toggle" data-path="${path}" type="button">Toggle ${path}</button>`);
  insertCodeText('js', `\ntool.querySelector('[data-path="${path}"]').addEventListener("click", () => {\n  NINA.toggle("${path}");\n});\n`);
}

function insertGraphComponent(path) {
  insertCodeText('html', `\n<nina-graph path="${path}" points="80"></nina-graph>`);
}

function insertComponentSnippet(componentName) {
  const path = promptVariablePath();
  if (!path) return;

  if (componentName === 'indicator') insertIndicatorComponent(path);
  if (componentName === 'value') insertValueComponent(path);
  if (componentName === 'toggle') insertToggleComponent(path);
  if (componentName === 'graph') insertGraphComponent(path);

  switchTab('html');
  showEditor();
}

function switchTab(tabName) {
  activeTab = tabName;
  codePanel.dataset.activeCode = tabName;

  tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.codeTab === tabName);
  });

  Object.entries(editors).forEach(([name, editor]) => {
    editor.classList.toggle('active', name === tabName);
    codeEditors[name]?.setActive(name === tabName);
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

  setActionsEnabled(false);

  socket.addEventListener('open', () => {
    registerClient();
  });

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);

    if (message.type !== 'state') return;

    scopes = message.scopes || {};
    historyState = message.history || { tracked: {}, series: {} };
    tools = Array.isArray(message.tools?.tools) ? message.tools.tools : [];

    if (pendingSavedToolId && tools.some((tool) => tool.id === pendingSavedToolId)) {
      pendingSavedToolId = null;
      if (editorStatus) editorStatus.textContent = 'Guardado';
    } else if (editorStatus) {
      editorStatus.textContent = 'Conectado';
    }

    if (selectedToolId && !tools.some((tool) => tool.id === selectedToolId)) {
      selectedToolId = tools[0]?.id ?? null;
      setEditorValue(selectedTool());
    }

    setActionsEnabled(true);
    renderAll();
  });

  socket.addEventListener('close', () => {
    setActionsEnabled(false);
    reconnectTimer = setTimeout(connect, 2000);
  });

  socket.addEventListener('error', () => socket.close());
}

toolList.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete-tool-id]');
  if (deleteButton) {
    event.stopPropagation();
    deleteToolById(deleteButton.dataset.deleteToolId);
    return;
  }

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

newButton.addEventListener('click', () => {
  selectedToolId = null;
  setEditorValue(null);
  renderToolList();
  showEditor();
});

saveButton.addEventListener('click', saveCurrentTool);
exportButton.addEventListener('click', exportCurrentTool);

variableSearch.addEventListener('input', () => {
  variableSearchTerm = variableSearch.value;
  renderVariableList();
});

document.querySelectorAll('[data-component]').forEach((button) => {
  button.addEventListener('click', () => insertComponentSnippet(button.dataset.component));
});

document.addEventListener('click', (event) => {
  const currentMenu = event.target.closest('details');

  document.querySelectorAll('details[open]').forEach((menu) => {
    if (menu === currentMenu) return;
    menu.open = false;
  });
});

initializeCodeEditors();
setEditorValue(null);
switchTab('html');
showEditor();
connect();
