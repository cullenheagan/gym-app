// Gym Companion service worker: lets the app open with no signal.
// Pages: network first (4 s), then the saved copy. Built files: saved copy first.
// Data calls to Supabase are never touched here.

const VERSION = "v1";
const PAGES = `pages-${VERSION}`;
const STATIC = `static-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((c) => c.add("/"))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== PAGES && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStatic(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/apple-touch-icon.png"
  );
}

async function networkFirstPage(event) {
  const cache = await caches.open(PAGES);
  const network = fetch(event.request).then((res) => {
    // Every navigation is the same single page, so it is saved under "/".
    if (res.ok && !res.redirected) cache.put("/", res.clone());
    return res;
  });
  event.waitUntil(network.catch(() => {}));
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch (e) {}
  const saved = await cache.match("/");
  if (saved) return saved;
  return network.catch(
    () => new Response("You are offline and this page was never saved.", { status: 503, headers: { "Content-Type": "text/plain" } }),
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    event.respondWith(networkFirstPage(event));
  } else if (isStatic(url)) {
    event.respondWith(cacheFirst(req));
  }
});

// The page lists the built files it just loaded, so they are saved for offline use.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "CACHE_URLS" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(STATIC).then(async (cache) => {
      for (const u of data.urls) {
        try {
          const url = new URL(u, self.location.origin);
          if (url.origin !== self.location.origin || !isStatic(url)) continue;
          if (await cache.match(url.pathname + url.search)) continue;
          const res = await fetch(url.pathname + url.search);
          if (res.ok) await cache.put(url.pathname + url.search, res);
        } catch (e) {}
      }
    }),
  );
});
