// ============================================================
// MVSep - Content Script (YouTube)
// Panel flotante: solo modo Instrumental con player controlado
// ============================================================

const state = {
  status: 'idle',
  message: '',
  progress: 0,
  results: null,
  instrumentalBuffer: null,
  youtubeVideo: null,
  youtubeMuted: false,
  isPanelVisible: true,
  volume: 1,
  playing: false,
};

let panel = null;
let separatedAudio = null;
let timelineInterval = null;

// ============================================================
// PANEL HTML
// ============================================================

function createPanel() {
  if (panel) return;

  panel = document.createElement('div');
  panel.id = 'mvsep-panel';
  panel.className = 'mvsep-panel mvsep-hidden';
  panel.innerHTML = `
    <div class="mvsep-header">
      <div class="mvsep-logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
        <span>BPMSTART</span>
      </div>
      <div class="mvsep-header-actions">
        <button class="mvsep-btn-icon" id="mvsep-toggle-pin" title="Fijar panel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z"/>
          </svg>
        </button>
        <button class="mvsep-btn-icon" id="mvsep-close-panel" title="Cerrar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="mvsep-body">
      <div class="mvsep-section-title">Separaci\u00f3n de Audio</div>
      <p class="mvsep-description">Obt\u00e9n solo la pista instrumental</p>

      <div class="mvsep-state mvsep-state-idle">
        <button class="mvsep-btn-primary" id="mvsep-btn-separate">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
          </svg>
          Separar Audio
        </button>
      </div>

      <div class="mvsep-state mvsep-state-recording mvsep-hidden">
        <div class="mvsep-recording-indicator">
          <span class="mvsep-recording-dot"></span>
          <span class="mvsep-recording-text">Procesando...</span>
        </div>
        <div class="mvsep-timer" id="mvsep-timer">00:00</div>
        <button class="mvsep-btn-secondary mvsep-btn-stop" id="mvsep-btn-stop">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>
          Detener
        </button>
      </div>

      <div class="mvsep-state mvsep-state-uploading mvsep-hidden">
        <div class="mvsep-spinner"></div>
        <span class="mvsep-status-text">Subiendo a mvsep.com...</span>
      </div>

      <div class="mvsep-state mvsep-state-processing mvsep-hidden">
        <div class="mvsep-spinner"></div>
        <span class="mvsep-status-text" id="mvsep-processing-text">Procesando...</span>
        <div class="mvsep-progress-bar">
          <div class="mvsep-progress-fill" id="mvsep-progress-fill"></div>
        </div>
        <span class="mvsep-progress-text" id="mvsep-progress-text">0%</span>
      </div>

      <div class="mvsep-state mvsep-state-downloading mvsep-hidden">
        <div class="mvsep-spinner"></div>
        <span class="mvsep-status-text">Descargando resultados...</span>
      </div>

      <div class="mvsep-state mvsep-state-complete mvsep-hidden">
        <div class="mvsep-success-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>
        <span class="mvsep-success-text">\u00a1Instrumental listo!</span>

        <div class="mvsep-player">
          <button class="mvsep-play-btn" id="mvsep-play-btn">
            <svg class="mvsep-icon-play" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            <svg class="mvsep-icon-pause" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="display:none">
              <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
            </svg>
          </button>
          <div class="mvsep-timeline-wrap">
            <span class="mvsep-time-current" id="mvsep-time-current">0:00</span>
            <input type="range" class="mvsep-timeline" id="mvsep-timeline" min="0" max="100" value="0" step="0.1">
            <span class="mvsep-time-total" id="mvsep-time-total">0:00</span>
          </div>
        </div>

        <div class="mvsep-volume-control">
          <label class="mvsep-volume-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          </label>
          <input type="range" class="mvsep-volume-slider" id="mvsep-volume-slider" min="0" max="100" value="100">
        </div>

        <div class="mvsep-actions-secondary">
          <button class="mvsep-btn-secondary mvsep-btn-download-full" id="mvsep-btn-download">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Descargar Instrumental
          </button>
          <button class="mvsep-btn-secondary" id="mvsep-btn-separate-again">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Nueva
          </button>
        </div>
      </div>

      <div class="mvsep-state mvsep-state-error mvsep-hidden">
        <div class="mvsep-error-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>
        <span class="mvsep-error-text" id="mvsep-error-text">Error desconocido</span>
        <button class="mvsep-btn-secondary" id="mvsep-btn-retry">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Reintentar
        </button>
      </div>

      <div class="mvsep-state mvsep-state-cancelled mvsep-hidden">
        <span class="mvsep-status-text">Cancelado</span>
        <button class="mvsep-btn-primary" id="mvsep-btn-start-after-cancel">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
          </svg>
          Separar Audio
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  setupEventListeners();
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {
  if (!panel) return;

  panel.querySelector('#mvsep-btn-separate')?.addEventListener('click', startSeparation);
  panel.querySelector('#mvsep-btn-start-after-cancel')?.addEventListener('click', startSeparation);
  panel.querySelector('#mvsep-btn-retry')?.addEventListener('click', startSeparation);
  panel.querySelector('#mvsep-btn-separate-again')?.addEventListener('click', startSeparation);
  panel.querySelector('#mvsep-btn-stop')?.addEventListener('click', stopRecording);
  panel.querySelector('#mvsep-close-panel')?.addEventListener('click', hidePanel);
  panel.querySelector('#mvsep-toggle-pin')?.addEventListener('click', togglePin);
  panel.querySelector('#mvsep-btn-download')?.addEventListener('click', downloadInstrumental);

  panel.querySelector('#mvsep-volume-slider')?.addEventListener('input', (e) => {
    setVolume(e.target.value / 100);
  });

  // Player controls
  panel.querySelector('#mvsep-play-btn')?.addEventListener('click', togglePlay);

  const timeline = panel.querySelector('#mvsep-timeline');
  if (timeline) {
    let seeking = false;

    timeline.addEventListener('input', (e) => {
      seeking = true;
      if (separatedAudio) {
        const time = (e.target.value / 100) * separatedAudio.duration;
        updateTimeDisplay(time, separatedAudio.duration);
      }
    });

    timeline.addEventListener('change', (e) => {
      if (separatedAudio) {
        separatedAudio.currentTime = (e.target.value / 100) * separatedAudio.duration;
      }
      seeking = false;
    });

    timeline.addEventListener('mousedown', () => { seeking = true; });
    timeline.addEventListener('mouseup', () => { seeking = false; });

    panel._timelineSeeking = () => seeking;
  }
}

// ============================================================
// PANEL SHOW / HIDE / PIN
// ============================================================

function showPanel() {
  if (!panel) createPanel();
  panel?.classList.remove('mvsep-hidden');
  panel?.classList.add('mvsep-visible');
  state.isPanelVisible = true;
}

function hidePanel() {
  panel?.classList.remove('mvsep-visible');
  panel?.classList.add('mvsep-hidden');
  state.isPanelVisible = false;
}

function togglePanel() {
  state.isPanelVisible ? hidePanel() : showPanel();
}

function togglePin() {
  panel?.classList.toggle('mvsep-pinned');
  const pinBtn = panel?.querySelector('#mvsep-toggle-pin');
  if (pinBtn) {
    const isPinned = panel?.classList.contains('mvsep-pinned');
    pinBtn.classList.toggle('active', isPinned);
    pinBtn.title = isPinned ? 'Desfijar panel' : 'Fijar panel';
  }
}

// ============================================================
// UI UPDATE
// ============================================================

function updateUI() {
  if (!panel) return;

  panel.querySelectorAll('.mvsep-state').forEach((el) => el.classList.add('mvsep-hidden'));

  const stateMap = {
    idle: '.mvsep-state-idle',
    recording: '.mvsep-state-recording',
    uploading: '.mvsep-state-uploading',
    processing: '.mvsep-state-processing',
    downloading: '.mvsep-state-downloading',
    complete: '.mvsep-state-complete',
    error: '.mvsep-state-error',
    cancelled: '.mvsep-state-cancelled',
  };

  const selector = stateMap[state.status];
  if (selector) {
    const stateEl = panel.querySelector(selector);
    if (stateEl) stateEl.classList.remove('mvsep-hidden');
  }

  const errorText = panel.querySelector('#mvsep-error-text');
  if (errorText && state.status === 'error') {
    errorText.textContent = state.message || 'Error desconocido';
  }

  const processingText = panel.querySelector('#mvsep-processing-text');
  if (processingText) {
    processingText.textContent = state.message || 'Procesando...';
  }

  const progressFill = panel.querySelector('#mvsep-progress-fill');
  const progressText = panel.querySelector('#mvsep-progress-text');
  if (progressFill && progressText) {
    const pct = Math.min(Math.max(state.progress || 0, 0), 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${Math.round(pct)}%`;
  }
}

