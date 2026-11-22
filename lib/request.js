// The checks a function makes before it answers, so every one refuses the same way.
import { holdsKey } from './auth.js';

/** True when the method is one of `methods`. Otherwise answers 405 with the methods that are. */
export function methodAllowed(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader('allow', methods.join(', '));
  res.status(405).end();
  return false;
}

/** True when the request carries the key in the setting `name`. Anyone else gets 401. */
export function keyAllowed(req, res, name) {
  if (holdsKey(req, name)) return true;
  res.status(401).json({ ok: false, error: 'not allowed' });
  return false;
}
