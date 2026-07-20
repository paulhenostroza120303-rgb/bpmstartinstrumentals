// ============================================================
// MVSep - Service Worker
// Orquestador principal: captura de audio, API mvsep.com,
// descarga de resultados y comunicación con content script
// ============================================================

const MVSEP_API_BASE = 'https://de.mvsep.com/api';
const DEFAULT_API_KEY = '1Fy0mpljKMTlmesywS135hZ7OBq076';
const SEP_TYPE = 40; // BS Roformer (vocals, instrumental) - keys correctas
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120; // 6 minutos máximo de espera

// Almacena el estado de las sesiones activas por tabId
const sessions = new Map();

// ============================================================
// UTILIDADES
// ============================================================

function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['mvsep_api_key'], (result) => {
      resolve(result.mvsep_api_key || DEFAULT_API_KEY);
    });
  });
}

function generateJobId() {
  return 'mvsep_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(''));
}

// ============================================================
// MANEJO DE MENSAJES
// ============================================================

const resultChunks = new Map(); // tabId -> { vocal: [], instrumental: [] }

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = {
    START_SEPARATION: () => handleStartSeparation(message, sender),
    RECORDING_COMPLETE: () => handleRecordingComplete(message, sender),
    CANCEL_SEPARATION: () => handleCancelSeparation(sender),
    GET_STATUS: () => handleGetStatus(sender),
    GET_RESULTS: () => handleGetResults(sender),
    GET_CHUNK: () => handleGetChunk(message, sender),
  }[message.type];

  if (handler) {
    handler().then(sendResponse).catch((err) => {
      console.error('[MVSep] Error:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});

// ============================================================
// FLUJO PRINCIPAL: INICIAR SEPARACIÓN
// ============================================================

async function handleStartSeparation(message, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) throw new Error('No se pudo identificar la pestaña de YouTube');

  const youtubeUrl = message.youtubeUrl || '';

  const jobId = generateJobId();
  const session = {
    jobId,
    tabId,
    status: 'initializing',
    progress: 0,
    error: null,
    results: null,
    usingLocalHelper: false,
  };
  sessions.set(tabId, session);

  notifyContentScript(tabId, { type: 'STATUS_UPDATE', status: 'initializing', message: 'Inicializando...' });

  try {
    // INTENTAR USAR HELPER LOCAL PRIMERO
    // Si el helper local está corriendo en localhost:3456, lo usamos.
    // Es más rápido porque descarga el audio directamente de YouTube.
    if (youtubeUrl) {
      const localHelperAvailable = await checkLocalHelper();

      if (localHelperAvailable) {
        console.log('[MVSep] Usando helper local para:', youtubeUrl);
        session.usingLocalHelper = true;
        session.status = 'processing';

        notifyContentScript(tabId, {
          type: 'STATUS_UPDATE',
          status: 'processing',
          message: 'Descargando y separando audio... (helper local)',
          progress: 0,
        });

        const result = await useLocalHelper(youtubeUrl, tabId, session);

        if (result.success) {
          session.status = 'complete';
          session.results = {
            instrumental: result.instrumental,
            vocal: result.vocal,
          };

          notifyContentScript(tabId, {
            type: 'SEPARATION_COMPLETE',
            message: '¡Separación completada! (helper local)',
          });

          return { success: true, jobId: session.jobId };
        } else {
          // Helper local falló, intentar con grabación del tab
          console.warn('[MVSep] Helper local falló, usando grabación:', result.error);
        }
      } else {
        console.log('[MVSep] Helper local no disponible, usando grabación del tab');
      }
    }

    // ============================================================
    // FALLBACK: GRABACIÓN DEL TAB (código original)
    // ============================================================

    // 1. Obtener stream ID para capturar audio
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    session.status = 'recording';

    notifyContentScript(tabId, {
      type: 'STATUS_UPDATE',
      status: 'recording',
      message: 'Grabando audio...',
    });

    // 2. Crear offscreen document y pasarle el streamId
    await ensureOffscreenDocument();
    const recordingResult = await sendMessageToOffscreen({
      type: 'CAPTURE_AUDIO',
      streamId,
      jobId: session.jobId,
      durationMs: 60000,
    });

    if (!recordingResult.success) {
      throw new Error('Error al grabar audio: ' + (recordingResult.error || 'desconocido'));
    }

    session.status = 'uploading';
    notifyContentScript(tabId, {
      type: 'STATUS_UPDATE',
      status: 'uploading',
      message: 'Subiendo a mvsep.com...',
    });

    // 3. Reconstruir el Blob desde el ArrayBuffer y subir
    const audioBlob = new Blob([recordingResult.arrayBuffer], { type: recordingResult.mimeType });
    const apiKey = await getApiKey();
    const uploadResult = await uploadToMvsep(audioBlob, apiKey);

    if (!uploadResult.success) {
      throw new Error('Error al subir audio: ' + (uploadResult.error || 'desconocido'));
    }

    const jobIdMvsep = uploadResult.job_id;
    session.mvsepJobId = jobIdMvsep;
    session.status = 'processing';

    notifyContentScript(tabId, {
      type: 'STATUS_UPDATE',
      status: 'processing',
      message: 'Procesando separación...',
      progress: 0,
    });

    // 4. Pollear hasta que termine
    const pollResult = await pollMvsepJob(jobIdMvsep, apiKey, tabId, session);

    if (!pollResult.success) {
      throw new Error('Error en la separación: ' + (pollResult.error || 'desconocido'));
    }

    session.status = 'downloading';
    notifyContentScript(tabId, {
      type: 'STATUS_UPDATE',
      status: 'downloading',
      message: 'Descargando resultados...',
    });

    // 5. Descargar los resultados
    const downloadResult = await downloadMvsepResults(pollResult.downloadUrls, apiKey);

    if (!downloadResult.success) {
      throw new Error('Error al descargar resultados: ' + (downloadResult.error || 'desconocido'));
    }

    // 6. Guardar resultados y enviar al content script
    session.status = 'complete';
    session.results = {
      instrumental: downloadResult.instrumental,
      vocal: downloadResult.vocal,
    };

    notifyContentScript(tabId, {
      type: 'SEPARATION_COMPLETE',
      message: '¡Separación completada!',
    });

    chrome.storage.local.set({ [`result_${jobId}`]: { timestamp: Date.now(), tabId } });

    return { success: true, jobId: session.jobId };

  } catch (error) {
    session.status = 'error';
    session.error = error.message;
    notifyContentScript(tabId, {
      type: 'STATUS_UPDATE',
      status: 'error',
      message: 'Error: ' + error.message,
    });
    return { success: false, error: error.message };
  } finally {
    // Cerrar offscreen si no hay más sesiones activas después de 5s
    setTimeout(() => {
      let hasActive = false;
      for (const [, s] of sessions) {
        if (s.status === 'recording' || s.status === 'uploading' || s.status === 'processing') {
          hasActive = true;
          break;
        }
      }
      if (!hasActive) closeOffscreenDocument();
    }, 5000);
  }
}

// ============================================================
// NOTIFICAR AL CONTENT SCRIPT
// ============================================================

function notifyContentScript(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Ignorar errores si el content script no está listo
  });
}

// ============================================================
// OFESCREEN DOCUMENT MANAGEMENT
// ============================================================

let offscreenDocumentReady = false;

async function ensureOffscreenDocument() {
  const exists = await chrome.offscreen.hasDocument();
  if (exists) {
    offscreenDocumentReady = true;
    return;
  }

  offscreenDocumentReady = false;

  // IMPORTANTE: Registrar el listener ANTES de crear el document.
  // Si lo hacemos después, el OFFSCREEN_READY puede llegar antes
  // de que el listener esté escuchando (race condition).
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      // Timeout! El OFFSCREEN_READY no llegó. Probamos con PING.
      tryPingOffscreen().then((ok) => {
        if (ok) {
          offscreenDocumentReady = true;
          cleanup();
          resolve();
        } else {
          cleanup();
          reject(new Error('Timeout esperando offscreen document: no responde a PING'));
        }
      });
    }, 8000);

    let resolved = false;

    const listener = (message) => {
      if (message.type === 'OFFSCREEN_READY') {
        offscreenDocumentReady = true;
        resolved = true;
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        resolve();
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // Crear el document DESPUÉS de registrar el listener
    chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capturar audio del tab de YouTube para separación con mvsep.com',
    }).catch((err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        reject(err);
      }
    });

    function cleanup() {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
      }
    }

    async function tryPingOffscreen() {
      try {
        const result = await sendMessageToOffscreen({ type: 'PING' });
        return result && result.pong === true;
      } catch (e) {
        return false;
      }
    }
  });
}

