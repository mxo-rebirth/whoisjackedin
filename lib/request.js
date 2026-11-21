// The checks a function makes before it answers, so every one refuses the same way.
import { isOwner } from './auth.js';

/** True when the method is one of `methods`. Otherwise answers 405 with the methods that are. */
export function methodAllowed(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader('allow', methods.join(', '));
  res.status(405).end();
  return false;
}

/** True for the owner. Anyone else gets 401. */
export function ownerAllowed(req, res) {
  if (isOwner(req)) return true;
  res.status(401).json({ ok: false, error: 'not allowed' });
  return false;
}
