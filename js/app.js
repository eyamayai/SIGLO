document.addEventListener('DOMContentLoaded', () => {
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