function sendMessageToOffscreen(message) {
  return new Promise((resolve, reject) => {
    const messageId = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const msgWithId = { ...message, _messageId: messageId };

    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error('Timeout esperando respuesta del offscreen document'));
    }, 180000); // 3 minutos timeout

    const listener = (response) => {
      if (response._messageId === messageId) {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(response);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    chrome.runtime.sendMessage(msgWithId).catch((err) => {
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
      reject(err);
    });
  });
}

async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {
    // Ignorar
  }
  offscreenDocumentReady = false;
}

// ============================================================
// HELPER LOCAL (ytdl-core en localhost:3456)
// ============================================================

const LOCAL_HELPER_URL = 'https://bpmstartinstrumentals-production.up.railway.app';

async function checkLocalHelper() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${LOCAL_HELPER_URL}/ping`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch (e) {
    return false;
  }
}

async function useLocalHelper(youtubeUrl, tabId, session) {
  try {
    // Get auth token
    const authData = await chrome.storage.sync.get(['auth_token']);
    const token = authData.auth_token;
    if (!token) {
      throw new Error('No has iniciado sesion. Abre el popup de la extension para iniciar sesion.');
    }

    const response = await fetch(`${LOCAL_HELPER_URL}/separate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        youtubeUrl,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401) {
        await chrome.storage.sync.remove(['auth_token', 'auth_email']);
        throw new Error('Sesion expirada. Abre el popup e inicia sesion de nuevo.');
      }
      if (response.status === 403) {
        throw new Error('Tu cuenta no esta aprobada. Espera a que el admin te apruebe.');
      }
      throw new Error(`Helper error ${response.status}: ${text}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Helper local falló');
    }

    // Convertir base64 a ArrayBuffer
    const instrumental = data.instrumental
      ? Uint8Array.from(atob(data.instrumental), (c) => c.charCodeAt(0)).buffer
      : null;

    const vocal = data.vocal
      ? Uint8Array.from(atob(data.vocal), (c) => c.charCodeAt(0)).buffer
      : null;

    console.log('[MVSep] Helper local completado:', data.title);

    return {
      success: true,
      instrumental,
      vocal,
      title: data.title,
    };

  } catch (error) {
    console.warn('[MVSep] Error con helper local:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================
// API MVSEP.COM
// ============================================================

async function uploadToMvsep(audioBlob, apiKey) {
  const formData = new FormData();
  // api_token va como QUERY PARAMETER en la URL, no en el body
  formData.append('audiofile', audioBlob, 'youtube_audio.' + (audioBlob.type.includes('webm') ? 'webm' : 'mp3'));
  formData.append('sep_type', String(SEP_TYPE));
  formData.append('output_format', '2'); // 2 = flac lossless 16bit

  const url = `${MVSEP_API_BASE}/separation/create?api_token=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  // Nuevo formato: { success: true, data: { hash, link } }
  // Formato viejo: { success: true, job_id: "..." }
  if (data?.data?.hash) {
    data.job_id = data.data.hash;
  }
  return data;
}

