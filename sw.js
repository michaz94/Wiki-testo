/* ============================================================
   Service Worker — Wiki
   Objectif : l'application démarre en mode avion.

   Deux règles qui changent tout par rapport à la version v13 :

   1. TOUT est same-origin. Plus aucune dépendance CDN au démarrage,
      donc plus aucune réponse « opaque » impossible à valider.
      addAll() est strict : si un fichier manque, l'installation
      échoue franchement au lieu de laisser l'app à moitié cassée.

   2. PAS de skipWaiting() automatique. Une nouvelle version s'installe
      en silence puis ATTEND. C'est l'utilisateur qui déclenche la
      bascule via le bandeau « Recharger », jamais en pleine frappe.
   ============================================================ */

const VERSION = 'v14';
const CACHE_NAME = `wiki-${VERSION}`;

/* Coquille complète : tout ce qu'il faut pour démarrer sans réseau. */
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.webmanifest',
  './tiptap.js',
  './sql-wasm.js',
  './sql-wasm.wasm',
  './rubik.woff2',
  './icon.svg',
  './icon-maskable.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      /* Strict : on veut savoir tout de suite si un fichier manque. */
      cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' })))
    )
    /* Volontairement pas de skipWaiting() ici. */
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

/* La page demande la bascule quand l'utilisateur appuie sur « Recharger ». */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/* ---- Stratégie de lecture ----
   Cache d'abord (démarrage instantané, y compris hors ligne), puis
   revalidation en arrière-plan pour préparer la version suivante. */
function staleWhileRevalidate(request, fallbackKey) {
  return caches.open(CACHE_NAME).then(async cache => {
    const cached = await cache.match(fallbackKey || request);

    const network = fetch(request)
      .then(response => {
        if (response && response.ok && response.type === 'basic') {
          cache.put(fallbackKey || request, response.clone());
        }
        return response;
      })
      .catch(() => null);

    if (cached) return cached;

    const fresh = await network;
    if (fresh) return fresh;

    return new Response('Hors ligne et ressource absente du cache.', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /* Ressources externes (html2pdf chargé à la demande) : réseau direct,
     jamais mises en cache. Une réponse opaque ne peut pas être validée. */
  if (url.origin !== self.location.origin) return;

  /* Navigation : on sert toujours la coquille locale. */
  if (request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(request, './index.html'));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
