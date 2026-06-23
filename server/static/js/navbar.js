const navbarRoot = document.querySelector('#navbar-root');

if (navbarRoot) {
  navbarRoot.innerHTML = `
    <nav class="app-navbar" aria-label="Navegacion principal">
      <a class="brand" href="/">
        <span class="brand-mark" aria-hidden="true">STARK</span>
        <span>N. I. N. A</span>
      </a>
      <div class="nav-status" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </nav>
  `;
}
