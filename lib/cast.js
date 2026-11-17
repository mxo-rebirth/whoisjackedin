// The cast: the game's art (the 3D characters and the icons). The public page has no trace of it. A visitor whose link carries the key
// gets the page with one more script in it, and that script fetches the models with the same key.
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The key comes from CAST_SECRET and cannot be turned back into it. Changing CAST_SECRET retires a shared link.
 * Without it, a local copy uses the key "local" and the live site has no private version.
 */
export const castSecret = (env = process.env) => env.CAST_SECRET;

/** Written like a hardline code from the game: HL and five groups of four, e.g. HL-7F3A-9C2D-41B0-E8D5-AA90. */
export function castKey(secret = castSecret()) {
  if (secret) {
    const hex = createHash('sha256').update(`cast|${secret}`).digest('hex').slice(0, 20).toUpperCase();
    return `HL-${hex.match(/.{4}/g).join('-')}`;
  }
  return process.env.VERCEL ? null : 'local';
}

/** True when `given` is the key. */
export function hasCastKey(given) {
  const key = castKey();
  if (!key || typeof given !== 'string') return false;
  // Letter case does not matter, so a code typed by hand works too.
  const want = Buffer.from(key.toUpperCase());
  const got = Buffer.from(given.toUpperCase());
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Where a file of the cast is kept and what kind it is, or null when the name is not one of theirs.
 * "cast.js" is the script built by build.mjs, "icon/..." is one of the game's icons, and everything else is
 * a model, a texture or a set of moves.
 */
export function castFile(name) {
  if (name === 'cast.js') return { path: 'private/cast.js', type: 'text/javascript; charset=utf-8' };
  const icon = /^icon\/([a-z0-9_]+)\.png$/.exec(String(name))?.[1];
  if (icon) return { path: `src/icons/${icon}.png`, type: 'image/png' };
  const type = { bin: 'application/octet-stream', jpg: 'image/jpeg', png: 'image/png' }[/^[a-z0-9_-]+\.(bin|jpg|png)$/.exec(String(name))?.[1]];
  return type ? { path: `src/models/${name}`, type } : null;
}

/**
 * Which version of the page a request gets. The key can come in the link (?rsi=...) or in the cookie that a
 * good link leaves behind, so the visitor stays in the private version on later visits without the link.
 * Returns the key to use (or null for the public page) and the cookie to send back, if any. A link with a
 * wrong key, such as ?rsi=off, takes the cookie away again.
 */
export function castOf(linkKey, cookieHeader, { secure = true } = {}) {
  // The cookie has its own name. Vercel hands a cookie that a rewrite looks for to the function as a query
  // value of the same name, and that must not be mistaken for the key in a link.
  const saved = /(?:^|;\s*)rsid=([^;]*)/.exec(String(cookieHeader ?? ''))?.[1] ?? null;
  const tail = `; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  if (hasCastKey(linkKey)) return { key: linkKey, cookie: `rsid=${linkKey}; Max-Age=31536000${tail}` };
  if (linkKey == null && hasCastKey(saved)) return { key: saved, cookie: null };
  return { key: null, cookie: saved === null ? null : `rsid=; Max-Age=0${tail}` };
}

/** The page with the cast's script added, for a visitor who has the key. */
export function withCast(page, key) {
  return page.replace('</body>', () => `<script defer src="/api/model?f=cast.js&k=${encodeURIComponent(key)}"></script>\n</body>`);
}
