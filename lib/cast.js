// The cast: the game's 3D characters and icons. The public page has no trace of it. A link with the key
// gets one more script, which fetches the models with the same key.
import { createHash, timingSafeEqual } from 'node:crypto';
import { online } from './site.js';

/**
 * The key comes from CAST_SECRET and cannot be turned back into it. Changing CAST_SECRET retires a shared link.
 * Without it, a local copy uses LOCAL_KEY and the live site has no private version.
 */
export const LOCAL_KEY = 'HL-0000-0000-0000-0000-0000';

export const castSecret = (env = process.env) => env.CAST_SECRET;

/** Written like a hardline code from the game: HL and five groups of four, e.g. HL-7F3A-9C2D-41B0-E8D5-AA90. */
export function castKey(secret = castSecret()) {
  if (secret) {
    const hex = createHash('sha256').update(`cast|${secret}`).digest('hex').slice(0, 20).toUpperCase();
    return `HL-${hex.match(/.{4}/g).join('-')}`;
  }
  return online() ? null : LOCAL_KEY;
}

export function hasCastKey(given) {
  const key = castKey();
  if (!key || typeof given !== 'string') return false;
  // Letter case does not matter, so a code typed by hand works too.
  const want = Buffer.from(key.toUpperCase());
  const got = Buffer.from(given.toUpperCase());
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Where a cast file is kept and its type, or null for any other name. "cast.js" is the script build.mjs
 * makes, "icon/..." a game icon, and anything else a model, a texture or a set of moves.
 */
export function castFile(name) {
  if (name === 'cast.js') return { path: 'private/cast.js', type: 'text/javascript; charset=utf-8' };
  const icon = /^icon\/([a-z0-9_]+)\.png$/.exec(String(name))?.[1];
  if (icon) return { path: `art/icons/${icon}.png`, type: 'image/png' };
  const type = { bin: 'application/octet-stream', jpg: 'image/jpeg', png: 'image/png' }[/^[a-z0-9_-]+\.(bin|jpg|png)$/.exec(String(name))?.[1]];
  return type ? { path: `art/models/${name}`, type } : null;
}

/**
 * Which page a request gets. The key comes in the link (whoisjackedin.com/HL-...) or in the cookie a good link
 * leaves, so later visits stay private without the link. Returns the key (null for the public page) and the cookie
 * to send, if any. A link with a wrong code, such as /HL-0, takes the cookie away.
 */
export function castOf(linkKey, cookieHeader, { secure = true } = {}) {
  // The cookie has its own name. The host hands a cookie that a rewrite looks for to the function as a query
  // value of the same name, and that must not be mistaken for the key in a link.
  const saved = /(?:^|;\s*)hardline=([^;]*)/.exec(String(cookieHeader ?? ''))?.[1] ?? null;
  const tail = `; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  if (hasCastKey(linkKey)) return { key: linkKey, cookie: `hardline=${linkKey}; Max-Age=31536000${tail}` };
  if (linkKey == null && hasCastKey(saved)) return { key: saved, cookie: null };
  return { key: null, cookie: saved === null ? null : `hardline=; Max-Age=0${tail}` };
}

/** The page for a visitor with the key: the cast's script, and an app manifest that starts at the code. */
export function withCast(page, key) {
  const code = encodeURIComponent(key);
  return page
    .replace('<link rel="manifest" href="/manifest.webmanifest">', () => `<link rel="manifest" href="/api/manifest?code=${code}">`)
    .replace('</body>', () => `<script defer src="/api/model?f=cast.js&k=${code}"></script>\n</body>`);
}
