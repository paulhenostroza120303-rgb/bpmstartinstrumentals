// ============================================================
// Generador de Íconos PNG para MVSep Extension
// Uso: node generate-png.js
// Genera icon16.png, icon48.png, icon128.png en /icons/
// ============================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 48, 128];
const COLORS = {
  bg: [0x0f, 0x0f, 0x0f],     // #0f0f0f fondo oscuro
  accent: [0xff, 0x44, 0x44],  // #ff4444 rojo acento
};

function createPNG(width, height, getPixel) {
  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT chunk - raw pixel data with filter byte per row
  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3);
    rawData[rowOffset] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = getPixel(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 3;
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function musicNoteIcon(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.38;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Círculo exterior para el icono
  if (dist <= radius) {
    // Degradado simple
    const t = dist / radius;
    const r = Math.round(COLORS.accent[0] + (255 - COLORS.accent[0]) * t * 0.2);
    const g = Math.round(COLORS.accent[1] + (255 - COLORS.accent[1]) * t * 0.1);
    const b = Math.round(COLORS.accent[2] + (255 - COLORS.accent[2]) * t * 0.1);
    return [r, g, b];
  }

  return COLORS.bg;
}

function generateAll() {
  const outputDir = __dirname;

  SIZES.forEach((size) => {
    const png = createPNG(size, size, musicNoteIcon);
    const outputPath = path.join(outputDir, `icon${size}.png`);
    fs.writeFileSync(outputPath, png);
    console.log(`✓ Generado: icon${size}.png (${png.length} bytes)`);
  });

  console.log('\n✅ Todos los iconos PNG generados exitosamente.');
  console.log('📁 Los iconos están en la carpeta /icons/');
  console.log('💡 Ahora puedes cargar la extensión en chrome://extensions/');
}

generateAll();
