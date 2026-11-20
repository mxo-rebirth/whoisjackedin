// Taking a sample: the minimum gap between two, a damaged saved state, answers that say "asked too often",
// a streak cut off by silence, and where one day ends in the viewer's time zone.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = await mkdtemp(path.join(tmpdir(), 'mxo-collect-'));
process.env.MXO_DATA_DIR = dir;
delete process.env.KV_REST_API_URL;
// No feed is reached from the tests: every one fails at once, as if offline.
globalThis.fetch = async () => {
  throw new Error('offline in tests');
};
const { STATE_KEY, SAMPLE_MS, SILENCE_MS, applySample, collect, newState } = await import('../lib/sampler.js');
const { daysOf } = await import('../lib/stats.js');
const { SERVERS } = await import('../lib/sources.js');
const { write } = await import('../lib/store.js');
after(() => rm(dir, { recursive: true, force: true }));

const up = (players) => ({ ok: true, online: true, players, checkedAt: null, details: [] });
const round = (first) => SERVERS.map((_, i) => (i === 0 ? first : up(1)));
const [first] = SERVERS;

test('a second sample within the minimum gap is skipped', async () => {
  const one = await collect();
  assert.equal(one.skipped, false);
  const two = await collect();
  assert.equal(two.skipped, true);
  assert.equal(two.state.checks, one.state.checks);
});

test('a damaged saved state is set aside and sampling starts afresh, instead of failing every minute', async () => {
  await write([{ set: [STATE_KEY, '{ this is not json'] }]);
  const after = await collect({ force: true });
  assert.equal(after.skipped, false);
  assert.equal(after.state.checks, 1);
  assert.ok((await readdir(dir)).some((name) => name.startsWith('mxo_damaged_mxo_state_')), 'the damaged copy is kept');
});

test('"asked too often" is a short gap of its own, not a step towards an outage', () => {
  const state = newState();
  const t = Date.UTC(2026, 10, 20, 9);
  applySample(state, t, round(up(3)));
  applySample(state, t + SAMPLE_MS, round({ ok: false, limited: true, error: 'asked too often' }));
  const all = state.all[first.id];
  assert.equal(all.gaps[0].kind, 'limited');
  assert.equal(all.run ?? null, null);
});

test('a bad streak cut off by silence ends one sample after its last answer', () => {
  const state = newState();
  const t = Date.UTC(2026, 10, 20, 9);
  applySample(state, t, round(up(3)));
  applySample(state, t + SAMPLE_MS, round({ ok: false, error: 'timeout' }));
  applySample(state, t + 2 * SAMPLE_MS, round({ ok: false, error: 'timeout' }));
  applySample(state, t + 2 * SAMPLE_MS + SILENCE_MS + SAMPLE_MS, round(up(4)));
  const gap = state.all[first.id].gaps[0];
  assert.equal(gap.from, t + SAMPLE_MS);
  assert.equal(gap.to, t + 3 * SAMPLE_MS);
});

test("days are cut in the viewer's time zone", () => {
  const slot = (players) => [players, 1, 1, players];
  const hourly = new Map([['2026-11-10', { [first.code]: { 21: slot(2), 22: slot(5), 23: slot(7) } }]]);
  const utc = daysOf(hourly, first.code, 0);
  assert.equal(utc.length, 1);
  assert.equal(utc[0][3], 7);
  // Two hours ahead of UTC, 22:00 and 23:00 UTC are already the next day.
  const ahead = daysOf(hourly, first.code, 2);
  assert.deepEqual(ahead.map((day) => [new Date(day[0]).toISOString().slice(0, 10), day[3]]), [['2026-11-10', 2], ['2026-11-11', 7]]);
});
