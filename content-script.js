// ============================================================
// MVSep - Content Script (YouTube)
// Panel flotante con mixer Vocal + Instrumental
// ============================================================

const state = {
  status: 'idle',
  message: '',
  progress: 0,
  instrumentalBuffer: null,
  vocalBuffer: null,
  youtubeVideo: null,
  youtubeMuted: false,
  isPanelVisible: true,
  playing: false,
  instrumentalVolume: 1,
  vocalVolume: 1,
  instrumentalMuted: false,
  vocalMuted: false,
};

let panel = null;
let instrumentalAudio = null;
let vocalAudio = null;
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
      <div class="mvsep-section-title">Separacion de Audio</div>
      <p class="mvsep-description">Obten instrumental y vocal separados</p>

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
        <span class="mvsep-success-text">Pistas listas!</span>

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

        <div class="mvsep-mixer">
          <div class="mvsep-mixer-track mvsep-mixer-instrumental">
            <div class="mvsep-mixer-label">
              <span class="mvsep-mixer-dot instrumental"></span>
              Instrumental
            </div>
            <input type="range" class="mvsep-mixer-slider instrumental" id="mvsep-slider-instrumental" min="0" max="100" value="100">
            <button class="mvsep-mute-btn" id="mvsep-mute-instrumental" title="Silenciar instrumental">
              <svg class="mvsep-mute-icon-on" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
              <svg class="mvsep-mute-icon-off" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <line x1="23" y1="9" x2="17" y2="15"/>
                <line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
            </button>
          </div>

          <div class="mvsep-mixer-track mvsep-mixer-vocal">
            <div class="mvsep-mixer-label">
              <span class="mvsep-mixer-dot vocal"></span>
              Vocal
            </div>
            <input type="range" class="mvsep-mixer-slider vocal" id="mvsep-slider-vocal" min="0" max="100" value="100">
            <button class="mvsep-mute-btn" id="mvsep-mute-vocal" title="Silenciar vocal">
              <svg class="mvsep-mute-icon-on" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
              <svg class="mvsep-mute-icon-off" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <line x1="23" y1="9" x2="17" y2="15"/>
                <line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="mvsep-actions-secondary">
          <button class="mvsep-btn-secondary mvsep-btn-download-full" id="mvsep-btn-download-inst">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Descargar Instrumental
          </button>
          <button class="mvsep-btn-secondary mvsep-btn-download-full" id="mvsep-btn-download-vocal">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Descargar Vocal
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

  panel.querySelector('#mvsep-btn-download-inst')?.addEventListener('click', downloadInstrumental);
  panel.querySelector('#mvsep-btn-download-vocal')?.addEventListener('click', downloadVocal);

  panel.querySelector('#mvsep-play-btn')?.addEventListener('click', togglePlay);

  // Mixer sliders
  panel.querySelector('#mvsep-slider-instrumental')?.addEventListener('input', (e) => {
    setInstrumentalVolume(e.target.value / 100);
  });
  panel.querySelector('#mvsep-slider-vocal')?.addEventListener('input', (e) => {
    setVocalVolume(e.target.value / 100);
  });

  // Mute buttons
  panel.querySelector('#mvsep-mute-instrumental')?.addEventListener('click', toggleMuteInstrumental);
  panel.querySelector('#mvsep-mute-vocal')?.addEventListener('click', toggleMuteVocal);

  // Timeline
  const timeline = panel.querySelector('#mvsep-timeline');
  if (timeline) {
    let seeking = false;

    timeline.addEventListener('input', (e) => {
      seeking = true;
      const audio = instrumentalAudio || vocalAudio;
      if (audio) {
        const time = (e.target.value / 100) * audio.duration;
        updateTimeDisplay(time, audio.duration);
      }
    });

    timeline.addEventListener('change', (e) => {
      const audio = instrumentalAudio || vocalAudio;
      if (audio) {
        const time = (e.target.value / 100) * audio.duration;
        if (instrumentalAudio) instrumentalAudio.currentTime = time;
        if (vocalAudio) vocalAudio.currentTime = time;
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
// MIXER: VOLUME / MUTE
// ============================================================

function setInstrumentalVolume(value) {
  state.instrumentalVolume = value;
  state.instrumentalMuted = value === 0;
  if (instrumentalAudio) instrumentalAudio.volume = value;
  updateMuteIcon('instrumental');
}

function setVocalVolume(value) {
  state.vocalVolume = value;
  state.vocalMuted = value === 0;
  if (vocalAudio) vocalAudio.volume = value;
  updateMuteIcon('vocal');
}

function toggleMuteInstrumental() {
  if (state.instrumentalMuted) {
    state.instrumentalMuted = false;
    state.instrumentalVolume = state.instrumentalVolume || 1;
    if (instrumentalAudio) instrumentalAudio.volume = state.instrumentalVolume;
    const slider = panel?.querySelector('#mvsep-slider-instrumental');
    if (slider) slider.value = state.instrumentalVolume * 100;
  } else {
    state.instrumentalMuted = true;
    if (instrumentalAudio) instrumentalAudio.volume = 0;
    const slider = panel?.querySelector('#mvsep-slider-instrumental');
    if (slider) slider.value = 0;
  }
  updateMuteIcon('instrumental');
}

function toggleMuteVocal() {
  if (state.vocalMuted) {
    state.vocalMuted = false;
    state.vocalVolume = state.vocalVolume || 1;
    if (vocalAudio) vocalAudio.volume = state.vocalVolume;
    const slider = panel?.querySelector('#mvsep-slider-vocal');
    if (slider) slider.value = state.vocalVolume * 100;
  } else {
    state.vocalMuted = true;
    if (vocalAudio) vocalAudio.volume = 0;
    const slider = panel?.querySelector('#mvsep-slider-vocal');
    if (slider) slider.value = 0;
  }
  updateMuteIcon('vocal');
}

function updateMuteIcon(track) {
  const isMuted = track === 'instrumental' ? state.instrumentalMuted : state.vocalMuted;
  const btn = panel?.querySelector(`#mvsep-mute-${track}`);
  if (!btn) return;
  const iconOn = btn.querySelector('.mvsep-mute-icon-on');
  const iconOff = btn.querySelector('.mvsep-mute-icon-off');
  if (iconOn) iconOn.style.display = isMuted ? 'none' : 'block';
  if (iconOff) iconOff.style.display = isMuted ? 'block' : 'none';
}

// ============================================================
// PLAYER: PLAY / PAUSE / SEEK / TIMELINE
// ============================================================

function togglePlay() {
  const audio = instrumentalAudio || vocalAudio;
  if (!audio) return;

  if (audio.paused) {
    playMixer();
  } else {
    pauseMixer();
  }
}

function playMixer() {
  if (instrumentalAudio) {
    instrumentalAudio.volume = state.instrumentalMuted ? 0 : state.instrumentalVolume;
  }
  if (vocalAudio) {
    vocalAudio.volume = state.vocalMuted ? 0 : state.vocalVolume;
  }

  const audioToPlay = instrumentalAudio || vocalAudio;
  if (!audioToPlay) return;

  audioToPlay.play().then(() => {
    state.playing = true;
    updatePlayButton();
    startTimelineUpdate();
  }).catch((err) => {
    console.warn('[MVSep] Error al reproducir:', err);
  });
}

function pauseMixer() {
  if (instrumentalAudio) instrumentalAudio.pause();
  if (vocalAudio) vocalAudio.pause();
  state.playing = false;
  updatePlayButton();
  stopTimelineUpdate();
}

function stopPlayback() {
  if (instrumentalAudio) {
    instrumentalAudio.pause();
    instrumentalAudio.currentTime = 0;
  }
  if (vocalAudio) {
    vocalAudio.pause();
    vocalAudio.currentTime = 0;
  }
  state.playing = false;
  updatePlayButton();
  stopTimelineUpdate();
  updateTimeDisplay(0, instrumentalAudio?.duration || vocalAudio?.duration || 0);
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
  const audio = instrumentalAudio || vocalAudio;
  if (!audio) return;
  if (panel?._timelineSeeking?.()) return;

  const current = audio.currentTime;
  const total = audio.duration;
  if (!total || !isFinite(total)) return;

  updateTimeline((current / total) * 100);
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
// AUDIO: crear Blob URLs y Audio elements
// ============================================================

function setupAudio(arrayBuffer, type) {
  const blob = new Blob([arrayBuffer], { type: 'audio/flac' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = 'auto';
  return audio;
}

function setupMixerAudio(instrumentalBuf, vocalBuf) {
  stopPlayback();

  if (instrumentalAudio) { instrumentalAudio.src = ''; instrumentalAudio = null; }
  if (vocalAudio) { vocalAudio.src = ''; vocalAudio = null; }
  stopTimelineUpdate();

  if (instrumentalBuf) {
    instrumentalAudio = setupAudio(instrumentalBuf, 'instrumental');
    instrumentalAudio.volume = state.instrumentalMuted ? 0 : state.instrumentalVolume;
  }

  if (vocalBuf) {
    vocalAudio = setupAudio(vocalBuf, 'vocal');
    vocalAudio.volume = state.vocalMuted ? 0 : state.vocalVolume;
  }

  const primary = instrumentalAudio || vocalAudio;

  primary.addEventListener('loadedmetadata', () => {
    updateTimeDisplay(0, primary.duration);
    console.log(`[MVSep] Audio cargado: ${formatTime(primary.duration)}`);
  });

  primary.addEventListener('ended', () => {
    if (vocalAudio && !vocalAudio.paused) vocalAudio.pause();
    state.playing = false;
    updatePlayButton();
    stopTimelineUpdate();
    updateTimeline(0);
    updateTimeDisplay(0, primary.duration);
  });

  primary.addEventListener('error', (e) => {
    console.error('[MVSep] Error en Audio:', e);
    state.playing = false;
    updatePlayButton();
  });

  // Sync vocal with instrumental seeking
  if (instrumentalAudio && vocalAudio) {
    instrumentalAudio.addEventListener('seeking', () => {
      vocalAudio.currentTime = instrumentalAudio.currentTime;
    });
  }
}

// ============================================================
// SEPARATION FLOW
// ============================================================

async function startSeparation() {
  const video = document.querySelector('video');
  if (!video) {
    setState('error', 'No se encontro un video de YouTube.');
    return;
  }

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

function downloadVocal() {
  if (!state.vocalBuffer) return;
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
  const blob = new Blob([state.vocalBuffer], { type: 'audio/flac' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vocal_${timestamp}.flac`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// COMUNICACION CON SERVICE WORKER
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

async function receiveTrackChunks(track) {
  const meta = await chrome.runtime.sendMessage({ type: 'GET_RESULTS' });
  if (!meta?.success) return null;

  const totalChunksKey = track === 'vocal' ? 'totalChunksVocal' : 'totalChunksInstrumental';
  const totalChunks = meta[totalChunksKey] || 0;
  if (totalChunks === 0) return null;

  let base64 = '';
  for (let i = 0; i < totalChunks; i++) {
    const chunkResp = await chrome.runtime.sendMessage({ type: 'GET_CHUNK', chunkIndex: i, track });
    if (!chunkResp?.success) {
      setState('error', `Error al obtener chunk ${i} de ${track}`);
      return null;
    }
    base64 += chunkResp.chunk;
  }

  return base64ToArrayBuffer(base64);
}

async function handleSeparationComplete(message) {
  console.log('[MVSep] Separacion completada, pidiendo resultados...');
  setState('complete', message || 'Pistas listas!');

  try {
    const instrumentalBuffer = await receiveTrackChunks('instrumental');
    const vocalBuffer = await receiveTrackChunks('vocal');

    if (!instrumentalBuffer && !vocalBuffer) {
      setState('error', 'No se recibieron pistas');
      return;
    }

    state.instrumentalBuffer = instrumentalBuffer;
    state.vocalBuffer = vocalBuffer;

    if (instrumentalBuffer) console.log(`[MVSep] Instrumental: ${instrumentalBuffer.byteLength} bytes`);
    if (vocalBuffer) console.log(`[MVSep] Vocal: ${vocalBuffer.byteLength} bytes`);

    setupMixerAudio(instrumentalBuffer, vocalBuffer);

  } catch (err) {
    console.error('[MVSep] Error:', err);
    setState('error', 'Error de comunicacion: ' + err.message);
  }
}

// ============================================================
// BOTON EN YOUTUBE
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
