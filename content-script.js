// ============================================================
// BPMSTART - Content Script (YouTube)
// Mixer tipo Moises: stems dinámicos con Solo/Mute/Waveform
// ============================================================

const STEM_DEFS = [
  { id: 'instrumental', label: 'Instrumental', color: '#2ecc71', icon: '🎸' },
  { id: 'vocal',        label: 'Vocal',        color: '#3498db', icon: '🎤' },
  // Futuro: descomentar para agregar más stems
  // { id: 'drums', label: 'Drums', color: '#e74c3c', icon: '🥁' },
  // { id: 'bass',  label: 'Bass',  color: '#f39c12', icon: '🎸' },
  // { id: 'piano', label: 'Piano', color: '#9b59b6', icon: '🎹' },
];

const state = {
  status: 'idle',
  message: '',
  progress: 0,
  isPanelVisible: true,
  playing: false,
};

let panel = null;
let timelineInterval = null;
let waveformCanvas = null;
let waveformCtx = null;
let waveformBuffer = null;
let audioCtx = null;

// ============================================================
// DRAG
// ============================================================

let dragState = { active: false, offsetX: 0, offsetY: 0 };

function initDrag() {
  if (!panel) return;
  const header = panel.querySelector('.mvsep-header');
  if (!header) return;
  header.style.cursor = 'grab';

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.mvsep-btn-icon')) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    dragState.active = true;
    dragState.offsetX = e.clientX - rect.left;
    dragState.offsetY = e.clientY - rect.top;
    panel.classList.add('mvsep-dragging');
    header.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragState.active) return;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    let x = e.clientX - dragState.offsetX;
    let y = e.clientY - dragState.offsetY;
    x = Math.max(0, Math.min(x, window.innerWidth - w));
    y = Math.max(0, Math.min(y, window.innerHeight - h));
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.style.right = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (!dragState.active) return;
    dragState.active = false;
    panel.classList.remove('mvsep-dragging');
    const header = panel.querySelector('.mvsep-header');
    if (header) header.style.cursor = 'grab';
    savePanelPosition();
  });
}

function savePanelPosition() {
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  try {
    localStorage.setItem('mvsep_panel_pos', JSON.stringify({ left: rect.left, top: rect.top }));
  } catch (e) { /* ignore */ }
}

function restorePanelPosition() {
  if (!panel) return;
  try {
    const saved = localStorage.getItem('mvsep_panel_pos');
    if (saved) {
      const pos = JSON.parse(saved);
      panel.style.left = pos.left + 'px';
      panel.style.top = pos.top + 'px';
      panel.style.right = 'auto';
    }
  } catch (e) { /* ignore */ }
}

// ============================================================
// STEM MODEL
// ============================================================

const stems = STEM_DEFS.map(def => ({
  ...def,
  buffer: null,
  audio: null,
  volume: 1,
  muted: false,
  solo: false,
}));

function getStem(id) {
  return stems.find(s => s.id === id);
}

function anySoloActive() {
  return stems.some(s => s.solo);
}

function getEffectiveVolume(stem) {
  if (stem.muted) return 0;
  if (anySoloActive()) return stem.solo ? stem.volume : 0;
  return stem.volume;
}

