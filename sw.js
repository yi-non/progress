/*
 * Service worker for "מסלול 12".
 *
 * What this does and doesn't do:
 * - It caches the app SHELL (index.html + manifest + icon + the Chart.js
 *   library) so the app can boot up and render even with zero connectivity,
 *   including a cold start where the browser has nothing in memory yet.
 * - It deliberately does NOT touch Firebase/Firestore/Google auth network
 *   requests. Firestore already has its own offline cache (IndexedDB) and
 *   its own sync logic; a service worker intercepting those requests could
 *   break its real-time connections. Those requests are left completely
 *   untouched here.
 *
 * Bump CACHE_VERSION whenever you change index.html (or anything else in
 * PRECACHE_URLS) so the new version gets fetched and old caches get purged.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `maslul12-shell-${CACHE_VERSION}`;

const CHART_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  CHART_JS_URL,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('maslul12-shell-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

function isFirebaseOrGoogleRequest(url) {
  return (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('gstatic.com') && url.pathname.includes('/firebasejs/')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept writes

  const url = new URL(req.url);

  // Let all Firebase/Firestore/Auth SDK and API traffic go straight to the
  // network untouched — Firestore's own offline cache handles that layer.
  if (isFirebaseOrGoogleRequest(url)) return;

  // Full-page navigations: try the network first (to get the latest version
  // when online), and fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // The app shell's own static files + the pinned Chart.js library:
  // cache-first, refreshing the cache in the background when possible.
  const isShellAsset = PRECACHE_URLS.includes(req.url) || PRECACHE_URLS.includes('.' + url.pathname);
  if (isShellAsset) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
  }
  // Anything else (not part of the shell, not Firebase): leave it to the
  // browser's normal network handling.
});
