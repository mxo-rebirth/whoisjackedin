// The archive: which days are due, what each one becomes in the bucket, that a failure is tried again, and that
// nothing about the bucket can stop the readings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useTempStore } from './support.mjs';

await useTempStore('archive');
const { STATE_FILE, archiveDays, archivedWrites, daysToArchive } = await import('../lib/archive.js');
const { bucketConfig, listObjects } = await import('../lib/helpers/bucket.js');
const { dayTotalsKey, hoursKey, rawKey } = await import('../lib/keys.js');
const { write } = await import('../lib/store.js');

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 21, 12);
const cfg = { origin: 'https://bucket.test', bucket: 'backup', keyId: 'id', secret: 'secret', region: 'auto' };

/** Answers every request like the bucket would, or fails the uploads `failing` names. Keeps what was sent. */
function fakeBucket(t, failing = () => false) {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname.replace('/backup/', '');
    if (failing(path)) return new Response('', { status: 500 });
    sent.push({ path, body: init.body, authorization: init.headers.authorization });
    return new Response('', { status: 200 });
  });
  return sent;
}

test('days are due from the start of the record up to the day before yesterday, a few at a time', () => {
  assert.deepEqual(daysToArchive({ since: now - 3 * DAY }, now), ['2026-11-18', '2026-11-19']);
  assert.deepEqual(daysToArchive({ since: now - 30 * DAY, archived: '2026-11-17' }, now), ['2026-11-18', '2026-11-19']);
  assert.equal(daysToArchive({ since: now - 30 * DAY }, now).length, 5);
  assert.deepEqual(daysToArchive({ since: now - 30 * DAY, archived: '2026-11-19' }, now), []);
  assert.deepEqual(daysToArchive({}, now), []);
});

test('the day the sampler is still in is never due, even after a gap in the readings', () => {
  // The sampler last ran on the 18th. Until a reading moves it on, the 18th is still open.
  assert.deepEqual(daysToArchive({ since: Date.UTC(2026, 10, 15), today: '2026-11-18' }, Date.UTC(2026, 10, 20, 12)), ['2026-11-15', '2026-11-16', '2026-11-17']);
});

test('each day goes up as its minute log, hourly totals and visit totals, then the state', async (t) => {
  await write([
    { set: [rawKey('2026-11-18'), '1795000000;r1:2\n'] },
    { set: [hoursKey('2026-11-18'), '{"r":{}}'] },
    { set: [dayTotalsKey('2026-11-18'), '{"visits":3}'] },
    // An older day whose minute log has already expired.
    { set: [hoursKey('2026-11-17'), '{"r":{"0":[1,1,1,1]}}'] },
  ]);
  const sent = fakeBucket(t);
  assert.equal(await archiveDays({ since: Date.UTC(2026, 10, 17), archived: null }, now, { cfg }), '2026-11-19');
  assert.deepEqual(sent.map((s) => s.path).toSorted(), ['hours/2026-11-17.json', 'hours/2026-11-18.json', 'raw/2026-11-18.txt', STATE_FILE, 'visits/2026-11-18.json']);
  assert.equal(sent.find((s) => s.path === 'raw/2026-11-18.txt').body, '1795000000;r1:2\n');
  assert.ok(sent.every((s) => s.authorization.includes('/auto/s3/aws4_request')));
});

test('the region from ARCHIVE_REGION is the one requests are signed for', async (t) => {
  const sent = fakeBucket(t);
  await write([{ set: [hoursKey('2026-11-19'), '{}'] }]);
  await archiveDays({ since: Date.UTC(2026, 10, 19) }, now, { cfg: { ...cfg, region: 'eu-central-1' } });
  assert.ok(sent.length && sent.every((s) => s.authorization.includes('/eu-central-1/s3/aws4_request')));
  const base = { ARCHIVE_ENDPOINT: 'https://storage.test/backup', ARCHIVE_BUCKET: 'backup', ARCHIVE_KEY_ID: 'id', ARCHIVE_SECRET: 's' };
  assert.equal(bucketConfig(base).region, 'auto');
  assert.equal(bucketConfig({ ...base, ARCHIVE_REGION: 'eu-central-1' }).region, 'eu-central-1');
  assert.equal(bucketConfig(base).origin, 'https://storage.test');
});

