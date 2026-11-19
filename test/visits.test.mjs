// Visits: one line each for 90 days, and each finished day's totals kept for good.
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = await mkdtemp(path.join(tmpdir(), 'mxo-visits-'));
process.env.MXO_DATA_DIR = dir;
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;
const { dayTotals, keepDailyTotals, visitSummary } = await import('../lib/visits.js');
const { write } = await import('../lib/store.js');
after(() => rm(dir, { recursive: true, force: true }));

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 20, 12);
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const lines = ['10:01;DE;d;;aaaa', '10:20;DE;m;discord.com;bbbb', '11:05;GB;d;;aaaa'].join('\n') + '\n';

test('a day of visit lines adds up', () => {
  const totals = dayTotals(lines);
  assert.deepEqual([totals.visits, totals.visitors], [3, 2]);
  assert.deepEqual(totals.countries, { DE: 2, GB: 1 });
  assert.deepEqual(totals.devices, { desktop: 2, phone: 1 });
  assert.deepEqual(totals.referrers, { '(direct)': 2, 'discord.com': 1 });
});

test('finished days keep their totals, and older days are read from them', async () => {
  const yesterday = dayOf(now - DAY);
  const before = dayOf(now - 2 * DAY);
  await write([{ set: [`mxo:visits:${yesterday}`, lines] }, { set: [`mxo:visits:${before}`, lines] }, { set: [`mxo:visits:${dayOf(now)}`, lines] }]);
  const ops = await keepDailyTotals(now);
  assert.deepEqual(ops.map((op) => op.set[0]).sort(), [`mxo:visitday:${before}`, `mxo:visitday:${yesterday}`], 'both finished days, not today');
  await write(ops);
  assert.equal((await keepDailyTotals(now)).length, 0, 'nothing more to save');
  // The lines of the day before yesterday expire; its totals still count.
  await unlink(path.join(dir, `mxo_visits_${before}`));
  const summary = await visitSummary(3, now);
  assert.equal(summary.visits, 9);
  assert.deepEqual(summary.perDay.map((d) => d.visits), [3, 3, 3]);
  assert.deepEqual(summary.countries, [['DE', 6], ['GB', 3]]);
});
