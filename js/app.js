document.addEventListener('DOMContentLoaded', async () => {
  const assetVersion = '20260922-7';

  const assetStyle = document.createElement('style');
  assetStyle.textContent =
    '.brand-panel::before {' +
    'background-image:linear-gradient(180deg,rgba(249,252,255,.98) 0%,rgba(249,252,255,.95) 31%,rgba(246,251,255,.74) 51%,rgba(231,241,249,.14) 74%,rgba(222,236,247,.05) 100%),url("assets/login-wallpaper.png?v=' + assetVersion + '") !important;' +
    'background-position:center,center bottom !important;' +
    'background-size:cover,cover !important;' +
    'background-repeat:no-repeat !important;' +
    '}';
  document.head.appendChild(assetStyle);

  const brandLogo = document.querySelector('.brand-logo');
  if (brandLogo) {
    if (brandLogo.tagName === 'OBJECT') brandLogo.setAttribute('data', 'assets/logo-siglo.png?v=' + assetVersion);
    else brandLogo.setAttribute('src', 'assets/logo-siglo.png?v=' + assetVersion);
  }

  document.querySelectorAll('img[src*="icono-siglo.svg"]').forEach((img) => {
    img.src = 'assets/icono-siglo.png?v=' + assetVersion;
  });

  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) {
    favicon.type = 'image/png';
    favicon.href = 'assets/icono-siglo.png?v=' + assetVersion;
  }

  const toast = document.getElementById('toast');
  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  };
  window.sigloShowToast = showToast;

  const supabase = window.sigloSupabase;
  const isLoginPage = document.body.dataset.page === 'login';
  const form = document.getElementById('loginForm');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const error = document.getElementById('loginError');
  const passwordSetupForm = document.getElementById('passwordSetupForm');
  const passwordSetupError = document.getElementById('passwordSetupError');
  const authParams = new URLSearchParams(window.location.search);
  const authFlowType = String(window.sigloAuthFlowType || '').toLowerCase();
  const authSetupRequested = authParams.get('auth') === 'setup';

  const toggle = document.getElementById('togglePassword');
  if (toggle && password) {
    toggle.addEventListener('click', () => {
      const visible = password.type === 'text';
      password.type = visible ? 'password' : 'text';
      toggle.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
    });
  }

  function auditAccess(permisos = {}) {
    return [
      'auditoria_carga',
      'auditoria_tecnicos',
      'auditoria_codigos',
      'auditoria_documentos'
    ].some(key => permisos?.[key] === true);
  }

  function permissionForHref(href) {
    const path = String(href || '').split('?')[0].split('#')[0].split('/').pop();
    const map = {
      'ingresos.html':'ingresos',
      'despachos.html':'despachos',
      'salidas.html':'salidas',
      'devoluciones.html':'devoluciones',
      'desmonte.html':'desmonte',
      'prealerta.html':'prealerta',
      'saldos.html':'saldos',
      'movimientos.html':'movimientos',
      'informes.html':'informes',
      'auditoria-carga-inicial.html':'auditoria_carga',
      'auditoria-tecnicos.html':'auditoria_tecnicos',
      'auditoria-codigos.html':'auditoria_codigos',
      'auditoria-documentos.html':'auditoria_documentos',
      'auditoria-usuarios.html':'auditoria_usuarios'
    };
    return map[path] || null;
  }

  function canAccess(profile, permission) {
    if (!profile || profile.estado !== 'ACTIVO') return false;
    if (profile.rol === 'ADMINISTRADOR') return true;
    if (!permission) return true;
    if (permission === 'auditoria_usuarios') return false;
    return profile.permisos?.[permission] === true;
  }

  function applyProfileToUi(profile) {
    window.sigloCurrentUser = profile;
    document.body.dataset.sigloUserReady = 'true';

    const username = profile.username || profile.nombre || 'Usuario SIGLO';
    document.querySelectorAll('#userLabel').forEach(el => { el.textContent = username; });
    document.querySelectorAll('.user-avatar').forEach(el => {
      el.textContent = String(username).trim().charAt(0).toUpperCase() || 'S';
    });

    document.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href') || '';
      const file = href.split('?')[0].split('#')[0].split('/').pop();

      if (file === 'auditoria.html') {
        if (profile.rol !== 'ADMINISTRADOR' && !auditAccess(profile.permisos)) link.hidden = true;
        return;
      }

      const permission = permissionForHref(href);
      if (permission && !canAccess(profile, permission)) link.hidden = true;
    });

    document.dispatchEvent(new CustomEvent('siglo:user-ready', { detail: profile }));
  }

  async function loadCurrentProfile() {
    const { data, error: profileError } = await supabase.rpc('consultar_mi_usuario');
    if (profileError) throw profileError;
    return data || null;
  }

  async function validateAuthenticatedUser() {
    const profile = await loadCurrentProfile();
    if (!profile?.registrado) {
      await supabase.auth.signOut();
      window.location.replace('index.html?access=unregistered');
      return null;
    }
    if (profile.estado !== 'ACTIVO') {
      await supabase.auth.signOut();
      window.location.replace('index.html?access=inactive');
      return null;
    }
    return profile;
  }

  function currentPageAllowed(profile) {
    const file = (window.location.pathname.split('/').pop() || 'inicio.html').toLowerCase();
    if (file === 'inicio.html' || file === '') return true;
    if (file === 'auditoria.html') return profile.rol === 'ADMINISTRADOR' || auditAccess(profile.permisos);
    const permission = permissionForHref(file);
    return permission ? canAccess(profile, permission) : true;
  }

  function setLoginBusy(busy) {
    const submit = form?.querySelector('button[type="submit"]');
    if (submit) submit.disabled = busy;
  }

  function rememberEmail() {
    const value = email?.value.trim() || '';
    if (document.getElementById('remember')?.checked && value) localStorage.setItem('siglo_remember', value);
    else localStorage.removeItem('siglo_remember');
  }

  async function showPasswordSetup(session) {
    if (!form || !passwordSetupForm) return;
    form.hidden = true;
    passwordSetupForm.hidden = false;

    const title = document.getElementById('passwordSetupTitle');
    const help = document.getElementById('passwordSetupHelp');
    if (authFlowType === 'recovery') {
      if (title) title.textContent = 'Crea una nueva contraseña';
      if (help) help.textContent = 'Define la nueva contraseña de tu cuenta SIGLO.';
    } else {
      if (title) title.textContent = 'Activa tu acceso a SIGLO';
      if (help) help.textContent = 'Crea tu contraseña para ' + (session?.user?.email || 'tu cuenta') + '.';
    }
  }

  if (!supabase) {
    if (error) error.textContent = 'No fue posible conectar con el servicio de autenticación.';
    return;
  }

  if (isLoginPage) {
    if (error) {
      if (authParams.get('error_code') === 'otp_expired') {
        error.textContent = 'Ese enlace ya fue usado o expiró. Solicita uno nuevo.';
      } else if (authParams.get('access') === 'inactive') {
        error.textContent = 'Tu usuario está inactivo en SIGLO. Contacta al Administrador.';
      } else if (authParams.get('access') === 'unregistered') {
        error.textContent = 'Tu correo no está autorizado en Usuarios de SIGLO.';
      } else if (authParams.get('access') === 'denied') {
        error.textContent = 'No tienes permiso para acceder a ese módulo.';
      }
    }

    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
      try {
        const profile = await loadCurrentProfile();
        if (!profile?.registrado) {
          await supabase.auth.signOut();
          if (error) error.textContent = 'Tu correo no está autorizado en Usuarios de SIGLO.';
        } else if (profile.estado !== 'ACTIVO') {
          await supabase.auth.signOut();
          if (error) error.textContent = 'Tu usuario está inactivo en SIGLO. Contacta al Administrador.';
        } else if (
          profile.acceso_configurado !== true ||
          authFlowType === 'invite' ||
          authFlowType === 'recovery' ||
          authSetupRequested
        ) {
          await showPasswordSetup(session);
        } else {
          window.location.replace('inicio.html');
          return;
        }
      } catch (_) {
        await supabase.auth.signOut();
      }
    }
  } else {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.replace('index.html');
      return;
    }

    try {
      const profile = await validateAuthenticatedUser();
      if (!profile) return;

      if (!currentPageAllowed(profile)) {
        window.location.replace('inicio.html?access=denied');
        return;
      }

      localStorage.setItem('siglo_user', profile.username || profile.correo || 'Usuario SIGLO');
      applyProfileToUi(profile);
    } catch (profileError) {
      console.error('Error validando usuario SIGLO', profileError);
      await supabase.auth.signOut();
      window.location.replace('index.html?access=unregistered');
      return;
    }
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (error) error.textContent = '';

      const correo = email?.value.trim() || '';
      const clave = password?.value || '';
      if (!correo || !clave) {
        if (error) error.textContent = 'Ingresa tu correo y contraseña.';
        return;
      }

      setLoginBusy(true);
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: correo,
        password: clave
      });
      setLoginBusy(false);

      if (authError || !data.session) {
        if (error) {
          error.textContent = authError?.message === 'Invalid login credentials'
            ? 'Correo o contraseña incorrectos.'
            : (authError?.message || 'No fue posible iniciar sesión.');
        }
        return;
      }

      try {
        const profile = await loadCurrentProfile();
        if (!profile?.registrado) {
          await supabase.auth.signOut();
          if (error) error.textContent = 'Tu correo no está autorizado en Usuarios de SIGLO.';
          return;
        }
        if (profile.estado !== 'ACTIVO') {
          await supabase.auth.signOut();
          if (error) error.textContent = 'Tu usuario está inactivo en SIGLO.';
          return;
        }

        rememberEmail();
        localStorage.setItem('siglo_user', profile.username || correo);
        window.location.href = 'inicio.html';
      } catch (profileError) {
        console.error(profileError);
        await supabase.auth.signOut();
        if (error) error.textContent = 'No fue posible validar los permisos de tu usuario.';
      }
    });
  }

  if (passwordSetupForm) {
    passwordSetupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (passwordSetupError) passwordSetupError.textContent = '';

      const newPassword = document.getElementById('newPassword')?.value || '';
      const confirmPassword = document.getElementById('confirmPassword')?.value || '';
      if (newPassword.length < 8) {
        if (passwordSetupError) passwordSetupError.textContent = 'La contraseña debe tener al menos 8 caracteres.';
        return;
      }
      if (newPassword !== confirmPassword) {
        if (passwordSetupError) passwordSetupError.textContent = 'Las contraseñas no coinciden.';
        return;
      }

      const button = passwordSetupForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        if (button) button.disabled = false;
        if (passwordSetupError) passwordSetupError.textContent = updateError.message || 'No fue posible guardar la contraseña.';
        return;
      }

      const { error: confirmAccessError } = await supabase.rpc('confirmar_acceso_usuario');
      if (confirmAccessError) {
        if (button) button.disabled = false;
        if (passwordSetupError) passwordSetupError.textContent = confirmAccessError.message || 'La contraseña fue guardada, pero SIGLO no pudo confirmar el acceso.';
        return;
      }

      try {
        const profile = await loadCurrentProfile();
        if (!profile?.registrado || profile.estado !== 'ACTIVO') {
          await supabase.auth.signOut();
          window.location.replace('index.html?access=unregistered');
          return;
        }
      } catch (_) {
        await supabase.auth.signOut();
        window.location.replace('index.html?access=unregistered');
        return;
      }

      history.replaceState({}, document.title, 'index.html');
      window.location.href = 'inicio.html';
    });
  }

  const remembered = localStorage.getItem('siglo_remember');
  if (remembered && email) {
    email.value = remembered;
    const remember = document.getElementById('remember');
    if (remember) remember.checked = true;
  }

  document.getElementById('forgotPassword')?.addEventListener('click', async () => {
    if (error) error.textContent = '';
    const correo = email?.value.trim() || '';
    if (!correo) {
      if (error) error.textContent = 'Escribe primero tu correo corporativo.';
      return;
    }

    const redirectTo = 'https://eyamayai.github.io/SIGLO/index.html?auth=setup';
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(correo, { redirectTo });
    if (resetError) {
      if (error) {
        const raw=String(resetError.message||'');
        error.textContent=/rate limit/i.test(raw)
          ? 'Se alcanzó temporalmente el límite de correos de Supabase. Espera a que se libere el cupo o solicita al Administrador un enlace de acceso.'
          : (raw || 'No fue posible enviar la recuperación.');
      }
      return;
    }
    showToast('Enviamos las instrucciones de recuperación a tu correo.');
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await supabase.auth.signOut();
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
