// The visit counter's limits: bots, one visitor within half an hour, one address per day, and a full day.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MINUTE, useTempStore } from './support.mjs';

await useTempStore('visit-limits');
const { recordVisit } = await import('../lib/visits.js');
const { write } = await import('../lib/store.js');

const BROWSER = 'Mozilla/5.0 (Macintosh) Chrome/142';
const at = (minutes) => Date.UTC(2026, 10, 20, 9) + minutes * MINUTE;
const visit = (extra) => recordVisit({ ip: '203.0.113.7', agent: BROWSER, country: 'PL', referrer: '', host: 'example.org', secret: 's', now: at(0), ...extra });

test('scripts and bots are not counted', async () => {
  for (const agent of ['curl/8.4', 'Googlebot/2.1', 'python-requests/2.31', 'HeadlessChrome/142', '']) assert.equal(await visit({ agent, ip: '198.51.100.1' }), false, agent);
});

test('one visitor counts once per half hour', async () => {
  assert.equal(await visit({ ip: '198.51.100.2' }), true);
  assert.equal(await visit({ ip: '198.51.100.2', now: at(10) }), false);
  assert.equal(await visit({ ip: '198.51.100.2', now: at(31) }), true);
});

test('one address counts at most 20 times a day, however many browsers it claims', async () => {
  const counted = [];
  for (let k = 0; k < 25; k++) counted.push(await visit({ ip: '198.51.100.3', agent: `${BROWSER} ${k}` }));
  assert.equal(counted.filter(Boolean).length, 20);
});

test('a full day stops counting', async () => {
  const day = '2026-11-21';
  await write([{ set: [`mxo:visits:${day}`, 'x'.repeat(120_001)] }]);
  const morning = Date.UTC(2026, 10, 21, 8);
  assert.equal(await visit({ ip: '198.51.100.4', now: morning }), true, 'the visit that fills the day is still saved');
  assert.equal(await visit({ ip: '198.51.100.5', now: morning + 60_000 }), false);
});
