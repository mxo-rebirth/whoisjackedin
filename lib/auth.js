// The owner's own addresses (the minute job, the visit numbers) need "Authorization: Bearer <CRON_SECRET>".
import { timingSafeEqual } from 'node:crypto';

export function isOwner(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(String(req.headers.authorization ?? ''));
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** The same short answer for every failure. The details go to the log, not to whoever asked. */
export function failed(res, err, message = 'something went wrong') {
  console.error(err);
  res.setHeader('cache-control', 'no-store');
  res.status(500).json({ ok: false, error: message });
}
