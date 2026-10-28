// Service Worker pour Bégole Map Pro v6.0
const CACHE_NAME = 'begole-map-v19-pro';
const TILE_CACHE_NAME = 'begole-tiles-v1';

const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './village.json',
  './logo/logoV2.png',

  // Scripts JS (Tous les modules inclus)
  './js/main.js',
  './js/config.js',
  './js/state.js',
  './js/utils.js',
  './js/db.js',
  './js/map.js',
  './js/cadastre.js',
  './js/ui.js',
  './js/tracking.js',
  './js/audio.js',
  './js/gamification.js',
  './js/begoledex.js',
  './js/pisteur.js',
  './js/plantnet.js',
  './js/modules/weather.js',

  // Audios
  './audios/sound_day.mp3',
  './audios/sound_night.mp3',
  './audios/sound_rain.mp3',

  // Librairies CDN Leaflet
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of CORE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[SW] Pré-cache facultatif non disponible :', asset, err);
        }
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME && key !== TILE_CACHE_NAME) {
          console.log('[SW] Nettoyage ancien cache', key);
          return caches.delete(key);
        }
      }));
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') {
    return;
  }

  const isMapTile = url.hostname.includes('tile.openstreetmap.org') ||
                    url.hostname.includes('data.geopf.fr');

  if (isMapTile) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (tileCache) => {
        const cached = await tileCache.match(event.request);
        if (cached) return cached;
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            tileCache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (e) {
          return cached || new Response('', { status: 408, statusText: 'Tile Offline' });
        }
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) return response;
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.url.startsWith('http')) {
          const respClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, respClone));
        }
        return networkResponse;
      }).catch(() => {
        return response;
      });
    })
  );
});
