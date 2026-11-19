// Visit numbers for the site's owner. It needs "Authorization: Bearer <CRON_SECRET>", like api/collect.
import { timingSafeEqual } from 'node:crypto';
import { visitSummary } from '../lib/visits.js';

function allowed(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(String(req.headers.authorization ?? ''));
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    res.status(405).end();
    return;
  }
  if (!allowed(req)) {
    res.status(401).json({ ok: false, error: 'not allowed' });
    return;
  }
  // Up to ten years: after 90 days the answer comes from the daily totals kept for good.
  const days = Math.min(3650, Math.max(1, Number.parseInt(req.query?.days, 10) || 30));
  try {
    res.status(200).json({ ok: true, ...(await visitSummary(days)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message).slice(0, 200) });
  }
}
