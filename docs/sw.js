/* Axiom service worker: network-first for the app page (fresh updates), cache fallback offline */
const CACHE = 'axiom-vmvmh0ic8';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './vendor/pdf.min.js', './vendor/pdf.worker.min.js', './vendor/epub.min.js', './vendor/jszip.min.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const cacheable = url.origin === location.origin || url.host.includes('cdnjs') || url.host.includes('fonts.g');
  if (!cacheable) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    try {
      const res = await fetch(req);
      if (res && res.ok) c.put(req, res.clone());
      return res;
    } catch (err) {
      return (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? c.match('./index.html') : Response.error());
    }
  }));
});
