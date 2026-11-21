// Rebuilds a data folder from the archive, to look at the whole history on your own computer or to prove the
// backup works. Usage: npm run restore -- <folder>   then   MXO_DATA_DIR=<folder> MXO_NO_TIMER=1 npm start
// It reads the ARCHIVE_* settings from .env.local and only ever writes to that folder, never to the live database.
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { bucketConfig } from '../lib/helpers/bucket.js';
import { localEnv } from '../lib/site.js';

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: npm run restore -- <folder>');
  process.exit(1);
}
const cfg = bucketConfig(await localEnv());
if (!cfg) {
  console.error('The ARCHIVE_* settings are missing from .env.local.');
  process.exit(1);
}
const dir = path.resolve(folder);
await mkdir(dir, { recursive: true });
if ((await readdir(dir)).length) {
  console.error(`${dir} is not empty. Restore into a new folder.`);
  process.exit(1);
}
// The store writes to the folder only: without these it could not reach the database.
process.env.MXO_DATA_DIR = dir;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
const { archivedWrites } = await import('../lib/archive.js');
const { write } = await import('../lib/store.js');

const { writes, counts } = await archivedWrites(cfg);
await write(writes);
console.log(`Restored into ${dir}: ${counts.raw} minute logs, ${counts.hours} days of hourly totals, ${counts.visits} days of visit totals${counts.state ? ', the state' : ''}.`);
console.log(`Open it with: MXO_DATA_DIR=${dir} MXO_NO_TIMER=1 npm start`);
