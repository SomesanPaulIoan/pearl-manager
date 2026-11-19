const CACHE = 'pearl-monitor-shell-v19';
const shell = ['/', '/rigs.html', '/navigation.css', '/portfolio.css', '/portfolio.js', '/pearl-earnings.js', '/profitability.css', '/profitability.js', '/rigs.css', '/rigs-ui.js', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('pearl-monitor-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !shell.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(url.pathname)) || Response.error();
  }));
});
