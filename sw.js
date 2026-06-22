/* ═══════════════════════════════════════════════════════════════════════════
   FindFilm.ai — Service Worker
   Scope: / (root-level, covers entire origin)

   Strategy:
     • Shell (index.html)  → Network-first, fallback to cache
     • Static assets       → Cache-first, background revalidate
     • API / external      → Network-only (never cache)
   ═══════════════════════════════════════════════════════════════════════════ */

const CACHE  = 'ff-v1';
const SHELL  = [
  '/',
  '/index.html',
  '/assets/site.webmanifest',
  '/assets/apple-touch-icon.png',
  '/assets/favicon.ico',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/og-image.jpg',
];

/* ── Install: pre-cache the app shell ─────────────────────────────────────── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL))
  );
  self.skipWaiting();
});

/* ── Activate: purge old caches ───────────────────────────────────────────── */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── Fetch ────────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET, cross-origin API calls, browser extensions
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin &&
      !url.hostname.endsWith('fonts.googleapis.com') &&
      !url.hostname.endsWith('fonts.gstatic.com')) return;

  // HTML navigation → network-first (always try to get fresh index.html)
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match('/index.html') || caches.match('/'))
    );
    return;
  }

  // Static assets → cache-first, background revalidate (stale-while-revalidate)
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const fetchPromise = fetch(request).then((res) => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      });
      return cached || fetchPromise;
    })
  );
});
