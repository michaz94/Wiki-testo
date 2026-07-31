const CACHE_NAME = 'wiki-shell-v14';

/* Coquille locale : doit impérativement être mise en cache. */
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.webmanifest',
  './icon.svg'
];

/* Dépendances externes : mise en cache « au mieux ».
   Si l'une échoue (hors ligne au moment de l'installation, CDN lent...),
   l'installation du service worker ne doit pas échouer pour autant. */
const RUNTIME_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
  'https://esm.sh/@tiptap/core@2.11.5',
  'https://esm.sh/@tiptap/starter-kit@2.11.5'
];

/* Pas de skipWaiting automatique : la nouvelle version attend que
   l'utilisateur valide « Recharger » depuis le bandeau de l'app.
   Aucun risque de couper une saisie en cours. */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        await cache.addAll(APP_SHELL);
        await Promise.allSettled(RUNTIME_ASSETS.map(url => cache.add(url).catch(() => {})));
      })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      });
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network.catch(() => cached);
    })
  );
});
