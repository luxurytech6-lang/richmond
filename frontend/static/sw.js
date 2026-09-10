// ============================================================
//  CropGuard — Service Worker v2
//  Strategy:
//    • App shell  → Cache First (instant load)
//    • API calls  → Network First, no cache
//    • CDN assets → Stale-While-Revalidate
//    • Icons/imgs → Cache First with 30-day expiry
//    • Offline    → fallback page for navigation requests
// ============================================================

const CACHE_VERSION  = 'v3';
const SHELL_CACHE    = `cropguard-shell-${CACHE_VERSION}`;
const CDN_CACHE       = `cropguard-cdn-${CACHE_VERSION}`;
const IMAGE_CACHE     = `cropguard-images-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/offline.html',
];

const ICON_ASSETS = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/screenshots/screenshot-mobile.png',
  '/screenshots/screenshot-wide.png',
];

const CDN_ORIGINS = [
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

const IMAGE_CACHE_DAYS = 30;
const IMAGE_CACHE_MAX  = 60;

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then(cache =>
        cache.addAll(SHELL_ASSETS).catch(err =>
          console.warn('[SW] Shell cache partial fail:', err)
        )
      ),
      caches.open(IMAGE_CACHE).then(cache =>
        cache.addAll(ICON_ASSETS).catch(err =>
          console.warn('[SW] Icon cache partial fail:', err)
        )
      ),
    ])
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  const KEEP = [SHELL_CACHE, CDN_CACHE, IMAGE_CACHE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => !KEEP.includes(k))
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // 1. Flask API (+ health check) — Network Only (never cache)
  //    /health is included here because it's polled on every load with a
  //    tight client-side timeout; routing it through the cache-write path
  //    in rule 5 added enough latency to cause spurious timeouts and
  //    falsely mark the backend as unavailable.
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline — API unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // 2. CDN (TF.js, fonts) — Stale-While-Revalidate
  if (CDN_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  // 3. Images / icons — Cache First with expiry
  if (
    request.destination === 'image' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/screenshots/')
  ) {
    event.respondWith(cacheFirstWithExpiry(request, IMAGE_CACHE));
    return;
  }

  // 4. App shell + navigation — Cache First, fallback to offline page
  if (
    SHELL_ASSETS.includes(url.pathname) ||
    request.mode === 'navigate'
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request)
          .then(response => {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then(c => c.put(request, clone));
            return response;
          })
          .catch(() => caches.match('/offline.html'));
      })
    );
    return;
  }

  // 5. Everything else — Network with cache fallback
  //    Guards against resolving `undefined` (which Chrome reports as
  //    net::ERR_FAILED) when both the network call AND the cache lookup miss.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(SHELL_CACHE).then(c => c.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(
          cached => cached || new Response('', { status: 503, statusText: 'Offline' })
        )
      )
  );
});

// ── Helpers ───────────────────────────────────────────────────

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    cache.match(request).then(cached => {
      const fetchPromise = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      });
      return cached || fetchPromise;
    })
  );
}

function cacheFirstWithExpiry(request, cacheName) {
  return caches.open(cacheName).then(cache =>
    cache.match(request).then(async cached => {
      if (cached) {
        const dateHeader = cached.headers.get('date');
        if (dateHeader) {
          const age = (Date.now() - new Date(dateHeader).getTime()) / 86400000;
          if (age < IMAGE_CACHE_DAYS) return cached;
        } else {
          return cached; // no date header, serve anyway
        }
      }
      try {
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone());
          trimCache(cache, IMAGE_CACHE_MAX);
        }
        return response;
      } catch {
        return cached || new Response('', { status: 404 });
      }
    })
  );
}

async function trimCache(cache, maxItems) {
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await Promise.all(keys.slice(0, keys.length - maxItems).map(k => cache.delete(k)));
  }
}

// ── Push Notifications (stub) ─────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? { title: 'CropGuard', body: 'New alert' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:  data.body,
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});