async function pollMvsepJob(jobId, apiKey, tabId, session) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    // Verificar que la pestaña aún existe
    try {
      await chrome.tabs.get(tabId);
    } catch (e) {
      return { success: false, error: 'La pestaña fue cerrada durante el procesamiento' };
    }

    try {
      // Nuevo endpoint: /api/separation/get?hash=...  (sin api_token)
      // Formato viejo: /api/separation/status?api_token=...&job_id=...
      const response = await fetch(
        `${MVSEP_API_BASE}/separation/get?hash=${encodeURIComponent(jobId)}`
      );

      if (!response.ok) continue;

      const data = await response.json();
      // Nuevo formato: { success: true, data: { status, result } }
      // Formato viejo: { status: "...", progress: ... }
      const status = (data?.data?.status || data.status || '').toLowerCase();
      const progress = data?.data?.progress || data.progress;

      if (progress !== undefined) {
        session.progress = progress;
        notifyContentScript(tabId, {
          type: 'STATUS_UPDATE',
          status: 'processing',
          message: `Procesando... ${Math.round(progress)}%`,
          progress: progress,
        });
      }

      if (status === 'done' || status === 'completed' || status === 'success') {
        const downloadUrls = extractDownloadUrls(data);
        if (downloadUrls) {
          return { success: true, downloadUrls };
        }
      }

      if (status === 'error' || status === 'failed') {
        return { success: false, error: data.message || data.error || 'Error en el procesamiento' };
      }

    } catch (e) {
      console.warn('[MVSep] Error polling job:', e.message);
    }
  }

  return { success: false, error: 'Tiempo de espera agotado. El proceso tomó demasiado tiempo.' };
}