function applyVolumes() {
  stems.forEach(s => {
    if (s.audio) {
      s.audio.volume = getEffectiveVolume(s);
    }
  });
}

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
      <p class="mvsep-description">Separa vocal e instrumental de cualquier cancion</p>

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

      <div class="mvsep-state mvsep-state-processing mvsep-hidden">
        <div class="mvsep-spinner"></div>
        <span class="mvsep-status-text" id="mvsep-processing-text">Conectando...</span>
        <div class="mvsep-progress-bar">
          <div class="mvsep-progress-fill" id="mvsep-progress-fill"></div>
        </div>
        <span class="mvsep-progress-text" id="mvsep-progress-text">0%</span>
        <button class="mvsep-btn-secondary mvsep-btn-stop" id="mvsep-btn-stop">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg>
          Cancelar
        </button>
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

        <div class="mvsep-waveform-wrap">
          <canvas id="mvsep-waveform"></canvas>
        </div>

        <div class="mvsep-mixer" id="mvsep-mixer"></div>

        <div class="mvsep-actions-secondary" id="mvsep-download-buttons"></div>

        <button class="mvsep-btn-secondary mvsep-btn-new" id="mvsep-btn-separate-again">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Nueva separacion
        </button>
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
          Separar Audio
        </button>
      </div>
    </div>

    <div class="mvsep-history-section" id="mvsep-history-section">
      <div class="mvsep-history-header">
        <span>Historial</span>
        <button class="mvsep-btn-icon" id="mvsep-history-toggle" title="Limpiar historial">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
      <div class="mvsep-history-list" id="mvsep-history-list"></div>
    </div>
  `;

  document.body.appendChild(panel);
  waveformCanvas = panel.querySelector('#mvsep-waveform');
  waveformCtx = waveformCanvas?.getContext('2d');
  setupEventListeners();
  renderMixer();
  initDrag();
  restorePanelPosition();
  renderHistory();
}

// ============================================================
// RENDER MIXER (generado desde stems[])
// ============================================================

function renderMixer() {
  const container = panel?.querySelector('#mvsep-mixer');
  if (!container) return;
  container.innerHTML = '';

  stems.forEach(stem => {
    const row = document.createElement('div');
    row.className = 'mvsep-mixer-track';
    row.dataset.stem = stem.id;
    row.style.setProperty('--stem-color', stem.color);

    row.innerHTML = `
      <div class="mvsep-mixer-left">
        <span class="mvsep-mixer-dot" style="background:${stem.color}"></span>
        <span class="mvsep-mixer-name">${stem.label}</span>
      </div>
      <button class="mvsep-solo-btn" data-stem="${stem.id}" title="Solo ${stem.label}">S</button>
      <input type="range" class="mvsep-mixer-slider" data-stem="${stem.id}"
             min="0" max="100" value="${stem.volume * 100}" style="--slider-color:${stem.color}">
      <button class="mvsep-mute-btn" data-stem="${stem.id}" title="Silenciar ${stem.label}">
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
    `;

    container.appendChild(row);
  });

  bindMixerEvents();
}

function renderDownloadButtons() {
  const container = panel?.querySelector('#mvsep-download-buttons');
  if (!container) return;
  container.innerHTML = '';

  stems.forEach(s => {
    if (!s.buffer) return;
    const btn = document.createElement('button');
    btn.className = 'mvsep-btn-secondary';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      ${s.label}
    `;
    btn.addEventListener('click', () => downloadStem(s));
    container.appendChild(btn);
  });
}

// ============================================================
// MIXER EVENTS
// ============================================================

function bindMixerEvents() {
  if (!panel) return;

  panel.querySelectorAll('.mvsep-mixer-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
      const stem = getStem(e.target.dataset.stem);
      if (stem) setStemVolume(stem.id, e.target.value / 100);
    });
  });

  panel.querySelectorAll('.mvsep-mute-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const stemId = btn.dataset.stem;
      toggleMute(stemId);
    });
  });

  panel.querySelectorAll('.mvsep-solo-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const stemId = btn.dataset.stem;
      toggleSolo(stemId);
    });
  });
}

// ============================================================
// SOLO / MUTE LOGIC
// ============================================================

function setStemVolume(stemId, value) {
  const stem = getStem(stemId);
  if (!stem) return;
  stem.volume = value;
  stem.muted = value === 0;
  if (stem.audio) stem.audio.volume = getEffectiveVolume(stem);
  updateStemUI(stemId);
}

function toggleMute(stemId) {
  const stem = getStem(stemId);
  if (!stem) return;

  stem.muted = !stem.muted;
  if (stem.muted) stem.solo = false;

  if (stem.audio) stem.audio.volume = getEffectiveVolume(stem);

  if (!stem.muted) {
    const slider = panel?.querySelector(`.mvsep-mixer-slider[data-stem="${stemId}"]`);
    if (slider && stem.volume === 0) {
      stem.volume = 1;
      slider.value = 100;
    }
  }

  updateAllStemUI();
}

function toggleSolo(stemId) {
  const stem = getStem(stemId);
  if (!stem) return;

  stem.solo = !stem.solo;
  if (stem.solo) stem.muted = false;

  applyVolumes();
  updateAllStemUI();
}

