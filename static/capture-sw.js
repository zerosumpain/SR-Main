// Offline shell for /capture only.
//
// Scope matters here more than it looks. This file sits at the origin root, so
// its DEFAULT scope is the whole site — and the site now serves four
// applications from one hostname. A worker registered at "/" controls every
// navigation on the origin, which is why the registration in
// src/routes/capture/+layout.svelte narrows it to /capture explicitly.
const CACHE_NAME = 'intel-capture-v1';
const CACHE_PREFIX = 'intel-capture-';
const PRECACHE_URLS = ['/capture'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Only this worker's OWN older caches. The previous version deleted every
    // cache in the origin, so opening /capture once wiped the jkai PWA's
    // immutable-asset cache — and would do the same to any other application's
    // on a site that now hosts several.
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (url.pathname.startsWith('/capture')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
});
