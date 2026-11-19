// Draws the app icons as PNG files: the favicon's four bars on the dark background. Used by build.mjs.
import { deflateSync } from 'node:zlib';

const BG = [3, 6, 4];
const BAR = [61, 255, 143];
// The bars in the favicon's 16-unit square: x, top, bottom. Each has round ends and a width of 1.8.
const BARS = [[3, 8, 12], [6.5, 5, 12], [10, 9, 12], [13.5, 4, 12]];
const HALF = 0.9;

/** Distance from (x, y) to a vertical bar, minus its half width: below 0 is inside. */
const barDistance = (x, y, [bx, top, bottom]) => Math.hypot(x - bx, y - Math.min(bottom, Math.max(top, y))) - HALF;

/**
 * One icon, `size` pixels square. A plain icon has rounded corners on a clear background. A maskable one fills
 * the whole square and keeps the bars inside the middle 80%, where every phone's mask leaves them visible.
 */
export function iconPng(size, { maskable = false } = {}) {
  const scale = maskable ? 0.8 : 1;
  const offset = (16 * (1 - scale)) / 2;
  const SAMPLES = 4;
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let inBg = 0;
      let inBar = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const ux = ((px + (sx + 0.5) / SAMPLES) / size) * 16;
          const uy = ((py + (sy + 0.5) / SAMPLES) / size) * 16;
          // The background: rounded corners (radius 3) unless it is maskable.
          const cx = Math.min(Math.max(ux, 3), 13);
          const cy = Math.min(Math.max(uy, 3), 13);
          if (maskable || Math.hypot(ux - cx, uy - cy) <= 3) inBg += 1;
          const gx = (ux - offset) / scale;
          const gy = (uy - offset) / scale;
          if (BARS.some((bar) => barDistance(gx, gy, bar) <= 0)) inBar += 1;
        }
      }
      const total = SAMPLES * SAMPLES;
      const bar = inBar / total;
      const alpha = Math.max(inBg, inBar) / total;
      const i = 1 + px * 4;
      for (let c = 0; c < 3; c++) row[i + c] = Math.round(alpha ? (BG[c] * (1 - bar / alpha) + BAR[c] * (bar / alpha)) : 0);
      row[i + 3] = Math.round(alpha * 255);
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // red, green, blue and alpha
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
