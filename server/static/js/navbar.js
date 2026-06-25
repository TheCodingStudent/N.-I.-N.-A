const navbarRoot = document.querySelector('#navbar-root');

if (navbarRoot) {
  navbarRoot.innerHTML = `
    <nav class="app-navbar" aria-label="Navegacion principal">
      <a class="brand" href="/">
        <span>N. I. N. A</span>
      </a>
      <div class="nav-links">
        <a href="/">CORE</a>
        <a href="/tools">EDITOR</a>
        <a href="/docs">DOCS</a>
        <details class="nav-tool-menu">
          <summary>TOOLS</summary>
          <div id="nav-tool-list" class="nav-tool-list">
            <span>Sin tools</span>
          </div>
        </details>
      </div>
    </nav>
  `;

  const toolList = navbarRoot.querySelector('#nav-tool-list');

  fetch('/api/tools', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : { tools: [] })
    .then((data) => {
      const tools = Array.isArray(data.tools) ? data.tools : [];
      toolList.innerHTML = '';

      if (!tools.length) {
        const empty = document.createElement('span');
        empty.textContent = 'Sin tools';
        toolList.appendChild(empty);
        return;
      }

      tools.forEach((tool) => {
        const link = document.createElement('a');
        link.href = `/tools?tool=${encodeURIComponent(tool.id)}`;
        link.textContent = tool.title || tool.id;
        toolList.appendChild(link);
      });
    })
    .catch(() => {
      toolList.innerHTML = '<span>Sin conexión</span>';
    });
}