test('an endpoint that is not an address turns the archive off instead of failing', (t) => {
  t.mock.method(console, 'warn', () => {});
  assert.equal(bucketConfig({ ARCHIVE_ENDPOINT: 'storage.test', ARCHIVE_BUCKET: 'b', ARCHIVE_KEY_ID: 'i', ARCHIVE_SECRET: 's' }), null);
});

test('a failed upload stops there, names what failed, and the next run starts again from that day', async (t) => {
  await write([{ set: [hoursKey('2026-11-18'), '{}'] }, { set: [hoursKey('2026-11-19'), '{}'] }]);
  fakeBucket(t, (path) => path === 'hours/2026-11-19.json');
  const warned = t.mock.method(console, 'warn', () => {});
  const state = { since: Date.UTC(2026, 10, 18), archived: null };
  assert.equal(await archiveDays(state, now, { cfg }), '2026-11-18');
  assert.match(warned.mock.calls[0].arguments[0], /could not archive 2026-11-19: /);
  assert.deepEqual(daysToArchive({ ...state, archived: '2026-11-18' }, now), ['2026-11-19']);
});

test('when only the state fails, the days still count as copied and the warning says so', async (t) => {
  await write([{ set: [hoursKey('2026-11-19'), '{}'] }]);
  fakeBucket(t, (path) => path === STATE_FILE);
  const warned = t.mock.method(console, 'warn', () => {});
  assert.equal(await archiveDays({ since: Date.UTC(2026, 10, 19) }, now, { cfg }), '2026-11-19');
  assert.match(warned.mock.calls[0].arguments[0], /could not archive the state: /);
});

test('nothing starts when the time left would not fit a request', async (t) => {
  const sent = fakeBucket(t);
  assert.equal(await archiveDays({ since: Date.UTC(2026, 10, 18), archived: '2026-11-17' }, now, { cfg, until: Date.now() + 100 }), '2026-11-17');
  assert.equal(sent.length, 0);
});

test('without the bucket settings nothing is sent', async (t) => {
  const sent = fakeBucket(t);
  assert.equal(await archiveDays({ since: now - 10 * DAY, archived: '2026-11-01' }, now, { cfg: null }), '2026-11-01');
  assert.equal(sent.length, 0);
});

test('a missing bucket is reported as such', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  await assert.rejects(listObjects(cfg), /the bucket "backup" was not found, check ARCHIVE_BUCKET/);
});

test('restoring turns every archived file back into its database key, and skips what vanished or does not belong', async (t) => {
  const files = { 'raw/2026-11-18.txt': 'line\n', 'hours/2026-11-18.json': '{}', 'visits/2026-11-18.json': '{"visits":1}', [STATE_FILE]: '{"v":3}', 'check/last.txt': 'x', 'raw/2026-11-19.txt': null };
  t.mock.method(globalThis, 'fetch', async (url) => {
    const address = new URL(url);
    if (address.searchParams.get('list-type') === '2') return new Response(`<ListBucketResult>${Object.keys(files).map((name) => `<Key>${name}</Key>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);
    const body = files[address.pathname.replace('/backup/', '')];
    return body === null ? new Response('', { status: 404 }) : new Response(body);
  });
  const { writes, counts } = await archivedWrites(cfg);
  assert.deepEqual(writes.map((op) => op.set).toSorted(), [
    ['mxo:hours:2026-11-18', '{}'],
    ['mxo:raw:2026-11-18', 'line\n'],
    ['mxo:state', '{"v":3}'],
    ['mxo:visitday:2026-11-18', '{"visits":1}'],
  ]);
  assert.deepEqual(counts, { raw: 1, hours: 1, visits: 1, state: 1 });
});
