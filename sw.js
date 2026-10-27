/* ============================================================
   sw.js – Service Worker für „Snake – Dark Neon Edition"
   ------------------------------------------------------------
   Strategie:
   • Beim Install: alle statischen Assets in den Cache legen
     (einzeln, damit ein fehlendes PNG nicht die ganze
     Installation blockiert).
   • Navigation (HTML):  network-first  → immer aktuell,
                          bei Offline aus dem Cache.
   • Andere Requests:    stale-while-revalidate
                          → sofort aus dem Cache, im Hintergrund
                            auf den neuesten Stand bringen.
   • Alte Caches werden bei jedem Versionssprung gelöscht.
   ============================================================ */

// ⚠️ Bei jedem Deploy der Spieldateien die Versionsnummer erhöhen!
const CACHE_VERSION = 'snake-v1';
const CACHE_NAME    = CACHE_VERSION;

const PRECACHE = [
  './',
  './index.html',              // ggf. an echten Dateinamen anpassen
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './icon-512-maskable.png',
  './snake.worker.js',
];

// ---------- INSTALL ----------
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Jede Datei einzeln cachen → eine fehlende blockiert nicht alles
    await Promise.all(
      PRECACHE.map((url) =>
        cache.add(url).catch((err) => {
          console.warn('[SW] Precache fehlgeschlagen:', url, err);
        })
      )
    );
    // Neue Version sofort übernehmen
    await self.skipWaiting();
  })());
});

// ---------- ACTIVATE ----------
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Alte Caches löschen
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    // Sofort alle Clients übernehmen
    await self.clients.claim();
  })());
});

// ---------- FETCH ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Nur GET-Anfragen behandeln
  if (request.method !== 'GET') return;

  // Keine Cross-Origin-Requests cachen (z. B. Analytics)
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // --- Navigation (HTML): network-first, sonst Cache ---
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // --- Assets: stale-while-revalidate ---
  event.respondWith(staleWhileRevalidate(request));
});

// ---------- Strategien ----------
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline → aus dem Cache bedienen
    const cached = await cache.match(request);
    if (cached) return cached;
    // Fallback: Hauptseite
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
    return new Response('Offline – Inhalt nicht im Cache.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || (await network) || new Response('', { status: 504 });
}

// ---------- Nachrichten von der Seite ----------
self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.map((k) => caches.delete(k)))
      ).then(() => {
        if (event.source && event.source.postMessage) {
          event.source.postMessage({ type: 'CACHE_CLEARED' });
        }
      })
    );
  }
});