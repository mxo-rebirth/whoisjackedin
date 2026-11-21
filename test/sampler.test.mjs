// The sampler's rules: when a streak of bad answers becomes an outage, what is counted, and the records.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MINUTE, roundOf, up, useTempStore } from './support.mjs';

await useTempStore('sampler');
const { applySample, newState } = await import('../lib/sampler.js');
const { STATE_KEY, rawKey } = await import('../lib/keys.js');
const { buildStats } = await import('../lib/stats.js');
const { dayOf } = await import('../lib/time.js');
const { SERVERS } = await import('../lib/sources.js');
const { write } = await import('../lib/store.js');

const down = { ok: true, online: false, players: 0, checkedAt: null, details: [{ label: 'Status', value: 'maintenance' }] };
const silent = { ok: false, error: 'timeout' };
const round = roundOf(SERVERS);
const first = SERVERS[0];

/** Runs answers for the first server, one a minute, from `start`. Returns the state and the saved lines. */
function run(answers, start = Date.UTC(2026, 10, 18, 10, 0)) {
  const state = newState();
  const lines = [];
  answers.forEach((answer, k) => lines.push(applySample(state, start + k * MINUTE, round(answer)).rawLine));
  return { state, lines, start };
}

test('a short streak of bad answers is a gap, not an outage, and the last count stands in', () => {
  const { state, lines } = run([up(5), ...Array.from({ length: 5 }, () => silent), up(6)]);
  const all = state.all[first.id];
  assert.equal(all.outages.length, 0);
  assert.equal(all.gaps.length, 1);
  assert.equal(all.gaps[0].checks, 5);
  // The five silent minutes were saved with the count from before them.
  assert.equal(lines.filter((line) => line.includes(`;${first.code}1:5`)).length, 6);
});

test('fifteen bad answers in a row make an outage, and the stand-in counts are taken back out', () => {
  const { state } = run([up(5), ...Array.from({ length: 15 }, () => silent), up(6)]);
  const all = state.all[first.id];
  assert.equal(all.outages.length, 1);
  assert.equal(all.outages[0].kind, 'unknown');
  assert.equal(all.outages[0].checks, 15);
  const slot = state.hours[first.code][10];
  // Counted: the first reading and the last. The fourteen stand-ins were removed, and the 15th was never saved.
  assert.deepEqual([slot[0], slot[1], slot[2]], [11, 2, 2]);
});

test('a server that says it is down makes an "offline" outage', () => {
  const { state } = run([up(2), ...Array.from({ length: 16 }, () => down), up(2)]);
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
  const answers = [...Array.from({ length: 20 }, () => up(4)), ...Array.from({ length: 20 }, () => silent), ...Array.from({ length: 20 }, () => up(4))];
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
