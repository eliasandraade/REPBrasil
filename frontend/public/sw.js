/*
 * REPBrasil — service worker factual-safe.
 *
 * - Navegação: sempre rede primeiro. Sem conexão, responde /offline.html (estático, sem nenhum dado
 *   factual). Páginas nunca são guardadas em cache.
 * - API (mesma origem /api/ ou outra origem), payloads RSC do Next e métodos que não sejam GET:
 *   nunca interceptados nem guardados.
 * - Estáticos (/_next/static com hash, /brand, favicon): cache-first, num cache por versão do deploy.
 *
 * A versão vem da URL de registro (/sw.js?v=<revisão do deploy>): cada deploy instala um worker
 * novo, que assume na hora (skipWaiting + clients.claim) e apaga os caches de versões anteriores.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_PREFIX = "repbrasil-";
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [
  OFFLINE_URL,
  "/favicon.ico",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
  "/brand/icon-maskable-512.png",
  "/brand/apple-touch-icon.png",
];

async function installShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(PRECACHE.map((path) => new Request(new URL(path, self.location.origin), { cache: "reload" })));
  await self.skipWaiting();
}

async function activateShell() {
  const keys = await caches.keys();
  const stale = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
  await Promise.all(stale.map((key) => caches.delete(key)));
  await self.clients.claim();
}

async function offlineFallback() {
  const fallback = await caches.match(new URL(OFFLINE_URL, self.location.origin).href, {
    cacheName: CACHE_NAME,
    ignoreVary: true,
  });
  return (
    fallback ??
    new Response("REPBrasil: sem conexão. Reconecte-se para consultar a versão atual.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    })
  );
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineFallback();
  }
}

// Leitura e escrita não recriam o cache: se um deploy novo já o apagou, este worker (antigo) só repassa.
async function cacheFirstStatic(request) {
  const cached = await caches.match(request, { cacheName: CACHE_NAME });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === "basic" && (await caches.has(CACHE_NAME))) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

function strategyFor(request) {
  if (request.method !== "GET") return "network";
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return "network";
  if (request.mode === "navigate") return "navigation";
  const isStatic =
    url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/") || url.pathname === "/favicon.ico";
  return isStatic ? "static" : "network";
}

self.addEventListener("install", (event) => {
  event.waitUntil(installShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activateShell());
});

self.addEventListener("fetch", (event) => {
  const strategy = strategyFor(event.request);
  if (strategy === "navigation") event.respondWith(networkFirstNavigation(event.request));
  else if (strategy === "static") event.respondWith(cacheFirstStatic(event.request));
});
