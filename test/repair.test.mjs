// Stand-in readings: cleaned when an outage is confirmed, taken out of a day already saved, and repaired once
// in data saved before that.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = await mkdtemp(path.join(tmpdir(), 'mxo-repair-'));
process.env.MXO_DATA_DIR = dir;
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;
const { STATE_KEY, applySample, cleanStandIns, dayOf, hoursKey, newState, rawKey, repairStandIns } = await import('../lib/core.js');
const { SERVERS } = await import('../lib/sources.js');
const { mget, write } = await import('../lib/store.js');
after(() => rm(dir, { recursive: true, force: true }));

const MINUTE = 60_000;
const up = (players) => ({ ok: true, online: true, players, checkedAt: null, details: [] });
const silent = (error = 'timeout') => ({ ok: false, error });
const round = (first, second = up(1)) => SERVERS.map((_, i) => (i === 0 ? first : i === 1 ? second : up(1)));
const [first, second] = SERVERS;

test('cleanStandIns replaces only online readings inside the window', () => {
  const t0 = 1_000_000_000;
  const text = [`${t0};r1:5;v1:2`, `${t0 + 60};r1:5;v1:2`, `${t0 + 120};r-;v1:2`, `${t0 + 180};r1:6;v1:2`].join('\n');
  const none = cleanStandIns(text, 'r', t0 * 1000 + 60_000, t0 * 1000 + 180_000, 'unknown');
  assert.equal(none.changed, 1);
  assert.equal(none.text.split('\n')[1], `${t0 + 60};r-;v1:2`);
  assert.equal(none.text.split('\n')[3], `${t0 + 180};r1:6;v1:2`, 'outside the window');
  assert.equal(cleanStandIns(text, 'r', t0 * 1000, t0 * 1000 + 120_000, 'offline').text.split('\n')[0], `${t0};r0:0;v1:2`);
});

test('an outage confirmed after midnight UTC reports the stand-ins left in the day before', () => {
  const state = newState();
  const start = Date.UTC(2026, 10, 18, 23, 50);
  let result;
  for (let k = 0; k < 5; k++) applySample(state, start + k * MINUTE, round(up(5)));
  for (let k = 5; k < 20; k++) result = applySample(state, start + k * MINUTE, round(silent()));
  assert.equal(result.confirmed.length, 1);
  assert.equal(result.confirmed[0].code, first.code);
  assert.equal(result.late.length, 5, 'the five stand-ins before midnight');
  assert.ok(result.late.every((fix) => fix.day === '2026-11-18' && fix.players === 5 && fix.unknown));
});

test('the one-time repair cleans saved stand-ins, re-marks the misread Rejacked outage, and keeps backups', async () => {
  const now = Date.now();
  const start = Math.floor((now - 3 * 60 * MINUTE) / MINUTE) * MINUTE;
  const state = newState();
  const byDay = new Map();
  const misread = silent('no usable status in the feed');
  const answers = [...Array(10).fill([up(2), up(4)]), ...Array(20).fill([misread, silent()]), ...Array(10).fill([up(3), up(4)])];
  answers.forEach(([a, b], k) => {
    const t = start + k * MINUTE;
    const { rawLine } = applySample(state, t, round(a, b));
    byDay.set(dayOf(t), (byDay.get(dayOf(t)) ?? '') + rawLine);
  });
  const countedBefore = Object.values(state.hours[first.code]).reduce((sum, slot) => sum + slot[1], 0);
  await write([...[...byDay].map(([day, text]) => ({ set: [rawKey(day), text] })), { set: [STATE_KEY, JSON.stringify(state)] }]);

  const ops = await repairStandIns(state, now);
  await write(ops);
  const rejacked = state.all[first.code === 'r' ? 'rejacked' : first.id].outages[0];
  assert.deepEqual([rejacked.kind, rejacked.detail], ['offline', 'offline']);
  assert.equal(state.all[second.id].outages[0].kind, 'unknown', 'other outages keep their kind');

  const days = [...byDay.keys()];
  const lines = (await mget(days.map(rawKey))).join('').split('\n').filter(Boolean);
  const inside = (line, o) => {
    const t = Number(line.split(';')[0]) * 1000;
    return t >= o.from && t < o.to;
  };
  const outage = state.all[second.id].outages[0];
  for (const line of lines.filter((l) => inside(l, outage))) {
    assert.match(line, new RegExp(`;${first.code}0:0(;|$)`), 'Rejacked was down');
    assert.match(line, new RegExp(`;${second.code}-(;|$)`), 'no stand-ins left for the other server');
  }
  // All twenty minutes of the Rejacked outage now count as readings of a server that was down.
  const countedAfter = Object.values(state.hours[first.code]).reduce((sum, slot) => sum + slot[1], 0);
  assert.equal(countedAfter - countedBefore, 20);
  const [backup] = await mget([`mxo:backup:v3:${rawKey(days[0])}`]);
  assert.equal(backup, byDay.get(days[0]), 'the lines as they were');
  assert.ok((await mget([`mxo:backup:v3:${STATE_KEY}`]))[0]);
  // Run again: nothing more to change.
  const again = await repairStandIns(state, now);
  assert.ok(again.filter((op) => !op.set[0].startsWith('mxo:backup:')).length === 0, 'the repair is safe to run twice');
  assert.equal(hoursKey('x'), 'mxo:hours:x');
});