function extractDownloadUrls(data) {
  // Nuevo formato: { success: true, data: { status: "done", result: { vocals: "...", instrumental: "..." } } }
  if (data?.data?.result) return data.data.result;
  if (data?.data?.download_urls) return data.data.download_urls;
  if (data?.data?.files) return data.data.files;
  if (data?.data?.urls) return data.data.urls;
  // Formato viejo
  if (data.download_urls) return data.download_urls;
  if (data.result && data.result.download_urls) return data.result.download_urls;
  if (data.files) return data.files;
  if (data.urls) return data.urls;
  if (data.download_url || data.url) {
    return { instrumental: data.download_url || data.url, vocal: data.download_url || data.url };
  }
  return null;
}

async function downloadMvsepResults(downloadUrls, apiKey) {
  const result = { success: false, instrumental: null, vocal: null };
  const downloads = [];

  const instrumentalKeys = ['other', 'instrumental', 'drums', 'bass', 'accompaniment', 'music', 'no_vocals'];
  const vocalKeys = ['vocals', 'voice', 'vocal'];

  let instrumentalUrl = null;
  let vocalUrl = null;

  for (const [key, val] of Object.entries(downloadUrls)) {
    // val puede ser string u objeto { url: "..." } o { link: "..." }
    const url = typeof val === 'string' ? val : (val?.url || val?.link || val?.download_url || Object.values(val)[0]);
    const keyLower = key.toLowerCase();
    if (instrumentalKeys.some(k => keyLower.includes(k))) {
      instrumentalUrl = url;
    } else if (vocalKeys.some(k => keyLower.includes(k))) {
      vocalUrl = url;
    }
  }

  if (!instrumentalUrl && !vocalUrl) {
    const entries = Object.entries(downloadUrls);
    const urls = entries.map(([k, val]) => typeof val === 'string' ? val : (val?.url || val?.link || val?.download_url || Object.values(val)[0]));
    if (urls.length >= 2) {
      instrumentalUrl = urls[0];
      vocalUrl = urls[1];
    } else if (urls.length === 1) {
      vocalUrl = urls[0];
    }
  }

  // Las URLs de descarga ahora pueden ser relativas (sin dominio)
  const baseUrl = 'https://de.mvsep.com';

  if (vocalUrl) {
    const urlStr = typeof vocalUrl !== 'string' ? JSON.stringify(vocalUrl) : vocalUrl;
    const fullUrl = urlStr.startsWith('http') ? urlStr : baseUrl + urlStr;
    downloads.push(
      fetchWithAuth(fullUrl, apiKey).then(async (response) => {
        if (response.ok) result.vocal = await response.arrayBuffer();
      })
    );
  }

  if (instrumentalUrl) {
    const urlStr = typeof instrumentalUrl !== 'string' ? JSON.stringify(instrumentalUrl) : instrumentalUrl;
    const fullUrl = urlStr.startsWith('http') ? urlStr : baseUrl + urlStr;
    downloads.push(
      fetchWithAuth(fullUrl, apiKey).then(async (response) => {
        if (response.ok) result.instrumental = await response.arrayBuffer();
      })
    );
  }

  await Promise.all(downloads);
  result.success = !!(result.instrumental || result.vocal);
  return result;
}

