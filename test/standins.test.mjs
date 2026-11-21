// Stand-in readings: cleaned when an outage is confirmed, and taken out of a day already saved.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MINUTE, roundOf, up, useTempStore } from './support.mjs';

await useTempStore('standins');
const { applySample, cleanStandIns, newState } = await import('../lib/sampler.js');
const { SERVERS } = await import('../lib/sources.js');

const silent = (error = 'timeout') => ({ ok: false, error });
const round = roundOf(SERVERS);
const [first] = SERVERS;

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