function updateStemUI(stemId) {
  const stem = getStem(stemId);
  if (!stem || !panel) return;

  const row = panel.querySelector(`.mvsep-mixer-track[data-stem="${stemId}"]`);
  if (!row) return;

  const effectiveVol = getEffectiveVolume(stem);
  const isActive = effectiveVol > 0;

  row.classList.toggle('muted', stem.muted && !stem.solo);
  row.classList.toggle('solo-active', stem.solo);
  row.classList.toggle('stem-active', isActive);

  const muteIconOn = row.querySelector('.mvsep-mute-icon-on');
  const muteIconOff = row.querySelector('.mvsep-mute-icon-off');
  if (muteIconOn) muteIconOn.style.display = stem.muted ? 'none' : 'block';
  if (muteIconOff) muteIconOff.style.display = stem.muted ? 'block' : 'none';

  const soloBtn = row.querySelector('.mvsep-solo-btn');
  if (soloBtn) soloBtn.classList.toggle('active', stem.solo);
}

function updateAllStemUI() {
  stems.forEach(s => updateStemUI(s.id));
}

// ============================================================
// WAVEFORM
// ============================================================

async function renderWaveform(arrayBuffer) {
  if (!waveformCanvas || !waveformCtx) return;

  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    waveformBuffer = decoded;
    drawWaveform(0);
  } catch (e) {
    console.warn('[MVSep] Waveform decode error:', e);
    drawWaveformFallback();
  }
}

