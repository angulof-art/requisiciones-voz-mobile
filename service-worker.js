const WORKER_URL = new URL(self.location.href);
const APP_VERSION = WORKER_URL.searchParams.get("v") || "development";
const APP_ASSET_QUERY = `v=${encodeURIComponent(APP_VERSION)}`;
const CACHE_PREFIX = "requisiciones-voz-mobile-";
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;
const ASSETS = [
  `./?${APP_ASSET_QUERY}`,
  `./index.html?${APP_ASSET_QUERY}`,
  `./styles.css?${APP_ASSET_QUERY}`,
  `./src/app.js?${APP_ASSET_QUERY}`,
  `./src/auth/client.js?${APP_ASSET_QUERY}`,
  `./src/auth/context.js?${APP_ASSET_QUERY}`,
  `./src/auth/permissions.js?${APP_ASSET_QUERY}`,
  `./src/auth/session.js?${APP_ASSET_QUERY}`,
  `./src/catalog.js?${APP_ASSET_QUERY}`,
  `./src/catalog-data.js?${APP_ASSET_QUERY}`,
  `./src/config.js?${APP_ASSET_QUERY}`,
  `./src/db/indexeddb.js?${APP_ASSET_QUERY}`,
  `./src/db/migrate-v10.js?${APP_ASSET_QUERY}`,
  `./src/exporters.js?${APP_ASSET_QUERY}`,
  `./src/email/permissions.js?${APP_ASSET_QUERY}`,
  `./src/email/distribution.js?${APP_ASSET_QUERY}`,
  `./src/email/preview.js?${APP_ASSET_QUERY}`,
  `./src/email/api.js?${APP_ASSET_QUERY}`,
  `./src/email/ui.js?${APP_ASSET_QUERY}`,
  `./src/parser.js?${APP_ASSET_QUERY}`,
  `./src/requisitions.js?${APP_ASSET_QUERY}`,
  `./src/reports.js?${APP_ASSET_QUERY}`,
  `./src/storage.js?${APP_ASSET_QUERY}`,
  `./src/supabase.js?${APP_ASSET_QUERY}`,
  `./src/version.js?${APP_ASSET_QUERY}`,
  `./src/voice-engine.js?${APP_ASSET_QUERY}`,
  `./src/workflow.js?${APP_ASSET_QUERY}`,
  `./vendor/supabase.js?${APP_ASSET_QUERY}`,
  `./manifest.webmanifest?${APP_ASSET_QUERY}`,
  `./icon.svg?${APP_ASSET_QUERY}`
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
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
