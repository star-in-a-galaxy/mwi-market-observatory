const ICON_CACHE_NAME = 'mwi-icon-cache-v3';

function isIconRequest(requestUrl) {
  return requestUrl.origin === self.location.origin && requestUrl.pathname.includes('/assets/item_icons/');
}

function isTrendsRequest(requestUrl) {
  return requestUrl.origin === self.location.origin && /\/trends\.json$/.test(requestUrl.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key === ICON_CACHE_NAME) {
        return null;
      }
      return caches.delete(key);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  if (!isIconRequest(requestUrl) && !isTrendsRequest(requestUrl) && event.request.destination !== 'image') {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(ICON_CACHE_NAME);

    if (isTrendsRequest(requestUrl)) {
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse.ok) {
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (error) {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    }

    const cachedResponse = await cache.match(event.request);
    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      const networkResponse = await fetch(event.request);
      if (networkResponse.ok) {
        cache.put(event.request, networkResponse.clone());
      }
      return networkResponse;
    } catch (error) {
      return new Response('', { status: 504, statusText: 'Gateway Timeout' });
    }
  })());
});