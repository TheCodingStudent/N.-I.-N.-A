const navbarRoot = document.querySelector('#navbar-root');

if (navbarRoot) {
  navbarRoot.innerHTML = `
    <nav class="app-navbar" aria-label="Navegación principal">
      <a class="brand" href="/">
        <span class="brand-orb" aria-hidden="true"></span>
        <span>N. I. N. A</span>
      </a>
      <div class="nav-links">
        <a href="/" aria-current="page">Scopes</a>
        <a href="#" aria-disabled="true">Dashboard</a>
        <a href="#" aria-disabled="true">Eventos</a>
      </div>
    </nav>
  `;
}
