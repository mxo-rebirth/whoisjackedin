// The read cache in front of the database: it saves reads, but must not hide a reading that is due.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { useTempStore } from './support.mjs';

const dir = await useTempStore('store');
const { mgetRecent } = await import('../lib/store.js');

test('a copy read moments ago is reused, unless it was read before `since`', async () => {
  await writeFile(path.join(dir, 'k'), 'one');
  assert.deepEqual(await mgetRecent(['k']), ['one']);
  await writeFile(path.join(dir, 'k'), 'two'); // written behind the cache's back, as another server copy would
  assert.deepEqual(await mgetRecent(['k']), ['one']);
  assert.deepEqual(await mgetRecent(['k'], { since: Date.now() }), ['two']);
});

test('online, writes go out as one transaction and each answers with the reply to its first command', async (t) => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push({ url, commands: JSON.parse(init.body) });
    return Response.json([{ result: 'OK' }, { result: 12 }, { result: 1 }, { result: 'OK' }]);
  });
  process.env.KV_REST_API_URL = 'https://store.test/';
  process.env.KV_REST_API_TOKEN = 'token';
  t.after(() => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  });
  const { write } = await import('../lib/store.js');
  const answers = await write([{ set: ['a', '1', 60] }, { append: ['b', 'line\n', 90] }, { set: ['c', '2'] }]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://store.test/multi-exec');
  assert.deepEqual(sent[0].commands, [['SET', 'a', '1', 'EX', 60], ['APPEND', 'b', 'line\n'], ['EXPIRE', 'b', 90], ['SET', 'c', '2']]);
  assert.deepEqual(answers, ['OK', 12, 'OK']);
});

test('on files, writes to the same key land in order, each answering with the new length', async () => {
  const { write } = await import('../lib/store.js');
  const answers = await write([{ append: ['order', 'a'] }, { append: ['order', 'bc'] }, { set: ['other', 'x'] }]);
  assert.deepEqual(answers, [1, 3, 'OK']);
  assert.equal(await readFile(path.join(dir, 'order'), 'utf8'), 'abc');
});
