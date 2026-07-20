// ============================================================
// MVSep - Local Helper Server
// Descarga audio de YouTube via Cobalt API, lo sube a mvsep.com,
// y devuelve las pistas separadas (instrumental + vocal)
// ============================================================
// Uso: npm install && node server.js
// ============================================================

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIGURACIÓN
// ============================================================

const PORT = process.env.PORT || 3456;
const MVSEP_API_BASE = 'https://de.mvsep.com/api';
const DEFAULT_API_KEY = process.env.MVSEP_API_KEY || '1Fy0mpljKMTlmesywS135hZ7OBq076';
let COBALT_API_URL = process.env.COBALT_API_URL || 'https://api.cobalt.tools';
console.log(`[Config] COBALT_API_URL raw: "${process.env.COBALT_API_URL}"`);
if (!COBALT_API_URL.startsWith('http')) COBALT_API_URL = 'https://' + COBALT_API_URL;
COBALT_API_URL = COBALT_API_URL.replace(/\/+$/, '');
console.log(`[Config] COBALT_API_URL final: "${COBALT_API_URL}"`);
const SEP_TYPE = 40; // BS Roformer
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120;
const TEMP_DIR = path.join(__dirname, 'temp');

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
  res.json({ status: 'ok', version: '2.0.0', source: 'cobalt' });
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
  console.log(`[MVSep-Helper] API key: ${mvsepKey ? mvsepKey.substring(0, 8) + '...' : 'VACÍA'}`);
  const jobId = 'mvsep_' + Date.now();
  const audioPath = path.join(TEMP_DIR, `${jobId}.mp3`);

  try {
    // 1. DESCARGAR AUDIO VIA COBALT
    console.log(`[MVSep-Helper] Descargando audio de: ${youtubeUrl}`);
    const cobaltResult = await downloadViaCobalt(youtubeUrl, audioPath);

    const stats = fs.statSync(audioPath);
    console.log(`[MVSep-Helper] Audio descargado: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // 2. SUBIR A MVSEP.COM
    console.log(`[MVSep-Helper] Subiendo a mvsep.com...`);
    const uploadResult = await uploadToMvsep(audioPath, mvsepKey);

    console.log(`[MVSep-Helper] Respuesta mvsep:`, JSON.stringify(uploadResult).substring(0, 500));

    const mvsepJobId = uploadResult?.data?.hash || uploadResult?.job_id;
    if (!mvsepJobId) {
      const errMsg = uploadResult?.message || uploadResult?.error || uploadResult?.detail || JSON.stringify(uploadResult) || 'Error al subir a mvsep.com';
      throw new Error(errMsg);
    }
    console.log(`[MVSep-Helper] Job creado: ${mvsepJobId}`);

    // 3. POLLEAR HASTA COMPLETAR
    console.log(`[MVSep-Helper] Procesando... (esto puede tomar 30-120s)`);
    const pollResult = await pollMvsepJob(mvsepJobId, mvsepKey);

    if (!pollResult.success) {
      throw new Error('Error en procesamiento: ' + (pollResult.error || 'desconocido'));
    }

    console.log(`[MVSep-Helper] Procesamiento completado.`);

    // 4. DESCARGAR RESULTADOS
    console.log(`[MVSep-Helper] URLs de descarga:`, JSON.stringify(pollResult.downloadUrls).substring(0, 800));
    const downloadResult = await downloadMvsepResults(pollResult.downloadUrls, mvsepKey);

    if (!downloadResult.success) {
      throw new Error('Error al descargar resultados');
    }

    // 5. LIMPIAR ARCHIVO TEMPORAL
    try { fs.unlinkSync(audioPath); } catch (e) { /* ignore */ }

    // 6. ENVIAR RESPUESTA
    console.log(`[MVSep-Helper] Enviando resultados...`);
    console.log(`  - Instrumental: ${downloadResult.instrumental ? (downloadResult.instrumental.byteLength / 1024).toFixed(1) + ' KB' : 'N/A'}`);
    console.log(`  - Vocal: ${downloadResult.vocal ? (downloadResult.vocal.byteLength / 1024).toFixed(1) + ' KB' : 'N/A'}`);

    res.json({
      success: true,
      title: cobaltResult.title || 'unknown',
      duration: cobaltResult.duration || 0,
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
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (e) { /* ignore */ }
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// FUNCION: DESCARGAR AUDIO VIA COBALT API
// ============================================================

async function downloadViaCobalt(youtubeUrl, outputPath) {
  console.log(`[Cobalt] Solicitando audio a: ${COBALT_API_URL}`);

  const response = await fetch(COBALT_API_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: youtubeUrl,
      downloadMode: 'audio',
      aFormat: 'mp3',
      filenamePattern: 'basic',
    }),
  });

  const data = await response.json();
  console.log(`[Cobalt] Respuesta:`, JSON.stringify(data).substring(0, 500));

  if (data.status === 'error') {
    throw new Error(`Cobalt error: ${data.error?.code || data.text || 'unknown'}`);
  }

  let downloadUrl;
  let title = 'unknown';
  let duration = 0;

  if (data.status === 'tunnel' || data.status === 'redirect') {
    downloadUrl = data.url;
    title = data.filename || 'unknown';
  } else if (data.status === 'picker') {
    if (data.picker && data.picker.length > 0) {
      downloadUrl = data.picker[0].url;
    } else if (data.audio) {
      downloadUrl = data.audio;
    }
    title = data.filename || 'unknown';
  } else if (data.status === 'local-processing') {
    throw new Error('Cobalt requiere procesamiento local, no soportado en servidor');
  } else {
    throw new Error(`Cobalt status inesperado: ${data.status}`);
  }

  if (!downloadUrl) {
    throw new Error('Cobalt no devolvió URL de descarga');
  }

  console.log(`[Cobalt] Descargando audio desde: ${downloadUrl.substring(0, 120)}...`);

  const audioResponse = await fetch(downloadUrl);
  if (!audioResponse.ok) {
    throw new Error(`Error descargando audio: HTTP ${audioResponse.status}`);
  }

  const buffer = Buffer.from(await audioResponse.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  console.log(`[Cobalt] Audio guardado: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

  return { title, duration };
}

// ============================================================
// FUNCIONES MVSEP.COM
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
      const url = `${MVSEP_API_BASE}/separation/get?hash=${encodeURIComponent(jobId)}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (attempt === 0) console.log(`[MVSep-Helper] Poll status HTTP ${response.status}`);
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
      console.warn(`[MVSep-Helper] Error polling (intento ${attempt + 1}):`, e.message);
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
  console.log('║       MVSep - Helper Server (Cobalt)        ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Puerto: ${PORT}                              ║`);
  console.log('║  Endpoint: POST /separate                    ║');
  console.log('║  Source: Cobalt API (no yt-dlp needed)       ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('[MVSep-Helper] Servidor listo! Esperando peticiones...');
});
