// ============================================================
// MVSep - Local Helper Server
// Descarga audio de YouTube con yt-dlp, lo sube a mvsep.com,
// y devuelve las pistas separadas (instrumental + vocal)
// ============================================================
// Uso: npm install && node server.js
// Escucha en http://localhost:3456
// Requiere: yt-dlp instalado en el sistema
// ============================================================

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execFile, execSync } = require('child_process');

// ============================================================
// CONFIGURACIÓN
// ============================================================

const PORT = process.env.PORT || 3456;
const MVSEP_API_BASE = 'https://de.mvsep.com/api';
const DEFAULT_API_KEY = process.env.MVSEP_API_KEY || '1Fy0mpljKMTlmesywS135hZ7OBq076';
const SEP_TYPE = 40; // BS Roformer (vocals, instrumental) - keys correctas
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120;
const TEMP_DIR = path.join(__dirname, 'temp');

// Asegurar que existe el directorio temp
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============================================================
// ENDPOINT: Health check
// ============================================================

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// ============================================================
// ENDPOINT PRINCIPAL: Separar audio de YouTube
// POST /separate
// Body: { youtubeUrl: string, apiKey?: string }
// ============================================================

app.post('/separate', async (req, res) => {
  const { youtubeUrl, apiKey } = req.body;

  if (!youtubeUrl) {
    return res.status(400).json({ success: false, error: 'Falta youtubeUrl' });
  }

  const mvsepKey = apiKey || DEFAULT_API_KEY;
  console.log(`[MVSep-Helper] API key recibida: ${mvsepKey ? mvsepKey.substring(0, 8) + '...' : 'VACÍA'}`);
  console.log(`[MVSep-Helper] apiKey del body: ${apiKey ? apiKey.substring(0, 8) + '...' : 'VACÍA'}`);
  const jobId = 'mvsep_local_' + Date.now();
  const audioPath = path.join(TEMP_DIR, `${jobId}.mp3`);

  try {
    // 1. OBTENER INFO DEL VIDEO CON yt-dlp
    console.log(`[MVSep-Helper] Obteniendo info: ${youtubeUrl}`);
    const infoJson = await runYtDlp([
      '--dump-json',
      '--no-playlist',
      '--extractor-args', 'youtube:player_client=web',
      youtubeUrl,
    ]);

    const info = JSON.parse(infoJson);
    const title = (info.title || 'unknown').replace(/[^\w\s]/gi, '').slice(0, 50);
    const duration = parseInt(info.duration || 0);
    console.log(`[MVSep-Helper] Video: "${title}" (${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')})`);

    if (duration > 600) {
      return res.status(400).json({
        success: false,
        error: `El video dura ${Math.floor(duration / 60)} minutos. Máximo permitido: 10 minutos (plan gratis)`,
      });
    }

    // 2. DESCARGAR AUDIO CON yt-dlp
    console.log(`[MVSep-Helper] Descargando audio...`);
    await runYtDlp([
      '-x',                          // Extraer audio
      '--audio-format', 'mp3',       // Convertir a MP3
      '--audio-quality', '0',        // Mejor calidad (320kbps)
      '-o', audioPath,               // Archivo de salida
      '--no-playlist',
      '--no-progress',
      '--extractor-args', 'youtube:player_client=web',
      youtubeUrl,
    ]);

    const stats = fs.statSync(audioPath);
    console.log(`[MVSep-Helper] Audio descargado: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // 3. SUBIR A MVSEP.COM
    console.log(`[MVSep-Helper] Subiendo a mvsep.com...`);
    const uploadResult = await uploadToMvsep(audioPath, mvsepKey);

    console.log(`[MVSep-Helper] Respuesta completa de mvsep:`, JSON.stringify(uploadResult).substring(0, 500));

    // Nuevo formato: { success: true, data: { hash, link } }
    // Formato viejo: { success: true, job_id: "..." }
    const mvsepJobId = uploadResult?.data?.hash || uploadResult?.job_id;
    if (!mvsepJobId) {
      const errMsg = uploadResult?.message || uploadResult?.error || uploadResult?.detail || JSON.stringify(uploadResult) || 'Error al subir a mvsep.com';
      throw new Error(errMsg);
    }
    console.log(`[MVSep-Helper] Job creado: ${mvsepJobId}`);

    // 4. POLLEAR HASTA COMPLETAR
    console.log(`[MVSep-Helper] Procesando... (esto puede tomar 30-120s)`);
    const pollResult = await pollMvsepJob(mvsepJobId, mvsepKey);

    if (!pollResult.success) {
      throw new Error('Error en procesamiento: ' + (pollResult.error || 'desconocido'));
    }

    console.log(`[MVSep-Helper] Procesamiento completado. Descargando resultados...`);

    // 5. DESCARGAR RESULTADOS
    console.log(`[MVSep-Helper] URLs de descarga:`, JSON.stringify(pollResult.downloadUrls).substring(0, 800));
    const downloadResult = await downloadMvsepResults(pollResult.downloadUrls, mvsepKey);

    if (!downloadResult.success) {
      throw new Error('Error al descargar resultados');
    }

    // 6. LIMPIAR ARCHIVO TEMPORAL
    try { fs.unlinkSync(audioPath); } catch (e) { /* ignore */ }

    // 7. ENVIAR RESPUESTA
    console.log(`[MVSep-Helper] Enviando resultados...`);
    console.log(`  - Instrumental: ${downloadResult.instrumental ? (downloadResult.instrumental.byteLength / 1024).toFixed(1) + ' KB' : 'N/A'}`);
    console.log(`  - Vocal: ${downloadResult.vocal ? (downloadResult.vocal.byteLength / 1024).toFixed(1) + ' KB' : 'N/A'}`);

    res.json({
      success: true,
      title,
      duration,
      instrumental: downloadResult.instrumental
        ? Buffer.from(downloadResult.instrumental).toString('base64')
        : null,
      vocal: downloadResult.vocal
        ? Buffer.from(downloadResult.vocal).toString('base64')
        : null,
      mimeType: 'audio/flac',
    });

  } catch (error) {
    console.error(`[MVSep-Helper] Error:`, error.message);

    // Limpiar archivo temporal si existe
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (e) { /* ignore */ }

    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// FUNCIÓN: EJECUTAR yt-dlp
// ============================================================

async function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    // Buscar yt-dlp en PATH o en ubicaciones comunes
    const cmd = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';

    const child = execFile(cmd, args, {
      maxBuffer: 100 * 1024 * 1024, // 100MB
      timeout: 120000, // 2 minutos
    }, (error, stdout, stderr) => {
      if (error) {
        // Si el error es porque no encuentra el comando, dar mensaje claro
        if (error.code === 'ENOENT') {
          reject(new Error(
            'yt-dlp no está instalado. Instálalo con:\n' +
            '  pip install yt-dlp\n' +
            '  O descarga: https://github.com/yt-dlp/yt-dlp/releases'
          ));
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
// FUNCIONES MVSEP.COM
// ============================================================

async function uploadToMvsep(audioPath, apiKey) {
  // Usar FormData NATIVO de Node.js (disponible desde Node 18+)
  // El paquete 'form-data' de npm NO es compatible con fetch() nativo
  const form = new FormData();
  const buffer = fs.readFileSync(audioPath);
    const blob = new Blob([buffer], { type: 'audio/flac' });
  form.append('audiofile', blob, 'audio.flac');

  // Todos los parámetros en la URL (api_token, sep_type, output_format)
  const params = new URLSearchParams({
    api_token: apiKey,
    sep_type: String(SEP_TYPE),
    output_format: '2',  // 2 = flac lossless 16bit
  });
  const url = `${MVSEP_API_BASE}/separation/create?${params.toString()}`;
  
  console.log(`[MVSep-Helper] Subiendo ${(buffer.length / 1024 / 1024).toFixed(2)} MB a mvsep.com...`);

    const response = await fetch(url, {
      method: 'POST',
      body: form,
    });

    const responseText = await response.text();
    console.log(`[MVSep-Helper] Respuesta API (${response.status}):`, responseText.substring(0, 500));

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${responseText.substring(0, 300)}`);
    }

    try {
      return JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Respuesta no es JSON válido: ${responseText.substring(0, 200)}`);
    }
}

async function pollMvsepJob(jobId, apiKey) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    try {
      // Nuevo endpoint: /api/separation/get?hash=...  (sin api_token)
      // Formato viejo: /api/separation/status?api_token=...&job_id=...
      const url = `${MVSEP_API_BASE}/separation/get?hash=${encodeURIComponent(jobId)}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (attempt === 0) console.log(`[MVSep-Helper] Poll status HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      // Log solo los primeros intentos para no llenar la consola
      if (attempt < 3 || attempt % 10 === 0) {
        console.log(`[MVSep-Helper] Poll #${attempt + 1}:`, JSON.stringify(data).substring(0, 300));
      }

      // Nuevo formato puede tener status en data.status o data.data.status
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
      console.warn(`[MVSep-Helper] Error polling (intento ${attempt + 1}):`, e.message);
    }
  }

  return { success: false, error: 'Tiempo de espera agotado' };
}

