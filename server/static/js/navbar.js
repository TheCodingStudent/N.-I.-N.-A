const navbarRoot = document.querySelector('#navbar-root');

if (navbarRoot) {
  navbarRoot.innerHTML = `
    <nav class="app-navbar" aria-label="Navegacion principal">
      <a class="brand" href="/">
        <span class="brand-label">N. I. N. A</span>
        <span class="brand-icon" aria-hidden="true">N.I.N.A</span>
      </a>
      <div class="nav-links">
        <a href="/" title="CORE">
          <span class="nav-label">CORE</span>
          <span class="nav-icon" aria-hidden="true">●</span>
        </a>
        <a href="/tools" title="EDITOR">
          <span class="nav-label">EDITOR</span>
          <span class="nav-icon" aria-hidden="true">✎</span>
        </a>
        <a href="/docs" title="DOCS">
          <span class="nav-label">DOCS</span>
          <span class="nav-icon" aria-hidden="true">≡</span>
        </a>
        <details class="nav-tool-menu">
          <summary title="TOOLS">
            <span class="nav-label">TOOLS</span>
            <span class="nav-icon" aria-hidden="true">▾</span>
          </summary>
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
  document.addEventListener('click', (event) => {
    const currentMenu = event.target.closest('details');

    document.querySelectorAll('details[open]').forEach((menu) => {
      if (menu === currentMenu) return;
      menu.open = false;
    });
  });
}
