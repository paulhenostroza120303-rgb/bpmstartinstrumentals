// ============================================================
// MVSep - Popup Script
// Configuración de API key y visualización de estado
// ============================================================

// Elementos DOM
const apiInput = document.getElementById('api-key-input');
const btnSave = document.getElementById('btn-save-key');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statusDetail = document.getElementById('status-detail');
const toast = document.getElementById('toast');
const btnReset = document.getElementById('btn-reset');

// ============================================================
// INICIALIZACIÓN
// ============================================================

async function initializePopup() {
  // Cargar API key guardada
  const result = await chrome.storage.sync.get(['mvsep_api_key']);
  if (result.mvsep_api_key) {
    apiInput.value = result.mvsep_api_key;
  }

  // Obtener estado actual
  await updateStatus();
}

// ============================================================
// ACTUALIZAR ESTADO
// ============================================================

async function updateStatus() {
  try {
    // Obtener la pestaña activa
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url?.includes('youtube.com')) {
      setStatus('inactive', 'Abre YouTube para empezar', '');
      return;
    }

    // Preguntar al service worker por el estado
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        setStatus('inactive', 'En YouTube — Listo para separar', 'Presiona Ctrl+Shift+S o haz clic en el botón de YouTube');
        return;
      }

      if (response.status === 'idle' || !response.status) {
        setStatus('inactive', 'En YouTube — Listo para separar', '');
      } else if (response.status === 'recording') {
        setStatus('processing', 'Grabando audio...', '');
      } else if (response.status === 'uploading') {
        setStatus('processing', 'Subiendo a mvsep.com...', '');
      } else if (response.status === 'processing') {
        setStatus('processing', 'Procesando separación...', `Progreso: ${Math.round(response.progress || 0)}%`);
      } else if (response.status === 'downloading') {
        setStatus('processing', 'Descargando resultados...', '');
      } else if (response.status === 'complete') {
        setStatus('active', '¡Separación completada!', 'Cambia entre Original/Instrumental/Vocal en el panel');
      } else if (response.status === 'error') {
        setStatus('error', 'Error', response.message || 'Ocurrió un error');
      } else if (response.status === 'cancelled') {
        setStatus('inactive', 'Cancelado', 'Puedes iniciar una nueva separación');
      }
    });
  } catch (e) {
    setStatus('inactive', 'Listo', '');
  }
}

function setStatus(type, text, detail) {
  statusDot.className = 'status-dot';
  if (type === 'active') {
    statusDot.classList.add('active');
  } else if (type === 'processing') {
    statusDot.classList.add('processing');
  } else if (type === 'error') {
    statusDot.classList.add('error');
  }

  statusText.innerHTML = text;
  statusDetail.textContent = detail || '';
  statusDetail.className = 'status-detail' + (type === 'error' ? ' error-text' : '');
}

// ============================================================
// GUARDAR API KEY
// ============================================================

async function saveApiKey() {
  const key = apiInput.value.trim();

  if (!key) {
    showToast('❌ Ingresa una API key');
    return;
  }

  await chrome.storage.sync.set({ mvsep_api_key: key });
  showToast('✓ API key guardada');

  // Si había un estado de error por API key, intentar refrescar
  updateStatus();
}

// ============================================================
// RESTABLECER
// ============================================================

async function resetExtension() {
  if (confirm('¿Restablecer configuración por defecto?')) {
    await chrome.storage.sync.clear();
    apiInput.value = '';
    showToast('✓ Configuración restablecida');
    updateStatus();
  }
}

// ============================================================
// TOAST
// ============================================================

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// ============================================================
// EVENT LISTENERS
// ============================================================

btnSave.addEventListener('click', saveApiKey);

apiInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    saveApiKey();
  }
});

btnReset.addEventListener('click', resetExtension);

// Actualizar estado periódicamente mientras el popup esté abierto
let statusInterval = setInterval(updateStatus, 2000);

// Limpiar al cerrar
window.addEventListener('unload', () => {
  clearInterval(statusInterval);
});

// Iniciar
document.addEventListener('DOMContentLoaded', initializePopup);
