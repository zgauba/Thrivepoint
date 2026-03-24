// ─── Thrivepoint Service Worker ──────────────────────────────────────────────
// Bump CACHE version on every deploy to trigger the auto-update flow

const CACHE = 'thrivepoint-v4';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ─── Install: precache all assets + skip waiting immediately ─────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
  // Skip the "waiting" state — activate immediately, no old-tab blocking
  self.skipWaiting();
});

// ─── Activate: delete old caches → claim clients → broadcast update ──────────
// Order matters for iOS: claim() BEFORE postMessage so every window is
// already controlled when the reload signal arrives.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
          .then(clients =>
            clients.forEach(client =>
              client.postMessage({ type: 'SW_UPDATED', version: CACHE })
            )
          )
      )
  );
});

// ─── Fetch strategy ───────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Network-first for HTML navigation requests
  if (request.mode === 'navigate' ||
      (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
          return res;
        })
        .catch(() =>
          caches.match(request).then(r => r || caches.match('/index.html'))
        )
    );
    return;
  }

  // Network-first with cache fallback for Google Fonts
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for all other assets (icons, scripts, styles)
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
        }
        return res;
      });
    })
  );
});

// ─── Message handler ──────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
