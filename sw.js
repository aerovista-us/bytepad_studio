// BytePad Studio v5 — service worker for installability and offline shell
// Bump CACHE version when deploying to invalidate caches (e.g. bytepad-v5-2).
const CACHE = 'bytepad-v5-2';

const NETWORK_FIRST = ['app.js', 'styles.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(['./', './index.html', './manifest.json'])
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const name = url.pathname.split('/').pop() || '';
  const networkFirst = NETWORK_FIRST.some((n) => name.includes(n));

  if (networkFirst) {
    e.respondWith(
      fetch(e.request).then((r) => r).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request))
  );
});
