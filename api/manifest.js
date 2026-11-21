// The app manifest for the private version: the same app, starting at the visitor's code.
import { hasCastKey } from '../lib/cast.js';
import { manifest } from '../lib/manifest.js';
import { methodAllowed } from '../lib/request.js';

export default function handler(req, res) {
  if (!methodAllowed(req, res, ['GET', 'HEAD'])) return;
  const given = req.query?.code;
  const code = typeof given === 'string' && hasCastKey(given) ? given.toUpperCase() : null;
  res.setHeader('content-type', 'application/manifest+json; charset=utf-8');
  res.setHeader('cache-control', code ? 'private, no-store' : 'public, max-age=3600');
  res.status(200).send(JSON.stringify(manifest(code)));
}
