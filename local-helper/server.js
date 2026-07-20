const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3456;
const MVSEP_API_BASE = 'https://de.mvsep.com/api';
const DEFAULT_API_KEY = process.env.MVSEP_API_KEY || '1Fy0mpljKMTlmesywS135hZ7OBq076';
const SEP_TYPE = 40;
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120;
const TEMP_DIR = path.join(__dirname, 'temp');
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');
const JWT_SECRET = process.env.JWT_SECRET || 'bpmstart_secret_change_me_2026';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const USERS_FILE = path.join(__dirname, 'users.json');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ============================================================
// USERS DATABASE
// ============================================================

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Auth] Error loading users:', e.message);
  }
  return [];
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function isAdmin(email) {
  return ADMIN_EMAIL && email.toLowerCase() === ADMIN_EMAIL;
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Token de autenticacion requerido' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Token invalido o expirado' });
  }
}

function adminMiddleware(req, res, next) {
  if (!isAdmin(req.user.email)) {
    return res.status(403).json({ success: false, error: 'Solo el admin puede hacer esto' });
  }
  next();
}

// Write cookies from env var if provided
const YOUTUBE_COOKIES = process.env.YOUTUBE_COOKIES;
if (YOUTUBE_COOKIES) {
  fs.writeFileSync(COOKIES_PATH, YOUTUBE_COOKIES, 'utf8');
  console.log('[Config] YouTube cookies escritas desde variable de entorno');
} else {
  console.log('[Config] WARNING: No YOUTUBE_COOKIES configurada');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', version: '5.0.0', source: 'yt-dlp+cookies', auth: true });
});

// ============================================================
// AUTH ENDPOINTS
// ============================================================

app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email y password requeridos' });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, error: 'Password minimo 6 caracteres' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, error: 'Email invalido' });
  }

  const users = loadUsers();
  const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    return res.status(409).json({ success: false, error: 'Este email ya esta registrado' });
  }

  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
    email: email.toLowerCase(),
    password: hash,
    approved: isAdmin(email),
    admin: isAdmin(email),
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  saveUsers(users);

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

  console.log(`[Auth] Nuevo usuario: ${user.email} (approved: ${user.approved}, admin: ${user.admin})`);
  res.json({
    success: true,
    token,
    email: user.email,
    approved: user.approved,
    admin: user.admin,
  });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email y password requeridos' });
  }

  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

  if (!user) {
    return res.status(401).json({ success: false, error: 'Email o password incorrecto' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ success: false, error: 'Email o password incorrecto' });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

  console.log(`[Auth] Login: ${user.email} (approved: ${user.approved})`);
  res.json({
    success: true,
    token,
    email: user.email,
    approved: user.approved,
    admin: user.admin || isAdmin(user.email),
  });
});

app.get('/verify', authMiddleware, (req, res) => {
  const users = loadUsers();
  const user = users.find(u => u.email === req.user.email);
  res.json({
    success: true,
    email: req.user.email,
    approved: user?.approved || false,
    admin: user?.admin || isAdmin(req.user.email),
  });
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

app.get('/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = loadUsers();
  const list = users.map(u => ({
    id: u.id,
    email: u.email,
    approved: u.approved || false,
    admin: u.admin || false,
    createdAt: u.createdAt,
  }));
  res.json({ success: true, users: list });
});

app.post('/admin/approve', authMiddleware, adminMiddleware, (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email requerido' });
  }

  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
  }

  user.approved = true;
  saveUsers(users);

  console.log(`[Admin] Usuario aprobado: ${user.email}`);
  res.json({ success: true, message: `${user.email} aprobado` });
});

app.post('/admin/revoke', authMiddleware, adminMiddleware, (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email requerido' });
  }

  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
  }

  if (isAdmin(user.email)) {
    return res.status(400).json({ success: false, error: 'No puedes revocar al admin' });
  }

  user.approved = false;
  saveUsers(users);

  console.log(`[Admin] Acceso revocado: ${user.email}`);
  res.json({ success: true, message: `Acceso de ${user.email} revocado` });
});

