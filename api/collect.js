// The scheduler calls this once a minute. It needs "Authorization: Bearer <CRON_SECRET>".
import { failed } from '../lib/auth.js';
import { keyAllowed, methodAllowed } from '../lib/request.js';
import { collect } from '../lib/sampler.js';
import { storeKind } from '../lib/store.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (!methodAllowed(req, res, ['GET', 'POST'])) return;
  if (!keyAllowed(req, res, 'CRON_SECRET')) return;
  if (!storeKind()) {
    res.status(503).json({ ok: false, error: 'no storage is connected' });
    return;
  }
  try {
    const { skipped, state } = await collect();
    const servers = Object.fromEntries(
      Object.entries(state.latest).map(([id, s]) => [id, { answered: s.ok, online: s.online ?? null, players: s.players ?? null }]),
    );
    res.status(200).json({ ok: true, skipped, servers });
  } catch (err) {
    failed(res, err);
  }
}
