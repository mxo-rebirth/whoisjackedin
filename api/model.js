// Hands out a file of the 3D characters, and only to a request that carries the key (see lib/cast.js).
// Without the key every answer is "not found", as if this address did not exist.
import { readFile } from 'node:fs/promises';
import { castFile, hasCastKey } from '../lib/cast.js';

export default async function handler(req, res) {
  const query = req.query ?? {};
  const file = castFile(query.f);
  // Only ?f= and ?k= are known.
  if (req.method !== 'GET' || Object.keys(query).some((name) => name !== 'f' && name !== 'k') || !hasCastKey(query.k) || !file) {
    res.setHeader('cache-control', 'no-store');
    res.status(404).end();
    return;
  }
  try {
    const body = await readFile(new URL(`../${file.path}`, import.meta.url));
    res.setHeader('content-type', file.type);
    // The script changes with each release, so the browser checks for a newer one every time. Models and pictures
    // rarely change and may be kept for ten minutes.
    res.setHeader('cache-control', query.f === 'cast.js' ? 'private, no-cache' : 'private, max-age=600');
    res.status(200).send(body);
  } catch {
    res.setHeader('cache-control', 'no-store');
    res.status(404).end();
  }
}
