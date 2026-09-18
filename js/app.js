document.addEventListener('DOMContentLoaded', async () => {
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

  const supabase = window.sigloSupabase;
  const isLoginPage = document.body.dataset.page === 'login';
  const form = document.getElementById('loginForm');
  const email = document.getElementById('email');
  const error = document.getElementById('loginError');
  const authParams = new URLSearchParams(window.location.search);
  const authErrorCode = authParams.get('error_code');
  if (isLoginPage && error && authErrorCode === 'otp_expired') {
    error.textContent = 'Ese enlace de confirmación ya fue usado o expiró. Intenta iniciar sesión normalmente.';
  }

  const setLoginBusy = (busy) => {
    const submit = form?.querySelector('button[type="submit"]');
    const create = document.getElementById('createAccess');
    if (submit) submit.disabled = busy;
    if (create) create.disabled = busy;
  };

  const rememberEmail = () => {
    const value = email?.value.trim() || '';
    if (document.getElementById('remember')?.checked && value) {
      localStorage.setItem('siglo_remember', value);
    } else {
      localStorage.removeItem('siglo_remember');
    }
  };

  if (!supabase) {
    if (error) error.textContent = 'No fue posible conectar con el servicio de autenticación.';
  } else if (!isLoginPage) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.replace('index.html');
      return;
    }
    localStorage.setItem('siglo_user', session.user.email || 'Usuario SIGLO');
  }

  if (form && supabase) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';

      const correo = email.value.trim();
      const clave = password.value.trim();
      if (!correo || !clave) {
        error.textContent = 'Ingresa tu correo y contraseña.';
        return;
      }

      setLoginBusy(true);
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: correo,
        password: clave
      });
      setLoginBusy(false);

      if (authError || !data.session) {
        error.textContent = authError?.message === 'Invalid login credentials'
          ? 'Correo o contraseña incorrectos.'
          : (authError?.message || 'No fue posible iniciar sesión.');
        return;
      }

      rememberEmail();
      localStorage.setItem('siglo_user', data.user?.email || correo);
      window.location.href = 'inicio.html';
    });
  }

  document.getElementById('createAccess')?.addEventListener('click', async () => {
    if (!supabase) return;

    error.textContent = '';
    const correo = email?.value.trim() || '';
    const clave = password?.value.trim() || '';

    if (!correo || !clave) {
      error.textContent = 'Escribe el correo y una contraseña para crear el acceso.';
      return;
    }
    if (clave.length < 6) {
      error.textContent = 'La contraseña debe tener al menos 6 caracteres.';
      return;
    }

    setLoginBusy(true);
    const emailRedirectTo = 'https://eyamayai.github.io/SIGLO/index.html';
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: correo,
      password: clave,
      options: { emailRedirectTo }
    });
    setLoginBusy(false);

    if (signUpError) {
      error.textContent = signUpError.message || 'No fue posible crear el acceso.';
      return;
    }

    rememberEmail();

    if (data.session) {
      localStorage.setItem('siglo_user', data.user?.email || correo);
      window.location.href = 'inicio.html';
      return;
    }

    error.textContent = 'Acceso creado. Revisa tu correo y confirma la cuenta antes de ingresar.';
  });

  const remembered = localStorage.getItem('siglo_remember');
  if (remembered && email) {
    email.value = remembered;
    const remember = document.getElementById('remember');
    if (remember) remember.checked = true;
  }

  document.getElementById('forgotPassword')?.addEventListener('click', async () => {
    if (!supabase) return;
    const correo = email?.value.trim() || '';
    if (!correo) {
      error.textContent = 'Escribe primero tu correo corporativo.';
      return;
    }

    const redirectTo = 'https://eyamayai.github.io/SIGLO/index.html';
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(correo, { redirectTo });
    if (resetError) {
      error.textContent = resetError.message || 'No fue posible enviar la recuperación.';
      return;
    }
    showToast('Enviamos las instrucciones de recuperación a tu correo.');
  });

  const userLabel = document.getElementById('userLabel');
  if (userLabel) {
    const { data: { session } } = supabase
      ? await supabase.auth.getSession()
      : { data: { session: null } };
    const user = session?.user?.email || localStorage.getItem('siglo_user') || 'Usuario SIGLO';
    userLabel.textContent = user.includes('@') ? user.split('@')[0] : user;
  }

  document.getElementById('logoutBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (supabase) await supabase.auth.signOut();
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
