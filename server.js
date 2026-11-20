// Runs the site locally the way the host does: the same api/ functions, rewrites and headers,
// and public/. Storage is a folder of files, and a timer takes the samples the outside scheduler takes live.
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5177);
const HOST = process.env.HOST ?? '127.0.0.1';
const PUBLIC = path.join(ROOT, 'public');
// Without Redis settings in the environment, samples go to files in this folder.
process.env.MXO_DATA_DIR ??= path.join(ROOT, 'data', 'kv');

const { SAMPLE_MS, collect } = await import('./lib/core.js');
const { rewrite } = await import('./lib/rewrite.js');
const config = JSON.parse(await readFile(path.join(ROOT, 'vercel.json'), 'utf8'));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg',
};

const cookiesOf = (header) => Object.fromEntries(String(header ?? '').split(/;\s*/).filter(Boolean).map((pair) => [pair.split('=')[0], pair.slice(pair.indexOf('=') + 1)]));

/** Adds what the host's functions expect: req.query, req.body, res.status(), res.json(), res.send(). */
function hostStyle(req, res, url, body) {
  req.query = Object.fromEntries(url.searchParams);
  req.body = body;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (value) => {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(value));
  };
  res.send = (value) => {
    if (!res.getHeader('content-type')) res.setHeader('content-type', typeof value === 'string' ? 'text/html; charset=utf-8' : 'application/octet-stream');
    res.end(value);
  };
}

/** A POST body sent as JSON, as the host reads it. Anything else gives undefined. */
async function readBody(req) {
  if (req.method !== 'POST' || !String(req.headers['content-type']).startsWith('application/json')) return undefined;
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 10_000) return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const functions = new Map();
/** The function in api/ with this name, or null. */
async function functionFor(name) {
  if (!/^[a-z]+$/.test(name)) return null;
  if (!functions.has(name)) {
    const file = path.join(ROOT, 'api', `${name}.js`);
    functions.set(name, await import(pathToFileURL(file)).then((module) => module.default).catch(() => null));
  }
  return functions.get(name);
}

const server = http.createServer(async (req, res) => {
  const url = rewrite(config.rewrites, new URL(req.url, `http://${req.headers.host ?? 'localhost'}`), cookiesOf(req.headers.cookie));
  for (const { key, value } of config.headers?.[0]?.headers ?? []) res.setHeader(key, value);
  try {
    const name = /^\/api\/([^/]+)$/.exec(url.pathname)?.[1];
    if (name) {
      // Visits are only counted on the real site. Here the call is answered and dropped.
      if (name === 'hit') return void res.writeHead(204).end();
      const handler = await functionFor(name);
      if (!handler) return void res.writeHead(404).end();
      // The functions ask for a Secure cookie only when the page came over https.
      req.headers['x-forwarded-proto'] = 'http';
      hostStyle(req, res, url, await readBody(req));
      return void (await handler(req, res));
    }
    // Everything else is a built file. A path that tries to leave public/ is not found.
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, { allow: 'GET, HEAD' }).end();
    const file = path.join(PUBLIC, path.normalize(decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(file)]) return void res.writeHead(404).end();
    const body = await readFile(file).catch(() => null);
    if (!body) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)], 'cache-control': 'no-cache' }).end(body);
  } catch (err) {
    console.warn(err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Something went wrong. If public/page.html is missing, run "npm run build" first.');
  }
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
  console.log(`Who is jacked in: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Samples are saved in ${process.env.MXO_DATA_DIR}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
