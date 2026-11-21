// Draws the app icons as PNG files: the favicon's four bars on the dark background. Used by build.mjs.
import { deflateSync } from 'node:zlib';

const BG = [3, 6, 4];
const BAR = [61, 255, 143];
// The bars in the favicon's 16-unit square: x, top, bottom. Each has round ends and a width of 1.8.
const BARS = [[3, 8, 12], [6.5, 5, 12], [10, 9, 12], [13.5, 4, 12]];
const HALF = 0.9;

/** Distance from (x, y) to a vertical bar, minus its half width: below 0 is inside. */
const barDistance = (x, y, [bx, top, bottom]) => Math.hypot(x - bx, y - Math.min(bottom, Math.max(top, y))) - HALF;

const SAMPLES = 4; // samples per pixel along each side, for smooth edges

/** How much of one pixel the background and the bars cover, each from 0 to 1. */
function coverage(px, py, size, maskable) {
  const scale = maskable ? 0.8 : 1;
  const offset = (16 * (1 - scale)) / 2;
  let inBg = 0;
  let inBar = 0;
  const total = SAMPLES * SAMPLES;
  for (let k = 0; k < total; k++) {
    const ux = ((px + ((k % SAMPLES) + 0.5) / SAMPLES) / size) * 16;
    const uy = ((py + (Math.floor(k / SAMPLES) + 0.5) / SAMPLES) / size) * 16;
    if (maskable || insideRounded(ux, uy)) inBg += 1;
    if (BARS.some((bar) => barDistance((ux - offset) / scale, (uy - offset) / scale, bar) <= 0)) inBar += 1;
  }
  return { bg: inBg / total, bar: inBar / total };
}

/** Inside the background square with rounded corners (radius 3). */
function insideRounded(x, y) {
  const cx = Math.min(Math.max(x, 3), 13);
  const cy = Math.min(Math.max(y, 3), 13);
  return Math.hypot(x - cx, y - cy) <= 3;
}

/** One pixel as RGBA: the bar color blended over the background by how much of it each covers. */
function pixel({ bg, bar }) {
  const alpha = Math.max(bg, bar);
  const share = alpha ? bar / alpha : 0;
  const rgb = BG.map((c, k) => (alpha ? Math.round(c * (1 - share) + BAR[k] * share) : 0));
  return [...rgb, Math.round(alpha * 255)];
}

/**
 * One icon, `size` pixels square. A plain icon has rounded corners on a clear background. A maskable one fills
 * the whole square and keeps the bars inside the middle 80%, where every phone's mask leaves them visible.
 */
export function iconPng(size, { maskable = false } = {}) {
  const rows = Array.from({ length: size }, (_, py) => {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) row.set(pixel(coverage(px, py, size, maskable)), 1 + px * 4);
    return row;
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // red, green, blue and alpha
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))]);
}

/** One PNG chunk: its length, type, data and checksum. */
function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
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
