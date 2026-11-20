// Prints the link that shows the 3D characters. Run "npm run cast-link".
// The key in it is worked out from CAST_SECRET in .env.local. The secret itself is never printed.
import { localEnv, siteUrl } from '../lib/site.js';
import { castKey, castSecret } from '../lib/cast.js';

const env = await localEnv();
const secret = castSecret(env);
if (!secret || !env.MXO_SITE) {
  console.error('Put CAST_SECRET and MXO_SITE (the live address) in .env.local.');
  process.exit(1);
}
const site = siteUrl(env);
console.log(`${site}/${castKey(secret)}`);
