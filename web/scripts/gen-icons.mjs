/**
 * Генерация PNG-иконок PWA из icon.svg без внешних зависимостей:
 * растеризуем простые фигуры напрямую в RGBA-буфер и пишем PNG.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function render(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = hex('#12241D');
  const green = hex('#34D399');
  const dark = hex('#0E1116');
  const amber = hex('#FBBF24');
  const S = size / 512;
  const pad = maskable ? 0.18 : 0; // безопасная зона для maskable
  const set = (x, y, c, a = 255) => {
    const i = (y * size + x) * 4;
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = a;
  };
  const inRound = (x, y, cx, cy, w, h, r) => {
    const l = cx - w / 2, t = cy - h / 2, rr = cx + w / 2, bb = cy + h / 2;
    if (x < l || x > rr || y < t || y > bb) return false;
    const qx = Math.max(l + r, Math.min(x, rr - r));
    const qy = Math.max(t + r, Math.min(y, bb - r));
    return (x - qx) ** 2 + (y - qy) ** 2 <= r * r;
  };
  const scale = (v) => (v - 256) * (1 - pad * 2) * S + 256 * S * 0 + size / 2;
  const rad = (v) => v * (1 - pad * 2) * S;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // фон (для maskable — на весь квадрат, иначе скруглённый)
      const isCorner = !inRound(x, y, size / 2, size / 2, size, size, size * 0.22);
      if (maskable || !isCorner) set(x, y, bg, 255);
      const px = (x - size / 2) / ((1 - pad * 2) * S) + 256;
      const py = (y - size / 2) / ((1 - pad * 2) * S) + 256;
      if (inRound(px, py, 256, 248, 276, 196, 44)) set(x, y, green);
      if (inRound(px, py, 256, 218, 212, 72, 16)) set(x, y, dark);
      if (inRound(px, py, 180, 308, 44, 44, 12)) set(x, y, amber);
      if (inRound(px, py, 332, 308, 44, 44, 12)) set(x, y, amber);
      if (inRound(px, py, 256, 134, 56, 52, 14)) set(x, y, green);
      if ((px - 256) ** 2 + (py - 428) ** 2 <= 26 * 26) set(x, y, green);
    }
  }
  return png(size, size, buf);
}

writeFileSync(join(outDir, 'icon-192.png'), render(192, false));
writeFileSync(join(outDir, 'icon-512.png'), render(512, false));
writeFileSync(join(outDir, 'icon-maskable-512.png'), render(512, true));
console.log('PNG-иконки сгенерированы:', outDir);
