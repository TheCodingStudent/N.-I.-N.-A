const navbarRoot = document.querySelector('#navbar-root');

if (navbarRoot) {
  navbarRoot.innerHTML = `
    <nav class="app-navbar" aria-label="Navegacion principal">
      <a class="brand" href="/">
        <span class="brand-mark" aria-hidden="true">Shaparro</span>
        <span>N. I. N. A</span>
      </a>
      <div class="nav-meta" aria-hidden="true">
        <span>3.19 GHz</span>
        <span>NET</span>
        <span>LOCAL</span>
      </div>
    </nav>
  `;
}
