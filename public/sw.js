// App-shell service worker: makes cc-watcher installable and lets it open with no connection, so the page can say
// "can't reach the watcher" instead of a browser error. Live data never passes through here — it arrives over the
// WebSocket (which service workers can't intercept) and progress sync (/api/*) is never cached.
importScripts('sprites.js');
const CACHE = 'ccw-shell-v4';
const { still, away, idle } = self.CCW_SPRITES.pose;
const SHELL = ['/', 'demo.js', 'sprites.js', 'progress.js', 'deep.js', 'toys.js', 'manifest.webmanifest', 'icon-192.png', still, away, idle];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first, so a running watcher always serves the current build; the cache is only the offline fallback.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })
    .then(hit => hit ?? (e.request.mode === 'navigate' ? caches.match('/') : Response.error()))));
});
