/* ═══════════════════════════════════════════════════════════════════════════
   FindFilm.ai — Service Worker
   Scope: / (root-level, covers entire origin)

   Strategy:
     • Shell (index.html)  → Network-first, fallback to cache
     • Static assets       → Cache-first, background revalidate
     • API / external      → Network-only (never cache)
   ═══════════════════════════════════════════════════════════════════════════ */

const CACHE  = 'ff-v2';

/* Every entry here must actually exist. Removed from the original list:
     • /assets/favicon.ico — never existed in the repo (only favicon.png /
       favicon-16x16.png / favicon-32x32.png do). It 404s on any plain static
       host; on Cloudflare Pages the SPA not_found_handling masks it by
       returning 200 text/html, so an HTML document got cached under an .ico
       URL and was then served cache-first forever.
     • /index.html — Pages 308-redirects it to /, so it was a duplicate of the
       '/' entry fetched via a redirect. '/' alone is the shell. */
const SHELL  = [
  '/',
  '/assets/site.webmanifest',
  '/assets/apple-touch-icon.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/og-image.jpg',
];

/* ── Install: pre-cache the app shell ─────────────────────────────────────── */
/* Cache.addAll() is ATOMIC — a single non-2xx response rejects the whole
   promise, which rejects the install event's waitUntil, which means the worker
   never reaches 'activated'. Chrome requires an active service worker before it
   will fire `beforeinstallprompt`, so one missing icon silently killed the
   entire PWA install prompt. Precaching is an optimisation, not a correctness
   requirement, so add each URL independently and let individual failures pass. */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        // Pages' SPA fallback answers missing assets with 200 text/html. Never
        // let an HTML document get stored under a non-HTML asset URL.
        const isHTML = (res.headers.get('content-type') || '').includes('text/html');
        if (isHTML && url !== '/') throw new Error('SPA fallback HTML, not a real asset');
        await cache.put(url, res);
      } catch (err) {
        console.warn('[sw] precache skipped', url, err.message);
      }
    }));
  })());
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

  // Same-origin /api/* → network-only. This guard was missing: the header
  // comment promised "API → never cache", but with no same-origin exclusion
  // every /api/ GET fell through to the cache-first branch below and was
  // pinned in the cache permanently, so movie/rating data would be served
  // stale forever with only a background revalidate that nobody ever read.
  if (url.pathname.startsWith('/api/')) return;

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
        // NOTE: `caches.match(a) || caches.match(b)` never falls through — a
        // Promise is always truthy — so this has to await the first result.
        .catch(async () => (await caches.match('/')) || Response.error())
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
