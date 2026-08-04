const APP_VERSION = "v3";
const APP_ASSET_QUERY = "v=3";
const CACHE_PREFIX = "requisiciones-voz-mobile-";
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;
const ASSETS = [
  `./?${APP_ASSET_QUERY}`,
  `./index.html?${APP_ASSET_QUERY}`,
  `./styles.css?${APP_ASSET_QUERY}`,
  `./src/app.js?${APP_ASSET_QUERY}`,
  `./manifest.webmanifest?${APP_ASSET_QUERY}`,
  `./icon.svg?${APP_ASSET_QUERY}`
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        if (response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || caches.match(`./index.html?${APP_ASSET_QUERY}`))
      )
  );
});
