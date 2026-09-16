/* Lumina Clock service worker — offline app shell */
const CACHE = 'lumina-v47';
const ASSETS = [
  './',
  './index.html',
  './hearth3d.js',
  './tank3d.js', './fishlib.js', './reef3d.js',
  './assets/coast_rocks_05.glb', './assets/sand_rocks_small_01.glb', './assets/lambis_shell.glb',
  './assets/aerial_sand_diff.webp', './assets/aerial_sand_nor_gl.webp', './assets/aerial_sand_arm.webp', './assets/aerial_sand_disp.webp',
  './assets/coral_ground_02_diff.webp', './assets/coral_ground_02_nor_gl.webp', './assets/coral_ground_02_arm.webp',
  './assets/dead_quiver_branch_01.glb', './assets/anthurium_botany_01.glb', './assets/namaqualand_stones_01.glb',
  './assets/dark_wood_diff.webp', './assets/dark_wood_nor_gl.webp', './assets/dark_wood_arm.webp',
  './assets/old_wooden_floor_01_diff.webp', './assets/old_wooden_floor_01_nor_gl.webp', './assets/old_wooden_floor_01_arm.webp',
  './assets/plaster_grey_04_diff.webp', './assets/plaster_grey_04_nor_gl.webp', './assets/plaster_grey_04_arm.webp',
  './assets/dry_river_pebbles_diff.webp', './assets/dry_river_pebbles_nor_gl.webp', './assets/dry_river_pebbles_arm.webp', './assets/dry_river_pebbles_disp.webp',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // always hit network for live weather
  if (url.hostname.includes('open-meteo.com')) return;
  // cache-first for the app shell + fonts, network fallback (and opportunistically cache)
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request)
        .then((res) => {
          if (e.request.method === 'GET' && res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached)
    )
  );
});