app.post('/admin/delete', authMiddleware, adminMiddleware, (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email requerido' });
  }

  if (isAdmin(email)) {
    return res.status(400).json({ success: false, error: 'No puedes eliminar al admin' });
  }

  let users = loadUsers();
  const before = users.length;
  users = users.filter(u => u.email.toLowerCase() !== email.toLowerCase());

  if (users.length === before) {
    return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
  }

  saveUsers(users);
  console.log(`[Admin] Usuario eliminado: ${email}`);
  res.json({ success: true, message: `${email} eliminado` });
});

// ============================================================
// SEPARATE (requiere auth + aprobacion)
// ============================================================

app.post('/separate', authMiddleware, async (req, res) => {
  const users = loadUsers();
  const user = users.find(u => u.email === req.user.email);

  if (!user || (!user.approved && !isAdmin(req.user.email))) {
    return res.status(403).json({
      success: false,
      error: 'Tu cuenta no esta aprobada. Espera a que el admin te apruebe.',
    });
  }

  const { youtubeUrl } = req.body;

  if (!youtubeUrl) {
    return res.status(400).json({ success: false, error: 'Falta youtubeUrl' });
  }

  const mvsepKey = DEFAULT_API_KEY;
  console.log(`[MVSep-Helper] Usuario: ${req.user.email} | Descargando: ${youtubeUrl}`);
  const jobId = 'mvsep_' + Date.now();
  const audioPath = path.join(TEMP_DIR, `${jobId}.mp3`);

  try {
    console.log(`[MVSep-Helper] Obteniendo info...`);
    const infoArgs = ['--dump-json', '--no-playlist'];
    if (YOUTUBE_COOKIES) infoArgs.push('--cookies', COOKIES_PATH);
    infoArgs.push(youtubeUrl);

    const infoJson = await runYtDlp(infoArgs);
    const info = JSON.parse(infoJson);
    const title = (info.title || 'unknown').replace(/[^\w\s]/gi, '').slice(0, 50);
    const duration = parseInt(info.duration || 0);
    console.log(`[MVSep-Helper] Video: "${title}" (${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')})`);

    if (duration > 600) {
      return res.status(400).json({
        success: false,
        error: `El video dura ${Math.floor(duration / 60)} minutos. Maximo: 10 minutos`,
      });
    }

    console.log(`[MVSep-Helper] Descargando audio...`);
    const dlArgs = [
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '-o', audioPath, '--no-playlist', '--no-progress',
    ];
    if (YOUTUBE_COOKIES) dlArgs.push('--cookies', COOKIES_PATH);
    dlArgs.push(youtubeUrl);

    await runYtDlp(dlArgs);

    const stats = fs.statSync(audioPath);
    console.log(`[MVSep-Helper] Audio: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    console.log(`[MVSep-Helper] Subiendo a mvsep.com...`);
    const uploadResult = await uploadToMvsep(audioPath, mvsepKey);
    console.log(`[MVSep-Helper] mvsep:`, JSON.stringify(uploadResult).substring(0, 500));

    const mvsepJobId = uploadResult?.data?.hash || uploadResult?.job_id;
    if (!mvsepJobId) {
      throw new Error(uploadResult?.message || uploadResult?.error || uploadResult?.detail || JSON.stringify(uploadResult) || 'Error al subir a mvsep.com');
    }
    console.log(`[MVSep-Helper] Job: ${mvsepJobId}`);

    console.log(`[MVSep-Helper] Procesando... (30-120s)`);
    const pollResult = await pollMvsepJob(mvsepJobId);
    if (!pollResult.success) {
      throw new Error('Error en procesamiento: ' + (pollResult.error || 'desconocido'));
    }
    console.log(`[MVSep-Helper] Completado.`);

    console.log(`[MVSep-Helper] URLs:`, JSON.stringify(pollResult.downloadUrls).substring(0, 800));
    const downloadResult = await downloadMvsepResults(pollResult.downloadUrls, mvsepKey);
    if (!downloadResult.success) {
      throw new Error('Error al descargar resultados');
    }

    try { fs.unlinkSync(audioPath); } catch (e) { /* ignore */ }

    console.log(`[MVSep-Helper] Instrumental: ${downloadResult.instrumental ? (downloadResult.instrumental.byteLength / 1024).toFixed(1) + ' KB' : 'N/A'}`);
    console.log(`[MVSep-Helper] Vocal: ${downloadResult.vocal ? (downloadResult.vocal.byteLength / 1024).toFixed(1) + ' KB' : 'N/A'}`);

    res.json({
      success: true,
      title,
      duration,
      instrumental: downloadResult.instrumental ? Buffer.from(downloadResult.instrumental).toString('base64') : null,
      vocal: downloadResult.vocal ? Buffer.from(downloadResult.vocal).toString('base64') : null,
      mimeType: 'audio/flac',
    });

  } catch (error) {
    console.error(`[MVSep-Helper] Error:`, error.message);
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (e) { /* ignore */ }
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// YT-DLP
// ============================================================

async function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const child = execFile(cmd, args, {
      maxBuffer: 100 * 1024 * 1024,
      timeout: 120000,
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') {
          reject(new Error('yt-dlp no esta instalado'));
        } else {
          reject(new Error(stderr.trim() || error.message));
        }
        return;
      }
      resolve(stdout);
    });
    child.on('error', (err) => {
      reject(new Error(`Error al ejecutar yt-dlp: ${err.message}`));
    });
  });
}

// ============================================================
// MVSEP.COM
// ============================================================

async function uploadToMvsep(audioPath, apiKey) {
  const form = new FormData();
  const buffer = fs.readFileSync(audioPath);
  const blob = new Blob([buffer], { type: 'audio/flac' });
  form.append('audiofile', blob, 'audio.flac');

  const params = new URLSearchParams({
    api_token: apiKey,
    sep_type: String(SEP_TYPE),
    output_format: '2',
  });
  const url = `${MVSEP_API_BASE}/separation/create?${params.toString()}`;

  console.log(`[MVSep-Helper] Subiendo ${(buffer.length / 1024 / 1024).toFixed(2)} MB...`);

  const response = await fetch(url, { method: 'POST', body: form });
  const responseText = await response.text();
  console.log(`[MVSep-Helper] API (${response.status}):`, responseText.substring(0, 500));

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${responseText.substring(0, 300)}`);
  }

  try {
    return JSON.parse(responseText);
  } catch (e) {
    throw new Error(`Respuesta no es JSON: ${responseText.substring(0, 200)}`);
  }
}

async function pollMvsepJob(jobId) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const url = `${MVSEP_API_BASE}/separation/get?hash=${encodeURIComponent(jobId)}`;
      const response = await fetch(url);
      if (!response.ok) {
        if (attempt === 0) console.log(`[MVSep-Helper] Poll HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      if (attempt < 3 || attempt % 10 === 0) {
        console.log(`[MVSep-Helper] Poll #${attempt + 1}:`, JSON.stringify(data).substring(0, 300));
      }

      const status = (data?.data?.status || data.status || '').toLowerCase();

      if (data.progress !== undefined) {
        console.log(`[MVSep-Helper] Progreso: ${Math.round(data.progress)}%`);
      }

      if (status === 'done' || status === 'completed' || status === 'success') {
        const urls = extractDownloadUrls(data);
        if (urls) return { success: true, downloadUrls: urls };
      }

      if (status === 'error' || status === 'failed') {
        return { success: false, error: data.message || data.error || 'Error en procesamiento' };
      }
    } catch (e) {
      console.warn(`[MVSep-Helper] Poll error (${attempt + 1}):`, e.message);
    }
  }
  return { success: false, error: 'Tiempo de espera agotado' };
}

