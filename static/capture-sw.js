// Offline shell for /capture only.
//
// Scope matters here more than it looks. This file sits at the origin root, so
// its DEFAULT scope is the whole site — and the site now serves four
// applications from one hostname. A worker registered at "/" controls every
// navigation on the origin, which is why the registration in
// src/routes/capture/+layout.svelte narrows it to /capture explicitly.
// v2: v1 could hold the sign-in page or an error under /capture; activating v2 drops it.
const CACHE_NAME = 'intel-capture-v2';
const CACHE_PREFIX = 'intel-capture-';
const PRECACHE_URLS = ['/capture'];

self.addEventListener('install', (event) => {
  // Not cache.addAll: that stores a redirect's target under /capture, so a
  // worker installed while signed out would precache the sign-in page.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((path) =>
          fetch(path).then((response) => (isCacheable(response) ? cache.put(path, response) : undefined)).catch(() => undefined)
        )
      )
    )
  );
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
          if (isCacheable(response)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          } else if (isSignedOut(response)) {
            // The session is gone (signed out, expired or revoked): the owner's
            // capture page must not stay readable offline on this device.
            clearCaptureCaches();
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
});

// Only a genuine page. A redirect is the sign-in page answering for /capture,
// and caching it (or an error) under /capture would serve that offline
// instead of the shell.
function isCacheable(response) {
  return response.status === 200 && !response.redirected && response.type === 'basic';
}

// What the auth gate answers a request with no session: a redirect to /login,
// or 401/403.
function isSignedOut(response) {
  if (response.status === 401 || response.status === 403) return true;
  if (!response.redirected) return false;
  try {
    return new URL(response.url).pathname === '/login';
  } catch {
    return false;
  }
}

function clearCaptureCaches() {
  return caches
    .keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k))));
}

// The page can ask for the same thing explicitly (e.g. on signing out).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear-capture-cache') event.waitUntil(clearCaptureCaches());
});

// Exposed for the unit test, which loads this file outside a worker.
if (typeof module !== 'undefined') module.exports = { isCacheable, isSignedOut };