function setState(status, message = '', progress = 0) {
  state.status = status;
  state.message = message;
  state.progress = progress;

  if (status === 'recording') showPanel();
  if (status === 'complete' || status === 'error' || status === 'cancelled') stopTimer();

  updateUI();
}

// ============================================================
// PLAYER: PLAY / PAUSE / SEEK / TIMELINE
// ============================================================

function togglePlay() {
  if (!separatedAudio) return;

  if (separatedAudio.paused) {
    playInstrumental();
  } else {
    pauseInstrumental();
  }
}

function playInstrumental() {
  if (!separatedAudio) return;

  // Silenciar YouTube
  const video = state.youtubeVideo;
  if (video) {
    video.muted = true;
    state.youtubeMuted = true;
  }

  separatedAudio.volume = state.volume;
  separatedAudio.play().then(() => {
    state.playing = true;
    updatePlayButton();
    startTimelineUpdate();
  }).catch((err) => {
    console.warn('[MVSep] Error al reproducir:', err);
  });
}

function pauseInstrumental() {
  if (!separatedAudio) return;

  separatedAudio.pause();
  state.playing = false;
  updatePlayButton();
  stopTimelineUpdate();
}

function stopPlayback() {
  if (separatedAudio) {
    separatedAudio.pause();
    separatedAudio.currentTime = 0;
  }
  state.playing = false;
  updatePlayButton();
  stopTimelineUpdate();
  updateTimeDisplay(0, separatedAudio?.duration || 0);
  updateTimeline(0);
}

