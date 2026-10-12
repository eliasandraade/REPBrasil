const CACHE_NAME = "repbrasil-shell-v1";
const PRECACHE = [
  "/offline",
  "/favicon.ico",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
  "/brand/icon-maskable-512.png",
  "/brand/apple-touch-icon.png",
];

async function installShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(PRECACHE);
  await self.skipWaiting();
}

async function activateShell() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
  await self.clients.claim();
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const fallback = await caches.match("/offline");
    return fallback ?? new Response("REPBrasil indisponível sem conexão.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(installShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activateShell());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  const staticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname === "/favicon.ico";

  if (staticAsset) event.respondWith(cacheFirstStatic(request));
});
