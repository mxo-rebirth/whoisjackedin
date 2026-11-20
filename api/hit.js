// The page calls this once when it opens, so visits can be counted. See lib/visits.js for what is kept.
import { recordVisit } from '../lib/visits.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    res.status(405).end();
    return;
  }
  // Only the page itself reports visits: a browser says where a request comes from, in two headers.
  // A script that does not is answered the same way, just not counted.
  let fromPage = false;
  try {
    fromPage = req.headers['sec-fetch-site'] === 'same-origin' && new URL(req.headers.origin).host === req.headers.host;
  } catch {}
  // Visits are scrambled with their own secret. Without it nothing is counted, rather than weakly scrambled.
  const secret = process.env.VISIT_SECRET;
  if (fromPage && secret) {
    try {
      await recordVisit({
        ip: String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim(),
        agent: req.headers['user-agent'],
        country: req.headers['x-vercel-ip-country'],
        referrer: typeof req.body?.from === 'string' ? req.body.from.slice(0, 300) : '',
        host: req.headers.host,
        secret,
      });
    } catch (err) {
      console.warn(`could not count a visit: ${err.message}`);
    }
  }
  res.status(204).end();
}