function drawWaveform(progressRatio) {
  if (!waveformCtx || !waveformBuffer || !waveformCanvas) return;

  const canvas = waveformCanvas;
  const ctx = waveformCtx;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const data = waveformBuffer.getChannelData(0);
  const step = Math.ceil(data.length / width);
  const amp = height / 2;

  ctx.clearRect(0, 0, width, height);

  const primaryStem = stems[0];
  const color = primaryStem?.color || '#ff4444';

  for (let i = 0; i < width; i++) {
    let min = 1.0;
    let max = -1.0;
    for (let j = 0; j < step; j++) {
      const datum = data[(i * step) + j];
      if (datum !== undefined) {
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
    }

    const isPlayed = (i / width) <= progressRatio;
    ctx.fillStyle = isPlayed ? color : 'rgba(255,255,255,0.15)';
    ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
  }
}

function drawWaveformFallback() {
  if (!waveformCtx || !waveformCanvas) return;
  const canvas = waveformCanvas;
  const ctx = waveformCtx;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 0, rect.width, rect.height);
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
  panel.querySelector('#mvsep-history-toggle')?.addEventListener('click', clearHistory);

  panel.querySelector('#mvsep-play-btn')?.addEventListener('click', togglePlay);

  const timeline = panel.querySelector('#mvsep-timeline');
  if (timeline) {
    let seeking = false;

    timeline.addEventListener('input', (e) => {
      seeking = true;
      const ref = getPrimaryAudio();
      if (ref) {
        const time = (e.target.value / 100) * ref.duration;
        updateTimeDisplay(time, ref.duration);
      }
    });

    timeline.addEventListener('change', (e) => {
      const ref = getPrimaryAudio();
      if (ref) {
        const time = (e.target.value / 100) * ref.duration;
        stems.forEach(s => { if (s.audio) s.audio.currentTime = time; });
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
    initializing: '.mvsep-state-processing',
    processing: '.mvsep-state-processing',
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

  if (state.status === 'processing' || state.status === 'initializing') {
    const processingText = panel.querySelector('#mvsep-processing-text');
    if (processingText) {
      processingText.textContent = state.message || 'Procesando...';
    }
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

  if (status === 'processing' || status === 'initializing') showPanel();

  updateUI();
}

// ============================================================
// PLAYER: PLAY / PAUSE / SEEK / TIMELINE
// ============================================================

function getPrimaryAudio() {
  return stems.find(s => s.audio)?.audio || null;
}

function togglePlay() {
  const ref = getPrimaryAudio();
  if (!ref) return;
  if (ref.paused) playMixer(); else pauseMixer();
}

function playMixer() {
  stems.forEach(s => {
    if (s.audio) {
      s.audio.volume = getEffectiveVolume(s);
      s.audio.play().catch(() => {});
    }
  });
  state.playing = true;
  updatePlayButton();
  startTimelineUpdate();
}

function pauseMixer() {
  stems.forEach(s => { if (s.audio) s.audio.pause(); });
  state.playing = false;
  updatePlayButton();
  stopTimelineUpdate();
}

function stopPlayback() {
  stems.forEach(s => {
    if (s.audio) { s.audio.pause(); s.audio.currentTime = 0; }
  });
  state.playing = false;
  updatePlayButton();
  stopTimelineUpdate();
  updateTimeDisplay(0, getPrimaryAudio()?.duration || 0);
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
  if (timelineInterval) { clearInterval(timelineInterval); timelineInterval = null; }
}

function updateTimelineProgress() {
  const ref = getPrimaryAudio();
  if (!ref || panel?._timelineSeeking?.()) return;

  const current = ref.currentTime;
  const total = ref.duration;
  if (!total || !isFinite(total)) return;

  // Sync all stems to prevent drift
  stems.forEach(s => {
    if (s.audio && s.audio !== ref && !s.audio.paused) {
      const drift = Math.abs(s.audio.currentTime - current);
      if (drift > 0.05) {
        s.audio.currentTime = current;
      }
    }
  });

  updateTimeline((current / total) * 100);
  updateTimeDisplay(current, total);

  if (waveformBuffer) drawWaveform(current / total);
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
// AUDIO SETUP
// ============================================================

function createAudioElement(arrayBuffer) {
  const blob = new Blob([arrayBuffer], { type: 'audio/flac' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = 'auto';
  return audio;
}

function setupMixerAudio() {
  stopPlayback();

  stems.forEach(s => {
    if (s.audio) { s.audio.src = ''; s.audio = null; }
  });
  stopTimelineUpdate();

  stems.forEach(s => {
    if (s.buffer) {
      s.audio = createAudioElement(s.buffer);
      s.audio.volume = getEffectiveVolume(s);
    }
  });

  const ref = getPrimaryAudio();
  if (!ref) return;

  ref.addEventListener('loadedmetadata', () => {
    updateTimeDisplay(0, ref.duration);
    console.log(`[BPMSTART] Audio cargado: ${formatTime(ref.duration)}`);
  });

  ref.addEventListener('ended', () => {
    stems.forEach(s => { if (s.audio && !s.audio.paused) s.audio.pause(); });
    state.playing = false;
    updatePlayButton();
    stopTimelineUpdate();
    updateTimeline(0);
    updateTimeDisplay(0, ref.duration);
    if (waveformBuffer) drawWaveform(0);
  });

  ref.addEventListener('error', (e) => {
    console.error('[BPMSTART] Audio error:', e);
    state.playing = false;
    updatePlayButton();
  });

  // Sync all stems on seeking
  ref.addEventListener('seeking', () => {
    stems.forEach(s => {
      if (s.audio && s.audio !== ref) s.audio.currentTime = ref.currentTime;
    });
  });

  renderMixer();
  renderDownloadButtons();

  // Render waveform
  const primaryBuf = stems.find(s => s.buffer)?.buffer;
  if (primaryBuf) renderWaveform(primaryBuf);
}

// ============================================================
// SEPARATION FLOW
// ============================================================

async function startSeparation() {
  const video = document.querySelector('video');
  if (!video) {
    setState('error', 'Abre un video de YouTube primero.');
    return;
  }

  if (!window.location.hostname.includes('youtube.com')) {
    setState('error', 'Esta funcion solo funciona en YouTube.');
    return;
  }

  stopPlayback();
  stems.forEach(s => { s.buffer = null; s.audio = null; });

  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get('v');

  setState('initializing', 'Conectando...');

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
}

// ============================================================
// DOWNLOAD
// ============================================================

function downloadStem(stem) {
  if (!stem.buffer) return;
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
  const blob = new Blob([stem.buffer], { type: 'audio/flac' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${stem.id}_${timestamp}.flac`;
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

  const totalChunksKey = `totalChunks${track.charAt(0).toUpperCase() + track.slice(1)}`;
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
  console.log('[BPMSTART] Separacion completada, pidiendo resultados...');
  setState('complete', message || 'Pistas listas!');

  try {
    for (const stem of stems) {
      const buffer = await receiveTrackChunks(stem.id);
      if (buffer) {
        stem.buffer = buffer;
        console.log(`[BPMSTART] ${stem.label}: ${buffer.byteLength} bytes`);
      }
    }

    const anyBuffer = stems.some(s => s.buffer);
    if (!anyBuffer) {
      setState('error', 'No se recibieron pistas');
      return;
    }

    setupMixerAudio();
    saveToHistory();

  } catch (err) {
    console.error('[BPMSTART] Error:', err);
    setState('error', 'Error de comunicacion: ' + err.message);
  }
}

// ============================================================
// HISTORIAL (IndexedDB + chrome.storage.local)
// ============================================================

const DB_NAME = 'bpmstart_db';
const STORE_NAME = 'stem_audio';
let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => { dbInstance = req.result; resolve(dbInstance); };
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function saveToHistory() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v') || '';
    const title = document.title.replace(' - YouTube', '').trim() || 'Unknown';
    const thumb = videoId ? `https://img.youtube.com/vi/${videoId}/default.jpg` : '';
    const jobId = 'h_' + Date.now();
    const stemsInfo = stems.filter(s => s.buffer).map(s => s.id);

    await idbPut(`${jobId}_meta`, { videoId, title, thumb, date: Date.now(), stems: stemsInfo });
    for (const s of stems) {
      if (s.buffer) await idbPut(`${jobId}_${s.id}`, s.buffer);
    }

    const stored = await chrome.storage.local.get(['history']);
    const history = stored.history || [];
    history.unshift({ jobId, videoId, title, thumb, date: Date.now(), stems: stemsInfo });
    if (history.length > 20) {
      const removed = history.splice(20);
      for (const item of removed) {
        for (const s of (item.stems || [])) await idbDelete(`${item.jobId}_${s}`).catch(() => {});
        await idbDelete(`${item.jobId}_meta`).catch(() => {});
      }
    }
    await chrome.storage.local.set({ history });
    renderHistory();
    console.log('[BPMSTART] Guardado en historial:', title);
  } catch (e) {
    console.warn('[BPMSTART] Error guardando historial:', e);
  }
}

async function renderHistory() {
  const list = panel?.querySelector('#mvsep-history-list');
  if (!list) return;

  try {
    const stored = await chrome.storage.local.get(['history']);
    const history = stored.history || [];
    list.innerHTML = '';

    if (history.length === 0) {
      list.innerHTML = '<div class="mvsep-history-empty">Sin separaciones previas</div>';
      return;
    }

    for (const item of history) {
      const el = document.createElement('div');
      el.className = 'mvsep-history-item';
      el.dataset.jobId = item.jobId;
      const dateStr = new Date(item.date).toLocaleDateString('es', { day: 'numeric', month: 'short' });
      el.innerHTML = `
        <div class="mvsep-history-thumb">${item.thumb ? `<img src="${item.thumb}">` : '<div class="mvsep-history-nothumb">🎵</div>'}</div>
        <div class="mvsep-history-info">
          <div class="mvsep-history-title">${escapeHtml(item.title)}</div>
          <div class="mvsep-history-meta">${dateStr} · ${item.stems.length} stems</div>
        </div>
      `;
      el.addEventListener('click', () => loadFromHistory(item.jobId));
      list.appendChild(el);
    }
  } catch (e) {
    console.warn('[BPMSTART] Error renderizando historial:', e);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadFromHistory(jobId) {
  try {
    const meta = await idbGet(`${jobId}_meta`);
    if (!meta) { console.warn('[BPMSTART] No encontrado:', jobId); return; }

    stopPlayback();
    stems.forEach(s => { s.buffer = null; s.audio = null; });

    for (const stemId of meta.stems) {
      const buf = await idbGet(`${jobId}_${stemId}`);
      if (buf) {
        const stem = getStem(stemId);
        if (stem) stem.buffer = buf;
      }
    }

    if (!stems.some(s => s.buffer)) {
      setState('error', 'Audio no disponible en cache');
      return;
    }

    setState('complete', 'Cargado del historial');
    setupMixerAudio();
    showPanel();
    console.log('[BPMSTART] Cargado del historial:', meta.title);
  } catch (e) {
    console.error('[BPMSTART] Error cargando historial:', e);
    setState('error', 'Error al cargar historial');
  }
}

async function clearHistory() {
  try {
    const stored = await chrome.storage.local.get(['history']);
    const history = stored.history || [];
    for (const item of history) {
      for (const s of (item.stems || [])) await idbDelete(`${item.jobId}_${s}`).catch(() => {});
      await idbDelete(`${item.jobId}_meta`).catch(() => {});
    }
    await chrome.storage.local.set({ history: [] });
    renderHistory();
    console.log('[BPMSTART] Historial limpiado');
  } catch (e) {
    console.warn('[BPMSTART] Error limpiando historial:', e);
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
