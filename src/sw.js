// Lets the site open as an app, and offline. It keeps the last public page and the built files, nothing else:
// never the private version (it is sent as private, no-store), the numbers or anything else under /api/.
const CACHE = 'whoisjackedin-v1';
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

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/')) return;
  // The page: always fresh from the network; the last public copy only when offline.
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
  // Built files have the version in their name, so a kept copy is always right.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (kept) =>
          kept ??
          fetch(request).then((res) => {
            if (keepable(res)) caches.open(CACHE).then((cache) => cache.put(request, res.clone()));
            return res;
          }),
      ),
    );
  }
});
