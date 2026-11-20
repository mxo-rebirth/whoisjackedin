// The read cache in front of the database: it saves reads, but must not hide a reading that is due.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = await mkdtemp(path.join(tmpdir(), 'mxo-store-'));
process.env.MXO_DATA_DIR = dir;
delete process.env.KV_REST_API_URL;
const { mgetRecent } = await import('../lib/store.js');
after(() => rm(dir, { recursive: true, force: true }));

test('a copy read moments ago is reused, unless it was read before `since`', async () => {
  await writeFile(path.join(dir, 'k'), 'one');
  assert.deepEqual(await mgetRecent(['k']), ['one']);
  await writeFile(path.join(dir, 'k'), 'two'); // written behind the cache's back, as another server copy would
  assert.deepEqual(await mgetRecent(['k']), ['one']);
  assert.deepEqual(await mgetRecent(['k'], { since: Date.now() }), ['two']);
});
