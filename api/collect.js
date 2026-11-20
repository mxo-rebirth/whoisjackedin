// The scheduler calls this once a minute. It needs "Authorization: Bearer <CRON_SECRET>".
import { failed, isOwner } from '../lib/auth.js';
import { collect } from '../lib/sampler.js';
import { storeKind } from '../lib/store.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('allow', 'GET, POST');
    res.status(405).end();
    return;
  }
  if (!isOwner(req)) {
    res.status(401).json({ ok: false, error: 'not allowed' });
    return;
  }
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
