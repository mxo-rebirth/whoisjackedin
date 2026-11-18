// Fills a data folder with made-up history for trying the page on your own computer, using the project's own
// sampling code. Usage: node scripts/seed.mjs <folder> [days]   then   MXO_DATA_DIR=<folder> MXO_NO_TIMER=1 npm start
// The folder is emptied first. It holds three made-up outages: one server down, two with no answer.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { STATE_KEY, applySample, dayOf, hoursKey, newState, rawKey } from '../lib/core.js';
import { SERVERS } from '../lib/sources.js';

const [dir, daysArg] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node scripts/seed.mjs <folder> [days]');
  process.exit(2);
}
const DAYS = Number(daysArg ?? 40);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.now();
let seed = 12345;
const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// Each server has its own size and busiest hour.
const level = SERVERS.map((_, i) => [3.2, 2.1, 1, 1.4][i % 4]);
const busiest = SERVERS.map((_, i) => [19, 21, 16, 23][i % 4]);
const value = SERVERS.map(() => 1);
const outages = [
  { server: 1 % SERVERS.length, from: now - 5 * DAY, to: now - 5 * DAY + 3 * HOUR, kind: 'offline' },
  { server: 2 % SERVERS.length, from: now - 2 * DAY, to: now - 2 * DAY + 90 * MINUTE, kind: 'silent' },
  { server: 0, from: now - 6 * HOUR, to: now - 6 * HOUR + 25 * MINUTE, kind: 'silent' },
];

await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
const state = newState();
const raw = new Map();
const hours = new Map();
for (let t = now - DAYS * DAY; t <= now; t += MINUTE) {
  const hour = new Date(t).getUTCHours() + new Date(t).getUTCMinutes() / 60;
  const growth = 0.6 + 0.4 * ((t - (now - DAYS * DAY)) / (DAYS * DAY));
  const results = SERVERS.map((server, i) => {
    const want = Math.max(0, level[i] * growth * (1 + 0.9 * Math.cos(((hour - busiest[i]) / 24) * 2 * Math.PI)));
    if (random() < 0.08) value[i] += Math.sign(want - value[i]) || (random() < 0.5 ? -1 : 1);
    value[i] = Math.max(0, value[i]);
    const out = outages.find((o) => o.server === i && t >= o.from && t < o.to);
    if (out?.kind === 'offline') return { ok: true, online: false, players: 0, checkedAt: null, details: [{ label: 'Status', value: 'maintenance' }] };
    if (out) return { ok: false, error: 'timeout' };
    return { ok: true, online: true, players: value[i], checkedAt: null, details: [{ label: 'World', value: server.about?.glance?.world ?? server.name }] };
  });
  const { rawLine, finished } = applySample(state, t, results);
  if (finished) hours.set(finished.day, finished.hours);
  if (now - t < 9 * DAY) raw.set(dayOf(t), (raw.get(dayOf(t)) ?? '') + rawLine);
}
const file = (key) => path.join(dir, key.replace(/[^A-Za-z0-9._-]/g, '_'));
for (const [day, text] of raw) await writeFile(file(rawKey(day)), text);
for (const [day, data] of hours) await writeFile(file(hoursKey(day)), JSON.stringify(data));
state.community = { triedAt: now, byId: {} };
await writeFile(file(STATE_KEY), JSON.stringify(state));
console.log(`seeded ${DAYS} days into ${dir}. The page takes a fresh sample once the last one is 90 seconds old.`);
