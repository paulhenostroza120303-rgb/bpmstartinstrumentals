const HELPER_URL = 'https://bpmstartinstrumentals-production.up.railway.app';

// DOM elements
const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const pendingView = document.getElementById('pending-view');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const formLogin = document.getElementById('form-login');
const formRegister = document.getElementById('form-register');
const authError = document.getElementById('auth-error');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const registerEmail = document.getElementById('register-email');
const registerPassword = document.getElementById('register-password');
const registerConfirm = document.getElementById('register-confirm');
const btnLogin = document.getElementById('btn-login');
const btnRegister = document.getElementById('btn-register');
const btnLogout = document.getElementById('btn-logout');
const btnLogoutPending = document.getElementById('btn-logout-pending');
const userEmail = document.getElementById('user-email');
const pendingEmail = document.getElementById('pending-email');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statusDetail = document.getElementById('status-detail');
const toast = document.getElementById('toast');
const btnReset = document.getElementById('btn-reset');

function showAuth() {
  authView.classList.remove('hidden');
  appView.classList.add('hidden');
  pendingView.classList.add('hidden');
}

function showApp(email) {
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  pendingView.classList.add('hidden');
  userEmail.textContent = email || '';
}

function showPending(email) {
  authView.classList.add('hidden');
  appView.classList.add('hidden');
  pendingView.classList.remove('hidden');
  pendingEmail.textContent = email || '';
}

function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.add('show');
}

function hideAuthError() {
  authError.classList.remove('show');
}

async function initializePopup() {
  const result = await chrome.storage.sync.get(['auth_token', 'auth_email']);

  if (result.auth_token) {
    try {
      const res = await fetch(`${HELPER_URL}/verify`, {
        headers: { 'Authorization': `Bearer ${result.auth_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.approved) {
          showApp(data.email);
          updateStatus();
          return;
        } else {
          showPending(data.email);
          return;
        }
      }
    } catch (e) { /* token invalid */ }
    await chrome.storage.sync.remove(['auth_token', 'auth_email']);
  }

  showAuth();
}

// ============================================================
// AUTH TABS
// ============================================================

tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  formLogin.classList.add('active');
  formRegister.classList.remove('active');
  hideAuthError();
});

tabRegister.addEventListener('click', () => {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  formRegister.classList.add('active');
  formLogin.classList.remove('active');
  hideAuthError();
});

// ============================================================
// LOGIN
// ============================================================

btnLogin.addEventListener('click', async () => {
  hideAuthError();
  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email || !password) {
    showAuthError('Ingresa email y password');
    return;
  }

  btnLogin.disabled = true;
  btnLogin.textContent = 'Ingresando...';

  try {
    const res = await fetch(`${HELPER_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!data.success) {
      showAuthError(data.error || 'Error al iniciar sesion');
      return;
    }

    await chrome.storage.sync.set({
      auth_token: data.token,
      auth_email: data.email,
    });

    if (data.approved) {
      showApp(data.email);
      showToast('Sesion iniciada');
      updateStatus();
    } else {
      showPending(data.email);
      showToast('Cuenta pendiente de aprobacion');
    }
  } catch (e) {
    showAuthError('Error de conexion con el servidor');
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = 'Iniciar Sesion';
  }
});

// ============================================================
// REGISTER
// ============================================================

btnRegister.addEventListener('click', async () => {
  hideAuthError();
  const email = registerEmail.value.trim();
  const password = registerPassword.value;
  const confirm = registerConfirm.value;

  if (!email || !password || !confirm) {
    showAuthError('Completa todos los campos');
    return;
  }

  if (password.length < 6) {
    showAuthError('Password minimo 6 caracteres');
    return;
  }

  if (password !== confirm) {
    showAuthError('Los passwords no coinciden');
    return;
  }

  btnRegister.disabled = true;
  btnRegister.textContent = 'Creando cuenta...';

  try {
    const res = await fetch(`${HELPER_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!data.success) {
      showAuthError(data.error || 'Error al registrar');
      return;
    }

    await chrome.storage.sync.set({
      auth_token: data.token,
      auth_email: data.email,
    });

    if (data.approved) {
      showApp(data.email);
      showToast('Cuenta creada!');
    } else {
      showPending(data.email);
      showToast('Cuenta creada. Espera aprobacion del admin.');
    }
  } catch (e) {
    showAuthError('Error de conexion con el servidor');
  } finally {
    btnRegister.disabled = false;
    btnRegister.textContent = 'Crear Cuenta';
  }
});

// ============================================================
// LOGOUT
// ============================================================

async function logout() {
  await chrome.storage.sync.remove(['auth_token', 'auth_email']);
  showAuth();
  showToast('Sesion cerrada');
}

btnLogout.addEventListener('click', logout);
btnLogoutPending.addEventListener('click', logout);

// ============================================================
// STATUS
// ============================================================

async function updateStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url?.includes('youtube.com')) {
      setStatus('inactive', 'Abre YouTube para empezar', '');
      return;
    }

    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        setStatus('inactive', 'En YouTube — Listo para separar', 'Presiona Ctrl+Shift+S o haz clic en el boton de YouTube');
        return;
      }

      if (response.status === 'idle' || !response.status) {
        setStatus('inactive', 'En YouTube — Listo para separar', '');
      } else if (response.status === 'recording') {
        setStatus('processing', 'Grabando audio...', '');
      } else if (response.status === 'uploading') {
        setStatus('processing', 'Subiendo a mvsep.com...', '');
      } else if (response.status === 'processing') {
        setStatus('processing', 'Procesando separacion...', `Progreso: ${Math.round(response.progress || 0)}%`);
      } else if (response.status === 'downloading') {
        setStatus('processing', 'Descargando resultados...', '');
      } else if (response.status === 'complete') {
        setStatus('active', 'Separacion completada!', 'Cambia entre Original/Instrumental/Vocal en el panel');
      } else if (response.status === 'error') {
        setStatus('error', 'Error', response.message || 'Ocurrio un error');
      } else if (response.status === 'cancelled') {
        setStatus('inactive', 'Cancelado', 'Puedes iniciar una nueva separacion');
      }
    });
  } catch (e) {
    setStatus('inactive', 'Listo', '');
  }
}

function setStatus(type, text, detail) {
  statusDot.className = 'status-dot';
  if (type === 'active') statusDot.classList.add('active');
  else if (type === 'processing') statusDot.classList.add('processing');
  else if (type === 'error') statusDot.classList.add('error');

  statusText.innerHTML = text;
  statusDetail.textContent = detail || '';
  statusDetail.className = 'status-detail' + (type === 'error' ? ' error-text' : '');
}

// ============================================================
// RESET
// ============================================================

async function resetExtension() {
  if (confirm('Restablecer toda la configuracion?')) {
    await chrome.storage.sync.clear();
    showAuth();
    showToast('Configuracion restablecida');
  }
}

// ============================================================
// TOAST
// ============================================================

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = 'toast' + (isError ? ' error' : '');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ============================================================
// EVENT LISTENERS
// ============================================================

btnReset.addEventListener('click', resetExtension);

loginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnLogin.click(); });
registerConfirm.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnRegister.click(); });

let statusInterval = setInterval(updateStatus, 2000);
window.addEventListener('unload', () => clearInterval(statusInterval));

document.addEventListener('DOMContentLoaded', initializePopup);
