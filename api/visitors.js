// Visit numbers for the site's owner. It needs "Authorization: Bearer <CRON_SECRET>", like api/collect.
import { failed, isOwner } from '../lib/auth.js';
import { visitSummary } from '../lib/visits.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    res.status(405).end();
    return;
  }
  if (!isOwner(req)) {
    res.status(401).json({ ok: false, error: 'not allowed' });
    return;
  }
  // Up to ten years: after 90 days the answer comes from the daily totals kept for good.
  const days = Math.min(3650, Math.max(1, Number.parseInt(req.query?.days, 10) || 30));
  try {
    res.status(200).json({ ok: true, ...(await visitSummary(days)) });
  } catch (err) {
    failed(res, err);
  }
}
