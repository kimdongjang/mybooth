const CACHE_NAME = 'booth-pos-app-v18';
const APP_SHELL_URLS = ['/', '/index.html', '/fonts/PretendardVariable.woff2', '/images/default-product.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cacheAppShell(cache))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithAppShellFallback(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirstWithAppShellFallback(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = (
      await cache.match(request) ||
      await cache.match('/index.html') ||
      await cache.match('/')
    );

    return cached || new Response('오프라인 상태입니다. 앱 캐시를 찾을 수 없습니다.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  }
}

async function cacheAppShell(cache) {
  await Promise.all(APP_SHELL_URLS.map((url) => cache.add(url).catch((error) => {
    console.warn('[service-worker] app shell caching failed', url, error);
  })));

  try {
    const indexResponse = await fetch('/index.html', { cache: 'no-cache' });
    if (!indexResponse.ok) return;

    const indexHtml = await indexResponse.clone().text();
    await cache.put('/index.html', indexResponse);

    const assetUrls = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((assetUrl) => assetUrl.startsWith('/assets/'));

    await Promise.all(assetUrls.map((assetUrl) => cache.add(assetUrl).catch(() => undefined)));
  } catch (error) {
    console.warn('[service-worker] app shell asset caching failed', error);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);

  return cached || await network || Response.error();
}
