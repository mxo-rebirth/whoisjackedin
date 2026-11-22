// Visit numbers for the site's owner. It needs "Authorization: Bearer <READ_SECRET>".
import { failed } from '../lib/auth.js';
import { keyAllowed, methodAllowed } from '../lib/request.js';
import { visitSummary } from '../lib/visits.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (!methodAllowed(req, res, ['GET'])) return;
  if (!keyAllowed(req, res, 'READ_SECRET')) return;
  // Up to ten years: after 90 days the answer comes from the daily totals kept for good.
  const days = Math.min(3650, Math.max(1, Number.parseInt(req.query?.days, 10) || 30));
  try {
    res.status(200).json({ ok: true, ...(await visitSummary(days)) });
  } catch (err) {
    failed(res, err);
  }
}