function extractDownloadUrls(data) {
  // Nuevo formato: { success: true, data: { status: "done", result: { vocals: "...", instrumental: "..." } } }
  if (data?.data?.result) return data.data.result;
  if (data?.data?.download_urls) return data.data.download_urls;
  if (data?.data?.files) return data.data.files;
  if (data?.data?.urls) return data.data.urls;
  // Formato viejo
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
    // val puede ser string u objeto { url: "..." } o { link: "..." }
    const url = typeof val === 'string' ? val : (val?.url || val?.link || val?.download_url || Object.values(val)[0]);
    const kl = key.toLowerCase();
    if (instrumentalKeys.some(k => kl.includes(k))) instrumentalUrl = url;
    else if (vocalKeys.some(k => kl.includes(k))) vocalUrl = url;
  }

  if (!instrumentalUrl && !vocalUrl) {
    console.log(`[MVSep-Helper] URLs de descarga (raw):`, JSON.stringify(downloadUrls).substring(0, 500));
    const entries = Object.entries(downloadUrls);
    const urls = entries.map(([k, val]) => typeof val === 'string' ? val : (val?.url || val?.link || val?.download_url || Object.values(val)[0]));
    if (urls.length >= 2) {
      instrumentalUrl = urls[0];
      vocalUrl = urls[1];
    } else if (urls.length === 1) {
      vocalUrl = urls[0];
    }
  }

  const downloads = [];
  const baseUrl = 'https://de.mvsep.com';

  if (vocalUrl) {
    const urlStr = typeof vocalUrl !== 'string' ? JSON.stringify(vocalUrl) : vocalUrl;
    const fullUrl = urlStr.startsWith('http') ? urlStr : baseUrl + urlStr;
    console.log(`[MVSep-Helper] Descargando vocal: ${fullUrl.substring(0, 120)}`);
    downloads.push(
      fetchWithAuth(fullUrl, apiKey).then(async (r) => {
        console.log(`[MVSep-Helper] Vocal status: ${r.status}, content-type: ${r.headers.get('content-type')}`);
        if (r.ok) {
          result.vocal = await r.arrayBuffer();
          console.log(`[MVSep-Helper] Vocal descargado: ${result.vocal.byteLength} bytes`);
          // Verificar que empieza con header MP3 (FF FB o ID3)
          const header = new Uint8Array(result.vocal.slice(0, 4));
          console.log(`[MVSep-Helper] Vocal header hex: ${header[0].toString(16)} ${header[1].toString(16)} ${header[2].toString(16)} ${header[3].toString(16)}`);
        }
      })
    );
  }
  if (instrumentalUrl) {
    const urlStr = typeof instrumentalUrl !== 'string' ? JSON.stringify(instrumentalUrl) : instrumentalUrl;
    const fullUrl = urlStr.startsWith('http') ? urlStr : baseUrl + urlStr;
    console.log(`[MVSep-Helper] Descargando instrumental: ${fullUrl.substring(0, 120)}`);
    downloads.push(
      fetchWithAuth(fullUrl, apiKey).then(async (r) => {
        console.log(`[MVSep-Helper] Instrumental status: ${r.status}, content-type: ${r.headers.get('content-type')}`);
        if (r.ok) {
          result.instrumental = await r.arrayBuffer();
          console.log(`[MVSep-Helper] Instrumental descargado: ${result.instrumental.byteLength} bytes`);
          const header = new Uint8Array(result.instrumental.slice(0, 4));
          console.log(`[MVSep-Helper] Instrumental header hex: ${header[0].toString(16)} ${header[1].toString(16)} ${header[2].toString(16)} ${header[3].toString(16)}`);
        }
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
// INICIAR SERVIDOR
// ============================================================

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       MVSep - Local Helper Server           ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Puerto: ${PORT}                              ║`);
  console.log('║  Endpoint: POST /separate                    ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('[MVSep-Helper] Servidor listo! Esperando peticiones...');
});
