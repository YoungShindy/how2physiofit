const CACHE_NAME = 'hlx-lernapp-v1';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './favicon-32.png',
  './favicon-16.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => { /* einzelne fehlende Assets sollen die Installation nicht blockieren */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Videos: einmal angesehene Videos bleiben offline verfügbar (cache-first)
  if (url.pathname.includes('/videos/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // data.json: immer versuchen aktuell zu laden (network-first),
  // Cache-Schlüssel ohne Zeitstempel-Parameter, damit der Offline-Fallback funktioniert
  if (url.pathname.endsWith('data.json')) {
    const cacheKey = new Request(url.origin + url.pathname);
    event.respondWith(
      fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone));
        return res;
      }).catch(() => caches.match(cacheKey))
    );
    return;
  }

  // index.html / Startseite: network-first mit Offline-Fallback
  if (url.pathname.endsWith('index.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Alles andere (Icons, Manifest etc.): cache-first mit Netzwerk-Fallback
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
