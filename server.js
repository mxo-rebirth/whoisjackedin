// Runs the stats page on your own machine: same code as on Vercel, with files for storage and a built-in timer.
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5177);
const HOST = process.env.HOST ?? '127.0.0.1';
// The built page. `npm start` builds it first.
const PUBLIC = path.join(ROOT, 'public');
// Without Redis settings in the environment, samples go to files in this folder.
process.env.MXO_DATA_DIR ??= path.join(ROOT, 'data', 'kv');

const { SAMPLE_MS, buildStats, collect } = await import('./lib/core.js');
const { renderPage } = await import('./lib/page.js');
const { castFile, castOf, hasCastKey, withCast } = await import('./lib/cast.js');

// The same security headers as on Vercel, so a page that works here works there.
const config = JSON.parse(await readFile(path.join(ROOT, 'vercel.json'), 'utf8'));
const SHARED_HEADERS = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
const PAGE_HEADERS = { ...SHARED_HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' };
// robots.txt and sitemap.xml sit beside the page.
const ROOT_FILES = { '/robots.txt': 'text/plain; charset=utf-8', '/sitemap.xml': 'application/xml; charset=utf-8' };
const ASSET_TYPES = { '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Visits are only counted on the real site. Here the call is answered and dropped.
  if (req.method === 'POST' && url.pathname === '/api/hit') {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' }).end();
    return;
  }
  if (url.pathname === '/') {
    try {
      const page = await readFile(path.join(PUBLIC, 'page.html'), 'utf8');
      // As on the site: the page is sent with the current numbers already in it.
      let body = page;
      try {
        body = renderPage(page, await buildStats('24h', 0));
      } catch (err) {
        console.warn(err.message);
      }
      // As on the site: with the key in the address, or in the cookie a good link left, the page comes with
      // the game art's script.
      const { key, cookie } = castOf(url.searchParams.get('rsi'), req.headers.cookie, { secure: false });
      res.writeHead(200, cookie ? { ...PAGE_HEADERS, 'set-cookie': cookie } : PAGE_HEADERS).end(key ? withCast(body, key) : body);
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain' }).end('public/page.html is missing. Run "npm run build" first.');
    }
    return;
  }
  if (ROOT_FILES[url.pathname]) {
    try {
      res.writeHead(200, { ...SHARED_HEADERS, 'content-type': ROOT_FILES[url.pathname] }).end(await readFile(path.join(PUBLIC, url.pathname)));
    } catch {
      res.writeHead(404).end();
    }
    return;
  }
  // Only plain file names inside public/assets are served.
  const asset = /^\/assets\/((?:icons\/)?[\w.-]+)$/.exec(url.pathname)?.[1];
  if (asset && ASSET_TYPES[path.extname(asset)]) {
    try {
      const body = await readFile(path.join(PUBLIC, 'assets', asset));
      res.writeHead(200, { ...SHARED_HEADERS, 'content-type': ASSET_TYPES[path.extname(asset)], 'cache-control': 'no-cache' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
    return;
  }
  // The 3D characters' files, only with the key. Here the key is "local" (see lib/cast.js).
  if (url.pathname === '/api/model') {
    const file = castFile(url.searchParams.get('f'));
    const body = file && hasCastKey(url.searchParams.get('k')) ? await readFile(path.join(ROOT, file.path)).catch(() => null) : null;
    if (body) res.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-cache' }).end(body);
    else res.writeHead(404).end();
    return;
  }
  if (url.pathname === '/api/stats') {
    try {
      const tz = Number(url.searchParams.get('tz') ?? 0);
      const body = JSON.stringify(await buildStats(url.searchParams.get('range') ?? '', Number.isInteger(tz) && tz >= -12 && tz <= 14 ? tz : 0));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(body);
    } catch (err) {
      console.warn(err.message);
      res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"stats are not available right now"}');
    }
    return;
  }
  res.writeHead(404).end();
});

async function tick() {
  try {
    await collect();
  } catch (err) {
    console.warn(`could not take a sample: ${err.message}`);
  }
}

if (process.env.MXO_NO_TIMER !== '1') {
  tick();
  setInterval(tick, SAMPLE_MS);
}

server.listen(PORT, HOST, () => {
  console.log(`MxO stats: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Samples are saved in ${process.env.MXO_DATA_DIR}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
