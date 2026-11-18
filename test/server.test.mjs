// The local server runs the same functions as Vercel, with vercel.json's rewrites and headers. This starts it
// on made-up data and asks it what a browser would. It needs a build (npm run build) and is skipped without one.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const built = existsSync(path.join(ROOT, 'public', 'page.html'));
const PORT = 5297;
const base = `http://127.0.0.1:${PORT}`;
let dir;
let child;

before(async () => {
  if (!built) return;
  dir = await mkdtemp(path.join(tmpdir(), 'mxo-server-'));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'seed.mjs'), dir, '2'], { stdio: 'ignore' });
  const env = { ...process.env, MXO_DATA_DIR: dir, MXO_NO_TIMER: '1', PORT: String(PORT) };
  for (const name of ['CRON_SECRET', 'VERCEL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete env[name];
  child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => child.stdout.on('data', (chunk) => String(chunk).includes('Who is jacked in') && resolve()));
});
after(async () => {
  child?.kill();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const get = (address, headers = {}) => fetch(base + address, { headers, redirect: 'manual' });
const only = built ? test : test.skip;

only('the page comes with its numbers and the security headers from vercel.json', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  const page = await res.text();
  assert.match(page, /id="boot">\{"now":/);
  assert.ok(!page.includes('api/model'), 'the public page has no trace of the private part');
  assert.ok(!page.includes('github.com'), 'the repo links appear only with ?links');
  assert.match(await (await get('/?links')).text(), /github\.com\/hesitancy9996\/mxo-apple-silicon/);
});

only('the private link, its cookie, and switching it off', async () => {
  const linked = await get('/?rsi=local');
  assert.match(await linked.text(), /api\/model\?f=cast\.js&k=local/);
  assert.match(linked.headers.get('set-cookie'), /^rsid=local;.*HttpOnly/);
  assert.doesNotMatch(linked.headers.get('set-cookie'), /Secure/, 'plain http on your own computer');
  assert.equal(linked.headers.get('cache-control'), 'private, no-store');
  // The cookie alone reaches the page through the rewrite in vercel.json.
  assert.match(await (await get('/', { cookie: 'rsid=local' })).text(), /api\/model\?f=cast\.js/);
  const off = await get('/?rsi=off', { cookie: 'rsid=local' });
  assert.ok(!(await off.text()).includes('api/model'));
  assert.match(off.headers.get('set-cookie'), /^rsid=; Max-Age=0/);
});

only('the numbers, and the parameters they refuse', async () => {
  const res = await get('/api/stats?range=7d&tz=2');
  assert.equal(res.status, 200);
  const stats = await res.json();
  assert.equal(stats.history.range, '7d');
  assert.ok(!('page' in stats), 'visit totals are not public');
  assert.equal((await get('/api/stats?range=7d&nope=1')).status, 400);
  assert.equal((await get('/api/stats?range=2y')).status, 400);
  assert.equal((await get('/api/stats?tz=99')).status, 400);
});

only('the private files need the key', async () => {
  // A copy without the built characters answers "not found" here too.
  if (existsSync(path.join(ROOT, 'art', 'models', 'tyndall.bin'))) assert.equal((await get('/api/model?f=tyndall.bin&k=local')).status, 200);
  assert.equal((await get('/api/model?f=tyndall.bin')).status, 404);
  assert.equal((await get('/api/model?f=../.env.local&k=local')).status, 404);
});

only('built files are served, nothing outside public/ is', async () => {
  const script = (await readdir(path.join(ROOT, 'public', 'assets'))).find((name) => /^app-.+\.js$/.test(name));
  assert.equal((await get(`/assets/${script}`)).status, 200);
  assert.equal((await get('/robots.txt')).status, 200);
  for (const address of ['/../package.json', '/%2e%2e/package.json', '/api/nothing', '/server.js']) assert.equal((await get(address)).status, 404, address);
  assert.equal((await fetch(`${base}/api/hit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 204);
  assert.equal((await get('/api/collect')).status, 401, 'the sampler needs the secret, as on the site');
});