function updatePlayButton() {
  const playIcon = panel?.querySelector('.mvsep-icon-play');
  const pauseIcon = panel?.querySelector('.mvsep-icon-pause');
  if (playIcon && pauseIcon) {
    playIcon.style.display = state.playing ? 'none' : 'block';
    pauseIcon.style.display = state.playing ? 'block' : 'none';
  }
}

function startTimelineUpdate() {
  stopTimelineUpdate();
  timelineInterval = setInterval(updateTimelineProgress, 250);
}

function stopTimelineUpdate() {
  if (timelineInterval) {
    clearInterval(timelineInterval);
    timelineInterval = null;
  }
}

function updateTimelineProgress() {
  if (!separatedAudio || panel?.querySelector?.('._timelineSeeking')?.()) return;

  const current = separatedAudio.currentTime;
  const total = separatedAudio.duration;
  if (!total || !isFinite(total)) return;

  const seeking = panel?._timelineSeeking?.();
  if (!seeking) {
    updateTimeline((current / total) * 100);
  }
  updateTimeDisplay(current, total);
}

function updateTimeline(pct) {
  const timeline = panel?.querySelector('#mvsep-timeline');
  if (timeline) timeline.value = pct;
}

function updateTimeDisplay(current, total) {
  const curEl = panel?.querySelector('#mvsep-time-current');
  const totEl = panel?.querySelector('#mvsep-time-total');
  if (curEl) curEl.textContent = formatTime(current);
  if (totEl) totEl.textContent = formatTime(total);
}

function formatTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ============================================================
// SEPARATED AUDIO: crear Blob URL y Audio element
// ============================================================

function setupSeparatedAudio(arrayBuffer) {
  // Detener anterior
  if (separatedAudio) {
    separatedAudio.pause();
    separatedAudio.src = '';
    separatedAudio = null;
  }
  stopTimelineUpdate();

  const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);

  separatedAudio = new Audio(url);
  separatedAudio.preload = 'auto';

  separatedAudio.addEventListener('loadedmetadata', () => {
    updateTimeDisplay(0, separatedAudio.duration);
    console.log(`[MVSep] Audio cargado: ${formatTime(separatedAudio.duration)}`);
  });

  separatedAudio.addEventListener('ended', () => {
    state.playing = false;
    updatePlayButton();
    stopTimelineUpdate();
    updateTimeline(0);
    updateTimeDisplay(0, separatedAudio.duration);
  });

  separatedAudio.addEventListener('error', (e) => {
    console.error('[MVSep] Error en Audio:', e);
    state.playing = false;
    updatePlayButton();
  });
}

