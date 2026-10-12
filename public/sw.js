/* LofiLoop service worker: offline app shell + asset caching. Hand-written, no build step. */

// Bump when this file's caching logic changes; old caches are removed on activate.
const VERSION = 'v2';
const PREFIX = 'lofiloop-';
const CACHES = {
  precache: `${PREFIX}precache-${VERSION}`,
  static: `${PREFIX}static-${VERSION}`,
  runtime: `${PREFIX}runtime-${VERSION}`,
};
const SHELL_URL = '/';
const PRECACHE_URLS = [SHELL_URL, '/manifest.webmanifest', '/icon.svg', '/pwa-icon/192', '/pwa-icon/512'];
/** Entry caps so hashed assets from old deploys do not pile up forever. */
const MAX_ENTRIES = { static: 400, runtime: 100 };
/** After this long a navigation falls back to the cached page (the network keeps updating it). */
const NAVIGATION_TIMEOUT_MS = 4000;

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>LofiLoop is offline</title><body style="font-family:system-ui;background:#0f0e16;color:#eee;' +
  'display:grid;place-items:center;height:100vh;margin:0"><p>You are offline. Open LofiLoop once while online ' +
  'to use it offline.</p></body>';

// ---------------------------------------------------------------------------
// Lifecycle

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHES.precache).then((cache) =>
      Promise.all(
        // Best effort: a missing icon must not prevent the worker from installing.
        PRECACHE_URLS.map((url) =>
          fetch(url, { cache: 'reload', credentials: 'same-origin' })
            .then((response) => (isCacheable(response) ? cache.put(url, response) : undefined))
            .catch(() => undefined),
        ),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set(Object.values(CACHES));
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(PREFIX) && !keep.has(n)).map((n) => caches.delete(n)));
      if (self.registration && self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => undefined);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Routing

self.addEventListener('fetch', (event) => {
  const strategy = route(event.request);
  if (strategy) event.respondWith(strategy(event));
});

/** Pick a strategy for a request, or null to let the browser handle it untouched. */
function route(request) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;
  // Media range requests and the worker script itself go straight to the network.
  if (request.headers.has('range') || url.pathname === '/sw.js') return null;
  if (url.pathname.startsWith('/api/')) return null;
  // Built-in drum samples never change: cache-first, like hashed build assets.
  if (url.pathname.startsWith('/drums/')) return cacheFirst;
  if (url.pathname.startsWith('/_next/static/')) return cacheFirst;
  if (request.mode === 'navigate') return navigation;
  // React Server Component payloads must be fresh; cache only as an offline fallback.
  if (request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) return networkFirst;
  return staleWhileRevalidate;
}

function isCacheable(response) {
  return Boolean(response) && response.ok && response.status !== 206 && response.type === 'basic';
}

function allowsStore(response) {
  return !/no-store/i.test(response.headers.get('Cache-Control') || '');
}

async function put(cacheName, request, response, maxEntries) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  if (maxEntries) {
    const keys = await cache.keys();
    // Cache keys come back in insertion order: drop the oldest.
    await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((key) => cache.delete(key)));
  }
}

/** Hashed build assets never change: serve from cache, fetch once. */
async function cacheFirst(event) {
  const { request } = event;
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) {
    event.waitUntil(put(CACHES.static, request, response.clone(), MAX_ENTRIES.static).catch(() => undefined));
  }
  return response;
}

/** Pages: fresh from the network when possible, otherwise the cached page or app shell. */
async function navigation(event) {
  const { request } = event;
  const network = (async () => {
    const preloaded = event.preloadResponse ? await event.preloadResponse.catch(() => undefined) : undefined;
    const response = preloaded || (await fetch(request));
    // HTML holds no user data (projects live in IndexedDB), so it is cached even when marked no-store.
    if (isCacheable(response)) {
      event.waitUntil(put(CACHES.runtime, request, response.clone(), MAX_ENTRIES.runtime).catch(() => undefined));
    }
    return response;
  })();
  event.waitUntil(network.catch(() => undefined));

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, NAVIGATION_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([network, timeout]);
    if (response) return response;
    // Slow network: answer from cache if we can, otherwise keep waiting.
    return (await offlinePage(request, false)) || (await network);
  } catch {
    return offlinePage(request, true);
  } finally {
    clearTimeout(timer);
  }
}

async function offlinePage(request, fallback) {
  const cached =
    (await caches.match(request, { ignoreSearch: true })) || (await caches.match(SHELL_URL, { ignoreSearch: true }));
  if (cached || !fallback) return cached;
  return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** Network first, cached copy when offline. */
async function networkFirst(event) {
  const { request } = event;
  try {
    const response = await fetch(request);
    if (isCacheable(response) && allowsStore(response)) {
      event.waitUntil(put(CACHES.runtime, request, response.clone(), MAX_ENTRIES.runtime).catch(() => undefined));
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

/** Serve the cached copy immediately and refresh it in the background. */
async function staleWhileRevalidate(event) {
  const { request } = event;
  const cached = await caches.match(request);
  const refresh = fetch(request).then((response) => {
    if (isCacheable(response) && allowsStore(response)) {
      event.waitUntil(put(CACHES.runtime, request, response.clone(), MAX_ENTRIES.runtime).catch(() => undefined));
    }
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }
  return refresh;
}
