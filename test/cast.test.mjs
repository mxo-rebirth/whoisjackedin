// The private version: which files can be asked for, and how the key travels in the link and the cookie.
import assert from 'node:assert/strict';
import { test } from 'node:test';

delete process.env.CRON_SECRET;
delete process.env.CAST_SECRET;
delete process.env.VERCEL;
const { LOCAL_KEY, castFile, castKey, castOf, castSecret, hasCastKey, withCast } = await import('../lib/cast.js');

test('without the secret, on your own computer, the key is LOCAL_KEY', () => {
  assert.equal(castKey(), LOCAL_KEY);
  assert.ok(hasCastKey(LOCAL_KEY));
  assert.ok(!hasCastKey('nope'));
  assert.match(castKey('a secret'), /^HL(-[0-9A-F]{4}){5}$/);
});

test('only CAST_SECRET makes the key, so the private link changes without touching CRON_SECRET', () => {
  assert.equal(castSecret({ CRON_SECRET: 'cron' }), undefined);
  assert.equal(castSecret({ CRON_SECRET: 'cron', CAST_SECRET: 'cast' }), 'cast');
  assert.notEqual(castKey('cast'), castKey('other'));
});

test('only the cast\'s own files can be asked for', () => {
  assert.deepEqual(castFile('cast.js').path, 'private/cast.js');
  assert.deepEqual(castFile('icon/disc_spy.png').path, 'art/icons/disc_spy.png');
  assert.deepEqual(castFile('flood.bin').path, 'art/models/flood.bin');
  for (const bad of ['../.env.local', 'icon/../x.png', 'x.js', '/etc/passwd', 'flood.bin/..', '', null]) assert.equal(castFile(bad), null, String(bad));
});

test('a good link sets the cookie; the cookie alone keeps the private version; a wrong link clears it', () => {
  const linked = castOf(LOCAL_KEY, '');
  assert.equal(linked.key, LOCAL_KEY);
  assert.match(linked.cookie, /^hardline=HL-0000-0000-0000-0000-0000; Max-Age=31536000; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
  assert.doesNotMatch(castOf(LOCAL_KEY, '', { secure: false }).cookie, /Secure/);
  assert.deepEqual(castOf(null, 'theme=dark; hardline=HL-0000-0000-0000-0000-0000'), { key: LOCAL_KEY, cookie: null });
  const off = castOf('HL-0', 'hardline=HL-0000-0000-0000-0000-0000');
  assert.equal(off.key, null);
  assert.match(off.cookie, /^hardline=; Max-Age=0/);
  assert.deepEqual(castOf(null, ''), { key: null, cookie: null });
});

test('the private page gets one more script, with the key', () => {
  assert.equal(withCast('<body></body>', 'k$1'), '<body><script defer src="/api/model?f=cast.js&k=k%241"></script>\n</body>');
});

test('the hardline code is accepted in any letter case, and nothing else is', () => {
  process.env.CAST_SECRET = 'a secret';
  const key = castKey();
  assert.ok(hasCastKey(key));
  assert.ok(hasCastKey(key.toLowerCase()));
  assert.ok(!hasCastKey(key.slice(0, -1)));
  assert.ok(!hasCastKey(key.replaceAll('-', '')));
  delete process.env.CAST_SECRET;
});

test('the private page links an app manifest that starts at its code', async () => {
  const { manifest } = await import('../lib/manifest.js');
  const page = withCast('<link rel="manifest" href="/manifest.webmanifest"></body>', LOCAL_KEY);
  assert.match(page, new RegExp(`<link rel="manifest" href="/api/manifest\\?code=${LOCAL_KEY}">`));
  assert.equal(manifest(LOCAL_KEY).start_url, `/${LOCAL_KEY}`);
  assert.equal(manifest().start_url, '/');
  assert.equal(manifest(LOCAL_KEY).id, manifest().id);
});
