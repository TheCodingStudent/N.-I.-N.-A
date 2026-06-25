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
      </div>
    </nav>
  `;
}
