// The page with the current numbers in it, cached for a minute. A request with the key (lib/cast.js) gets the
// private version, which comes by its own rewrite and is never cached, so it cannot reach anyone else.
import { readFile } from 'node:fs/promises';
import { castOf, withCast } from '../lib/cast.js';
import { buildStats } from '../lib/stats.js';
import { renderPage } from '../lib/page.js';
import { methodAllowed } from '../lib/request.js';
import { online, siteUrl } from '../lib/site.js';

let template = null;

/**
 * The built page travels with this function. If it somehow does not, it is fetched from the site.
 * Read once online, but every time locally, so a new build shows at once.
 */
async function loadTemplate() {
  if (template && online()) return template;
  try {
    template = await readFile(new URL('../public/page.html', import.meta.url), 'utf8');
  } catch {
    // From the site's own address, never from the one the request claims.
    const res = await fetch(`${siteUrl()}/page.html`);
    if (!res.ok) throw new Error(`the page file answered ${res.status}`);
    template = await res.text();
  }
  return template;
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ['GET', 'HEAD'])) return;
  let page;
  try {
    page = await loadTemplate();
  } catch (err) {
    console.error(err);
    res.setHeader('cache-control', 'no-store');
    res.status(503).send('The page is not available right now.');
    return;
  }
  let body = page;
  try {
    body = renderPage(page, await buildStats('24h', 0), { analytics: online() });
  } catch (err) {
    // Without numbers the page still works: its script fetches them.
    console.error(err);
  }
  // The cookie is marked Secure unless the page came over plain http, as it does on your own computer.
  const secure = req.headers['x-forwarded-proto'] !== 'http';
  const { key, cookie } = castOf(typeof req.query?.code === 'string' ? req.query.code : null, req.headers.cookie, { secure });
  if (cookie) res.setHeader('set-cookie', cookie);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  // Anything that depends on the visitor, or sets a cookie, is for that visitor only.
  res.setHeader('cache-control', key || cookie || req.query?.saved ? 'private, no-store' : 'public, max-age=0, s-maxage=60, stale-while-revalidate=30');
  res.status(200).send(key ? withCast(body, key) : body);
}
