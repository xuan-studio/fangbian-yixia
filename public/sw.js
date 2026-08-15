const CACHE_NAME = "fangbian-yixia-v2";
const CORE_ASSETS = [
  "/",
  "/favicon.svg",
  "/og.png",
  "/data/public-toilets.json",
  "/data/premium-toilets.json",
  "/data/premium-matches.json",
  "/data/venue-pois.json",
  "/data/shanghai-boundary.geojson",
  "/data/toilet-record.schema.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("/");
        return new Response("Offline", { status: 503, statusText: "Offline" });
      }),
  );
});