function extractDownloadUrls(data) {
  if (data?.data?.result) return data.data.result;
  if (data?.data?.download_urls) return data.data.download_urls;
  if (data?.data?.files) return data.data.files;
  if (data?.data?.urls) return data.data.urls;
  if (data.download_urls) return data.download_urls;
  if (data.result?.download_urls) return data.result.download_urls;
  if (data.files) return data.files;
  if (data.urls) return data.urls;
  if (data.download_url || data.url) {
    return { instrumental: data.download_url || data.url, vocal: data.download_url || data.url };
  }
  return null;
}

async function downloadMvsepResults(downloadUrls, apiKey) {
  const result = { success: false, instrumental: null, vocal: null };

  const instrumentalKeys = ['other', 'instrumental', 'drums', 'bass', 'accompaniment', 'music', 'no_vocals'];
  const vocalKeys = ['vocals', 'voice', 'vocal'];

  let instrumentalUrl = null;
  let vocalUrl = null;

  for (const [key, val] of Object.entries(downloadUrls)) {
    const url = typeof val === 'string' ? val : (val?.url || val?.link || val?.download_url || Object.values(val)[0]);
    const kl = key.toLowerCase();
    if (instrumentalKeys.some(k => kl.includes(k))) instrumentalUrl = url;
    else if (vocalKeys.some(k => kl.includes(k))) vocalUrl = url;
  }

  if (!instrumentalUrl && !vocalUrl) {
    console.log(`[MVSep-Helper] URLs raw:`, JSON.stringify(downloadUrls).substring(0, 500));
    const entries = Object.entries(downloadUrls);
    const urls = entries.map(([, val]) => typeof val === 'string' ? val : (val?.url || val?.link || val?.download_url || Object.values(val)[0]));
    if (urls.length >= 2) { instrumentalUrl = urls[0]; vocalUrl = urls[1]; }
    else if (urls.length === 1) { vocalUrl = urls[0]; }
  }

  const downloads = [];
  const baseUrl = 'https://de.mvsep.com';

  if (vocalUrl) {
    const urlStr = typeof vocalUrl !== 'string' ? JSON.stringify(vocalUrl) : vocalUrl;
    const fullUrl = urlStr.startsWith('http') ? urlStr : baseUrl + urlStr;
    console.log(`[MVSep-Helper] Descargando vocal: ${fullUrl.substring(0, 120)}`);
    downloads.push(
      fetchWithAuth(fullUrl, apiKey).then(async (r) => {
        console.log(`[MVSep-Helper] Vocal status: ${r.status}`);
        if (r.ok) { result.vocal = await r.arrayBuffer(); console.log(`[MVSep-Helper] Vocal: ${result.vocal.byteLength} bytes`); }
      })
    );
  }
  if (instrumentalUrl) {
    const urlStr = typeof instrumentalUrl !== 'string' ? JSON.stringify(instrumentalUrl) : instrumentalUrl;
    const fullUrl = urlStr.startsWith('http') ? urlStr : baseUrl + urlStr;
    console.log(`[MVSep-Helper] Descargando instrumental: ${fullUrl.substring(0, 120)}`);
    downloads.push(
      fetchWithAuth(fullUrl, apiKey).then(async (r) => {
        console.log(`[MVSep-Helper] Instrumental status: ${r.status}`);
        if (r.ok) { result.instrumental = await r.arrayBuffer(); console.log(`[MVSep-Helper] Instrumental: ${result.instrumental.byteLength} bytes`); }
      })
    );
  }

  await Promise.all(downloads);
  result.success = !!(result.instrumental || result.vocal);
  return result;
}

async function fetchWithAuth(url, apiKey) {
  const sep = url.includes('?') ? '&' : '?';
  return fetch(`${url}${sep}api_token=${encodeURIComponent(apiKey)}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// START
// ============================================================

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       MVSep - Helper Server v5.0.0          ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Puerto: ${PORT}                              ║`);
  console.log(`║  Admin:  ${ADMIN_EMAIL || 'NO CONFIGURADO'}           ║`);
  console.log('║  Auth:   register + login + admin approval   ║');
  console.log(`║  Cookies: ${YOUTUBE_COOKIES ? 'SI' : 'NO'}                                 ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  const users = loadUsers();
  const approved = users.filter(u => u.approved).length;
  console.log(`[MVSep-Helper] ${users.length} usuarios (${approved} aprobados)`);
});
