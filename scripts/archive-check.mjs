// Checks the archive from your own computer: lists it, writes a small marker and reads it back.
// Reads the ARCHIVE_* settings from .env.local and never prints them.
import { bucketConfig, getObject, listObjects, putObject } from '../lib/helpers/bucket.js';
import { localEnv } from '../lib/site.js';

const cfg = bucketConfig(await localEnv());
if (!cfg) {
  console.error('The ARCHIVE_* settings are missing from .env.local.');
  process.exit(1);
}
const names = await listObjects(cfg);
console.log(`Objects in the bucket: ${names.length}${names.length ? ` (first: ${names.slice(0, 5).join(', ')})` : ''}`);
const MARKER_FILE = 'check/last.txt';
const marker = `checked ${new Date().toISOString()}`;
await putObject(cfg, MARKER_FILE, marker);
console.log((await getObject(cfg, MARKER_FILE)) === marker ? 'Write and read back: ok' : 'Write and read back: DIFFERENT');
