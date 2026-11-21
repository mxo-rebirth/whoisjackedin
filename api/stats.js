import { failed } from '../lib/auth.js';
import { methodAllowed } from '../lib/request.js';
import { RANGES, buildStats } from '../lib/stats.js';

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ['GET'])) return;
  // Only ?range= and ?tz= are known, so made-up parameters cannot be used to dodge the cache.
  if (Object.keys(req.query ?? {}).some((name) => name !== 'range' && name !== 'tz')) {
    res.status(400).json({ error: 'unknown parameter' });
    return;
  }
  // Only the known ranges are answered. A made-up one would get its own cache entry and a database read.
  const range = req.query?.range;
  if (range !== undefined && !Object.hasOwn(RANGES, String(range))) {
    res.status(400).json({ error: 'unknown range' });
    return;
  }
  // The viewer's time zone, as whole hours ahead of UTC. Only real offsets are answered.
  const tz = req.query?.tz === undefined ? 0 : Number(req.query.tz);
  if (!Number.isInteger(tz) || tz < -12 || tz > 14 || String(tz) !== String(req.query?.tz ?? 0)) {
    res.status(400).json({ error: 'unknown time zone' });
    return;
  }
  try {
    const stats = await buildStats(String(range ?? ''), tz);
    // A short stale window: a quiet site would otherwise hand out numbers minutes old. It adds no function runs.
    res.setHeader('cache-control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=10');
    res.status(200).json(stats);
  } catch (err) {
    failed(res, err, 'stats are not available right now');
  }
}