async function fetchWithAuth(url, apiKey) {
  const separator = url.includes('?') ? '&' : '?';
  const urlWithAuth = `${url}${separator}api_token=${encodeURIComponent(apiKey)}`;
  return fetch(urlWithAuth);
}

// ============================================================
// MANEJADORES ADICIONALES
// ============================================================

async function handleRecordingComplete(message, sender) {
  return { success: true };
}

async function handleCancelSeparation(sender) {
  const tabId = sender.tab?.id;
  if (tabId && sessions.has(tabId)) {
    const session = sessions.get(tabId);
    session.status = 'cancelled';
    sessions.delete(tabId);
    notifyContentScript(tabId, { type: 'STATUS_UPDATE', status: 'cancelled', message: 'Cancelado' });
  }
  return { success: true };
}

async function handleGetStatus(sender) {
  const tabId = sender.tab?.id;
  const session = sessions.get(tabId);
  if (!session) return { success: true, status: 'idle' };

  return {
    success: true,
    status: session.status,
    progress: session.progress,
    message: session.error || null,
    hasResults: !!session.results,
  };
}

async function handleGetResults(sender) {
  const tabId = sender.tab?.id;
  const session = sessions.get(tabId);
  if (!session || !session.results) {
    return { success: false, error: 'No hay resultados disponibles' };
  }

  // API keys invertidas: result.vocal = instrumental real, result.instrumental = vocal real
  const instrumentalData = session.results.vocal;
  const vocalData = session.results.instrumental;

  if (!instrumentalData && !vocalData) {
    return { success: false, error: 'No hay pistas disponibles' };
  }

  const CHUNK_SIZE = 10 * 1024 * 1024;
  const chunks = { vocal: [], instrumental: [] };

  if (instrumentalData) {
    const base64 = bufferToBase64(instrumentalData);
    for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
      chunks.instrumental.push(base64.slice(i, i + CHUNK_SIZE));
    }
  }

  if (vocalData) {
    const base64 = bufferToBase64(vocalData);
    for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
      chunks.vocal.push(base64.slice(i, i + CHUNK_SIZE));
    }
  }

  resultChunks.set(tabId, chunks);
  console.log(`[MVSep] Pistas divididas: instrumental=${chunks.instrumental.length} chunks, vocal=${chunks.vocal.length} chunks`);

  return {
    success: true,
    totalChunksInstrumental: chunks.instrumental.length,
    totalChunksVocal: chunks.vocal.length,
    totalSizeInstrumental: instrumentalData ? instrumentalData.byteLength : 0,
    totalSizeVocal: vocalData ? vocalData.byteLength : 0,
  };
}

async function handleGetChunk(message, sender) {
  const tabId = sender.tab?.id;
  const allChunks = resultChunks.get(tabId);
  if (!allChunks) {
    return { success: false, error: 'No hay chunks disponibles' };
  }

  const track = message.track || 'instrumental';
  const chunks = allChunks[track];
  if (!chunks) {
    return { success: false, error: `Pista "${track}" no disponible` };
  }

  const idx = message.chunkIndex;
  if (idx < 0 || idx >= chunks.length) {
    return { success: false, error: 'Chunk index inválido' };
  }

  return {
    success: true,
    chunk: chunks[idx],
    chunkIndex: idx,
    totalChunks: chunks.length,
    track,
  };
}

// ============================================================
// INSTALACIÓN
// ============================================================

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.sync.get(['mvsep_api_key'], (result) => {
    if (!result.mvsep_api_key) {
      chrome.storage.sync.set({ mvsep_api_key: DEFAULT_API_KEY });
    }
  });
  console.log('[MVSep] Extensión instalada. API key configurada.');
});
