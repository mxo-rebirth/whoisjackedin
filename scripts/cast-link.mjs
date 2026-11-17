// Prints the link that shows the 3D characters. Run "npm run cast-link".
// The key in it is worked out from CAST_SECRET in .env.local. The secret itself is never printed.
import { readFile } from 'node:fs/promises';
import { castKey } from '../lib/cast.js';

const site = process.env.MXO_SITE ?? 'https://whoisjackedin.com';
const env = await readFile(new URL('../.env.local', import.meta.url), 'utf8').catch(() => '');
const secret = process.env.CAST_SECRET ?? /^CAST_SECRET="?([^"\n]+)"?$/m.exec(env)?.[1];
if (!secret) {
  console.error('CAST_SECRET is not set. Put it in .env.local.');
  process.exit(1);
}
console.log(`${site}/?rsi=${castKey(secret)}`);
