// ============================================================
// MVSep - Offscreen Document
// Captura el audio del tab de YouTube usando tabCapture
// y envía el blob grabado al service worker
// ============================================================

let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let audioContext = null;
let readyConfirmed = false;

// ============================================================
// NOTIFICAR QUE ESTAMOS LISTOS (CON REINTENTOS)
// ============================================================
// Enviamos OFFSCREEN_READY repetidamente hasta que el service
// worker lo recibe. Esto evita race conditions donde el
// mensaje se envía antes de que el listener esté listo.

function sendReady() {
  if (readyConfirmed) return;
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' })
    .then(() => {
      readyConfirmed = true;
    })
    .catch(() => {
      // Service worker aún no está escuchando, reintentar
      setTimeout(sendReady, 200);
    });
}

// Primer intento inmediato (sendReady se reintenta automáticamente cada 200ms si falla)
sendReady();

// ============================================================
// MANEJO DE MENSAJES
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Responder a PING del service worker
  if (message.type === 'PING') {
    sendResponse({ pong: true });
    return true;
  }

  // Capturar audio
  if (message.type === 'CAPTURE_AUDIO') {
    handleCaptureAudio(message)
      .then((result) => {
        // Confirmamos que estamos listos (por si el OFFSCREEN_READY no llegó)
        if (!readyConfirmed) {
          readyConfirmed = true;
        }
        sendResponse(result);
      })
      .catch((err) => {
        console.error('[MVSep Offscreen] Error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }
});

// ============================================================
// CAPTURA DE AUDIO
// ============================================================

async function handleCaptureAudio(message) {
  const { streamId, jobId, durationMs } = message;

  try {
    // Obtener el stream de audio del tab
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    // Verificar que tenemos pistas de audio
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      throw new Error('No se pudo capturar el audio del tab');
    }

    // Configurar AudioContext
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);

    // Grabar el audio
    recordedChunks = [];
    const mimeType = getSupportedMimeType();

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      audioBitsPerSecond: 128000,
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    // Iniciar grabación
    mediaRecorder.start(1000); // Fragmentos cada 1 segundo

    // Grabar por la duración especificada o hasta que el usuario lo cancele
    const maxDuration = Math.min(durationMs || 60000, 120000); // Máximo 2 minutos

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
        resolve();
      }, maxDuration);

      mediaRecorder.onstop = () => {
        clearTimeout(timeout);
        resolve();
      };

      mediaRecorder.onerror = (event) => {
        clearTimeout(timeout);
        reject(new Error('Error en MediaRecorder: ' + (event.error?.message || 'desconocido')));
      };
    });

    // Obtener el blob del audio grabado
    const blob = new Blob(recordedChunks, { type: mimeType });

    // Limpiar recursos
    cleanup();

    // IMPORTANTE: Blob NO es serializable por structured clone (messaging API).
    // Convertimos a ArrayBuffer que SÍ es transferible entre contextos.
    const arrayBuffer = await blob.arrayBuffer();

    // Devolver el resultado (solo datos serializables, nada de Blobs)
    return {
      success: true,
      jobId,
      arrayBuffer: arrayBuffer,
      mimeType: mimeType,
      size: blob.size,
      durationMs: maxDuration,
    };

  } catch (error) {
    cleanup();
    throw error;
  }
}

// ============================================================
// UTILIDADES
// ============================================================

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/mpeg',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return 'audio/webm';
}

function cleanup() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (e) { /* ignore */ }
  }
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
  }
  mediaRecorder = null;
  stream = null;
  audioContext = null;
  recordedChunks = [];
}
