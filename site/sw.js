const ICON_CACHE_NAME = 'mwi-icon-cache-v3';

function getScopeBase() {
  return new URL('./', self.registration.scope).href;
}

function getAssetUrl(relativePath) {
  return new URL(relativePath, getScopeBase()).href;
}

function isIconRequest(requestUrl) {
  return requestUrl.origin === self.location.origin && requestUrl.pathname.includes('/assets/item_icons/');
}

function isTrendsRequest(requestUrl) {
  return requestUrl.origin === self.location.origin && /\/trends\.json$/.test(requestUrl.pathname);
}

async function cacheManifestIcons(cache) {
  try {
    const manifestResponse = await fetch(getAssetUrl('data/public/index.json'));
    if (!manifestResponse.ok) {
      return;
    }

    const manifest = await manifestResponse.json();
    const iconFiles = manifest?.iconFiles || {};
    const urls = new Set();

    for (const entry of Object.values(iconFiles)) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      for (const fileName of Object.values(entry)) {
        if (typeof fileName === 'string' && fileName) {
          urls.add(getAssetUrl(`assets/item_icons/${encodeURIComponent(fileName)}`));
        }
      }
    }

    await Promise.allSettled(Array.from(urls, (url) => cache.add(url)));
  } catch (error) {
    console.warn('Failed to pre-cache icons:', error);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(ICON_CACHE_NAME);
    await cacheManifestIcons(cache);
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