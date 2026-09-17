document.addEventListener('DOMContentLoaded', () => {
  // Recursos visuales oficiales de SIGLO.
  // Se fuerzan con versionado en la URL para evitar que GitHub Pages o el navegador
  // sigan mostrando una copia antigua después de reemplazar las imágenes.
  const assetVersion = '20260917-2';

  const assetStyle = document.createElement('style');
  assetStyle.textContent = `
    .brand-panel::before {
      background-image:
        linear-gradient(180deg,rgba(249,252,255,.98) 0%,rgba(249,252,255,.95) 31%,rgba(246,251,255,.74) 51%,rgba(231,241,249,.14) 74%,rgba(222,236,247,.05) 100%),
        url("assets/login-wallpaper.png?v=${assetVersion}") !important;
      background-position: center, center bottom !important;
      background-size: cover, cover !important;
      background-repeat: no-repeat !important;
    }
  `;
  document.head.appendChild(assetStyle);

  const brandLogo = document.querySelector('.brand-logo');
  if (brandLogo) {
    if (brandLogo.tagName === 'OBJECT') {
      brandLogo.setAttribute('data', `assets/logo-siglo.png?v=${assetVersion}`);
    } else {
      brandLogo.setAttribute('src', `assets/logo-siglo.png?v=${assetVersion}`);
    }
  }

  document.querySelectorAll('img[src*="icono-siglo.svg"]').forEach((img) => {
    img.src = `assets/icono-siglo.png?v=${assetVersion}`;
  });

  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) {
    favicon.type = 'image/png';
    favicon.href = `assets/icono-siglo.png?v=${assetVersion}`;
  }

  const toast = document.getElementById('toast');
  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  };

  const toggle = document.getElementById('togglePassword');
  const password = document.getElementById('password');
  if (toggle && password) {
    toggle.addEventListener('click', () => {
      const visible = password.type === 'text';
      password.type = visible ? 'password' : 'text';
      toggle.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
    });
  }

  const form = document.getElementById('loginForm');
  const email = document.getElementById('email');
  const error = document.getElementById('loginError');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!email.value.trim() || !password.value.trim()) {
        error.textContent = 'Ingresa tu correo y contraseña.';
        return;
      }
      localStorage.setItem('siglo_user', email.value.trim());
      if (document.getElementById('remember')?.checked) {
        localStorage.setItem('siglo_remember', email.value.trim());
      } else {
        localStorage.removeItem('siglo_remember');
      }
      window.location.href = 'inicio.html';
    });
  }

  const remembered = localStorage.getItem('siglo_remember');
  if (remembered && email) {
    email.value = remembered;
    const remember = document.getElementById('remember');
    if (remember) remember.checked = true;
  }

  document.getElementById('forgotPassword')?.addEventListener('click', () => {
    showToast('La recuperación de contraseña se habilitará más adelante.');
  });

  document.getElementById('quickAccess')?.addEventListener('click', () => {
    localStorage.setItem('siglo_user', 'Acceso Material Libre');
    window.location.href = 'inicio.html';
  });

  const userLabel = document.getElementById('userLabel');
  if (userLabel) {
    const user = localStorage.getItem('siglo_user') || 'Usuario SIGLO';
    userLabel.textContent = user.includes('@') ? user.split('@')[0] : user;
  }

  document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('siglo_user');
    window.location.href = 'index.html';
  });

  document.querySelectorAll('[data-coming-soon]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('Este módulo será construido en la siguiente etapa.');
    });
  });
});
