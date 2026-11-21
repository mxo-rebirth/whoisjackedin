// Lets the site open as an app and offline. It keeps the last public page and the built files, never anything
// private or under /api/. A new cache name clears what older versions kept.
const CACHE = 'whoisjackedin-v2';
const PAGE = '/';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** Only answers meant to be shared are kept. */
const keepable = (res) => res.ok && !/no-store|private/.test(res.headers.get('cache-control') ?? '');

/** Hands the answer on and keeps a copy of it. With `replacing`, older kept files whose path matches are let go first. */
function keep(request, res, { replacing = null } = {}) {
  if (keepable(res)) store(request, res.clone(), replacing);
  return res;
}

function store(request, copy, replacing) {
  caches.open(CACHE).then(async (cache) => {
    if (replacing) await dropMatching(cache, replacing);
    await cache.put(request, copy);
  });
}

async function dropMatching(cache, pattern) {
  const old = (await cache.keys()).filter((kept) => pattern.test(new URL(kept.url).pathname));
  await Promise.all(old.map((kept) => cache.delete(kept)));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/')) return;
  // The page: always fresh from the network, the last public copy only when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (keepable(res) && url.pathname === PAGE && !url.search) caches.open(CACHE).then((cache) => cache.put(PAGE, res.clone()));
          return res;
        })
        .catch(() => caches.match(PAGE).then((res) => res ?? Response.error())),
    );
    return;
  }
  if (!url.pathname.startsWith('/assets/')) return;
  // The script bundle has its version in its name, so a kept copy is always right. A new one replaces the old.
  if (/^\/assets\/app-[A-Za-z0-9]+\.js$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then((kept) => kept ?? fetch(request).then((res) => keep(request, res, { replacing: /^\/assets\/app-/ }))));
    return;
  }
  // Other files keep their names when they change (theme.js, icons, licenses): fresh from the network,
  // the kept copy only when offline.
  event.respondWith(fetch(request).then((res) => keep(request, res)).catch(() => caches.match(request).then((res) => res ?? Response.error())));
});
