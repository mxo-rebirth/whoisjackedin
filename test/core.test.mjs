// The sampler's rules: when a streak of bad answers becomes an outage, what is counted, and the records.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = await mkdtemp(path.join(tmpdir(), 'mxo-test-'));
process.env.MXO_DATA_DIR = dir;
delete process.env.KV_REST_API_URL;
const { STATE_KEY, applySample, buildStats, dayOf, newState, rawKey } = await import('../lib/core.js');
const { SERVERS } = await import('../lib/sources.js');
const { write } = await import('../lib/store.js');
after(() => rm(dir, { recursive: true, force: true }));

const MINUTE = 60_000;
const up = (players) => ({ ok: true, online: true, players, checkedAt: null, details: [] });
const down = { ok: true, online: false, players: 0, checkedAt: null, details: [{ label: 'Status', value: 'maintenance' }] };
const silent = { ok: false, error: 'timeout' };
/** One round of answers: the first server gets `first`, the others are up with one player each. */
const round = (first) => SERVERS.map((_, i) => (i === 0 ? first : up(1)));
const first = SERVERS[0];

/** Runs answers for the first server, one a minute, from `start`. Returns the state and the saved lines. */
function run(answers, start = Date.UTC(2026, 10, 18, 10, 0)) {
  const state = newState();
  const lines = [];
  answers.forEach((answer, k) => lines.push(applySample(state, start + k * MINUTE, round(answer)).rawLine));
  return { state, lines, start };
}

test('a short streak of bad answers is a gap, not an outage, and the last count stands in', () => {
  const { state, lines } = run([up(5), ...Array(5).fill(silent), up(6)]);
  const all = state.all[first.id];
  assert.equal(all.outages.length, 0);
  assert.equal(all.gaps.length, 1);
  assert.equal(all.gaps[0].checks, 5);
  // The five silent minutes were saved with the count from before them.
  assert.equal(lines.filter((line) => line.includes(`;${first.code}1:5`)).length, 6);
});

test('fifteen bad answers in a row make an outage, and the stand-in counts are taken back out', () => {
  const { state } = run([up(5), ...Array(15).fill(silent), up(6)]);
  const all = state.all[first.id];
  assert.equal(all.outages.length, 1);
  assert.equal(all.outages[0].kind, 'unknown');
  assert.equal(all.outages[0].checks, 15);
  const slot = state.hours[first.code][10];
  // Counted: the first reading and the last. The fourteen stand-ins were removed, and the 15th was never saved.
  assert.deepEqual([slot[0], slot[1], slot[2]], [11, 2, 2]);
});

test('a server that says it is down makes an "offline" outage', () => {
  const { state } = run([up(2), ...Array(16).fill(down), up(2)]);
  assert.equal(state.all[first.id].outages[0].kind, 'offline');
});

test('records: the most on one server, and on all servers together', () => {
  const { state } = run([up(3), up(9), up(4)]);
  assert.equal(state.all[first.id].recordPeak, 9);
  assert.equal(state.total.recordPeak, 9 + (SERVERS.length - 1));
});

test('the chart breaks inside a confirmed outage instead of showing the stand-in count', async () => {
  // Ends now, so the page does not go and take a live sample.
  const start = Math.floor((Date.now() - 59 * MINUTE) / MINUTE) * MINUTE; // all inside the last hour
  const answers = [...Array(20).fill(up(4)), ...Array(20).fill(silent), ...Array(20).fill(up(4))];
  const { state, lines } = run(answers, start);
  const byDay = new Map();
  lines.forEach((line) => {
    const day = dayOf(Number(line.split(';')[0]) * 1000);
    byDay.set(day, (byDay.get(day) ?? '') + line);
  });
  await write([...[...byDay].map(([day, text]) => ({ set: [rawKey(day), text] })), { set: [STATE_KEY, JSON.stringify(state)] }]);

  const stats = await buildStats('1h', 0);
  const mine = stats.servers.findIndex((s) => s.id === first.id);
  const outage = stats.servers[mine].allTime.outages[0];
  assert.ok(outage, 'the outage is listed');
  const inside = stats.history.means.filter((_, k) => {
    const t = stats.history.points[k][0];
    return t >= outage.from && t + stats.history.bucketMs <= outage.to;
  });
  assert.ok(inside.length >= 5);
  for (const row of inside) assert.equal(row[mine], null);
  // The stand-ins are not counted as readings either.
  assert.equal(stats.servers[mine].summary.answered, 40);
});
