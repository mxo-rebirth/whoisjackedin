// The owner's own addresses each take their own key as "Authorization: Bearer <key>": CRON_SECRET runs the
// minute job, READ_SECRET reads the visit numbers. Whatever reads the numbers cannot run the job.
import { timingSafeEqual } from 'node:crypto';

/**
 * True when the request carries the key in the setting `name`. Without that setting, nobody does. A key equal to
 * CRON_SECRET opens only the job, so setting both to one value cannot join them again.
 */
export function holdsKey(req, name) {
  const secret = process.env[name];
  if (!secret || (name !== 'CRON_SECRET' && secret === process.env.CRON_SECRET)) return false;
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
