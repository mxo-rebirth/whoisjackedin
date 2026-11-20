// The functions behind the site's addresses, called directly: who may read the visit numbers, which visits are
// counted, and which methods are answered.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dir = await mkdtemp(path.join(tmpdir(), 'mxo-api-'));
process.env.MXO_DATA_DIR = dir;
delete process.env.KV_REST_API_URL;
delete process.env.VERCEL;
const { default: visitors } = await import('../api/visitors.js');
const { default: hit } = await import('../api/hit.js');
const { default: manifest } = await import('../api/manifest.js');
const { mget } = await import('../lib/store.js');
const { dayOf } = await import('../lib/time.js');
after(() => rm(dir, { recursive: true, force: true }));

/** A stand-in for the host's response object. */
function response() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (name, value) => (res.headers[name.toLowerCase()] = value);
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (body) => ((res.body = body), res);
  res.send = (body) => ((res.body = body), res);
  res.end = () => res;
  return res;
}
const call = async (handler, req) => {
  const res = response();
  await handler({ method: 'GET', headers: {}, query: {}, ...req }, res);
  return res;
};

test('the visit numbers need the secret', async () => {
  delete process.env.CRON_SECRET;
  assert.equal((await call(visitors, { headers: { authorization: 'Bearer anything' } })).statusCode, 401, 'no secret set: nobody gets in');
  process.env.CRON_SECRET = 'the-secret';
  assert.equal((await call(visitors, {})).statusCode, 401);
  assert.equal((await call(visitors, { headers: { authorization: 'Bearer the-secre' } })).statusCode, 401);
  const ok = await call(visitors, { headers: { authorization: 'Bearer the-secret' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.ok, true);
  assert.equal((await call(visitors, { method: 'POST' })).statusCode, 405);
});

test('a visit counts only when the page itself reports it, and only with the visit secret', async () => {
  const fromPage = { 'sec-fetch-site': 'same-origin', origin: 'https://example.org', host: 'example.org', 'user-agent': 'Mozilla/5.0 Chrome/142', 'x-forwarded-for': '203.0.113.9' };
  const saved = async () => (await mget([`mxo:visits:${dayOf(Date.now())}`]))[0] ?? '';
  delete process.env.VISIT_SECRET;
  assert.equal((await call(hit, { method: 'POST', headers: fromPage })).statusCode, 204);
  assert.equal(await saved(), '', 'without its own secret nothing is counted');
  process.env.VISIT_SECRET = 'visits';
  assert.equal((await call(hit, { method: 'POST', headers: { ...fromPage, 'sec-fetch-site': 'cross-site' } })).statusCode, 204);
  assert.equal((await call(hit, { method: 'POST', headers: { ...fromPage, origin: 'https://elsewhere.example' } })).statusCode, 204);
  assert.equal(await saved(), '', 'another site or a script is answered the same way, but not counted');
  await call(hit, { method: 'POST', headers: fromPage });
  assert.equal((await saved()).trim().split('\n').length, 1);
  assert.equal((await call(hit, { method: 'GET' })).statusCode, 405);
});

test('the app manifest only answers reads', async () => {
  assert.equal((await call(manifest, {})).statusCode, 200);
  assert.equal((await call(manifest, { method: 'POST' })).statusCode, 405);
});
