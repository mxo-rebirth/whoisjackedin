// Lets the site open as an app, and offline. It keeps the last public page and the built files, nothing else:
// never the private version (it is sent as private, no-store), the numbers or anything else under /api/.
// A new name clears what older versions of this file kept, piled-up script bundles included.
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

/** Keeps a copy of the answer. With `replacing`, older kept files whose path matches are let go first. */
function keep(request, res, { replacing = null } = {}) {
  if (keepable(res)) {
    const copy = res.clone();
    caches.open(CACHE).then(async (cache) => {
      if (replacing) for (const old of await cache.keys()) if (replacing.test(new URL(old.url).pathname)) await cache.delete(old);
      await cache.put(request, copy);
    });
  }
  return res;
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