// ============================================================
// SEPARATION FLOW
// ============================================================

async function startSeparation() {
  const video = document.querySelector('video');
  if (!video) {
    setState('error', 'No se encontr\u00f3 un video de YouTube.');
    return;
  }

  state.youtubeVideo = video;
  stopPlayback();

  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get('v');

  setState('recording', 'Conectando...');
  startTimer();

  chrome.runtime.sendMessage({
    type: 'START_SEPARATION',
    youtubeUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : window.location.href,
  }, (response) => {
    if (chrome.runtime.lastError) {
      setState('error', 'Error: ' + chrome.runtime.lastError.message);
      return;
    }
    if (!response?.success) {
      setState('error', response?.error || 'Error al iniciar');
    }
  });
}

function stopRecording() {
  chrome.runtime.sendMessage({ type: 'CANCEL_SEPARATION' });
  setState('cancelled', 'Cancelado');
  stopTimer();
}

// ============================================================
// TIMER
// ============================================================

let timerInterval = null;
let timerStart = 0;

function startTimer() {
  timerStart = Date.now();
  const timerEl = panel?.querySelector('#mvsep-timer');
  if (timerEl) {
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - timerStart) / 1000);
      timerEl.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    }, 200);
  }
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ============================================================
// VOLUME
// ============================================================

function setVolume(value) {
  state.volume = value;
  if (separatedAudio) {
    separatedAudio.volume = value;
  }
}

// ============================================================
// DOWNLOAD
// ============================================================

function downloadInstrumental() {
  if (!state.instrumentalBuffer) return;

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
  const blob = new Blob([state.instrumentalBuffer], { type: 'audio/flac' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `instrumental_${timestamp}.flac`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// COMUNICACIÓN CON SERVICE WORKER
// ============================================================

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'STATUS_UPDATE':
      setState(message.status, message.message, message.progress);
      break;
    case 'SEPARATION_COMPLETE':
      handleSeparationComplete(message.message);
      break;
  }
});

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function handleSeparationComplete(message) {
  console.log('[MVSep] Separaci\u00f3n completada, pidiendo resultados...');
  setState('complete', message || '\u00a1Instrumental listo!');

  try {
    // 1. Obtener metadata (cuántos chunks hay)
    const meta = await chrome.runtime.sendMessage({ type: 'GET_RESULTS' });

    if (!meta?.success) {
      setState('error', 'Error: ' + (meta?.error || 'desconocido'));
      return;
    }

    // 2. Pedir cada chunk y reensamblar
    let base64 = '';
    for (let i = 0; i < meta.totalChunks; i++) {
      const chunkResp = await chrome.runtime.sendMessage({ type: 'GET_CHUNK', chunkIndex: i });
      if (!chunkResp?.success) {
        setState('error', 'Error al obtener chunk ' + i);
        return;
      }
      base64 += chunkResp.chunk;
    }

    // 3. Decodificar base64 a ArrayBuffer
    state.instrumentalBuffer = base64ToArrayBuffer(base64);
    console.log(`[MVSep] Instrumental recibido: ${state.instrumentalBuffer.byteLength} bytes (${meta.totalChunks} chunks)`);
    setupSeparatedAudio(state.instrumentalBuffer);

  } catch (err) {
    console.error('[MVSep] Error:', err);
    setState('error', 'Error de comunicaci\u00f3n: ' + err.message);
  }
}

// ============================================================
// BOTÓN EN YOUTUBE
// ============================================================

function injectYouTubeButton() {
  const observer = new MutationObserver(() => {
    const controls = document.querySelector('.ytp-right-controls');
    if (controls && !document.querySelector('.mvsep-youtube-btn')) {
      const btn = document.createElement('button');
      btn.className = 'ytp-button mvsep-youtube-btn';
      btn.title = 'BPMSTART - Separar audio';
      btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
      `;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showPanel();
      });
      controls.appendChild(btn);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ============================================================
// ATAJOS
// ============================================================

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    togglePanel();
  }
});

// ============================================================
// INIT
// ============================================================

function initialize() {
  createPanel();
  injectYouTubeButton();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
