// TrafficWatch service worker.
//  - App shell: precached, served stale-while-revalidate (fast + self-updating)
//  - API JSON: network-first (6s timeout), last good response when offline
//  - OSM tiles: stale-while-revalidate, capped at 600 tiles
//  - Camera images: not handled (cross-origin, no CORS, short-lived; the
//    browser HTTP cache already covers them)

const VERSION = 'tw-v1';
const SHELL = `${VERSION}-shell`;
const API = `${VERSION}-api`;
const TILES = 'tw-tiles'; // survives app updates
const MAX_TILES = 600;

const SHELL_FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/util.js',
  'js/feed.js',
  'js/places.js',
  'js/frames.js',
  'js/pip-layer.js',
  'js/wall.js',
  'js/viewer.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, API, TILES]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'api.data.gov.sg' && url.pathname.includes('traffic-images')) {
    e.respondWith(apiNetworkFirst(req));
  } else if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(tileSWR(req, e));
  } else if (url.origin === self.location.origin) {
    e.respondWith(shellSWR(req, e));
  }
});

async function apiNetworkFirst(req) {
  const cache = await caches.open(API);
  try {
    const res = await fetchWithTimeout(req, 6000);
    if (res.ok) await cache.put('latest', res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match('latest');
    if (!hit) throw err;
    // Tell the page this is an offline copy.
    const headers = new Headers(hit.headers);
    headers.set('x-tw-cache', 'offline');
    return new Response(await hit.blob(), { status: 200, headers });
  }
}

function fetchWithTimeout(req, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(req, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function tileSWR(req, e) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  const update = fetch(req).then(async (res) => {
    if (res.ok) {
      await cache.put(req, res.clone());
      trimTiles(cache);
    }
    return res;
  });
  if (hit) {
    e.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}

let trimming = false;
async function trimTiles(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    // Cache keys come back in insertion order: drop the oldest.
    for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
  } finally {
    trimming = false;
  }
}

async function shellSWR(req, e) {
  const cache = await caches.open(SHELL);
  const key = req.mode === 'navigate' ? 'index.html' : req;
  const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
  const update = fetch(req).then(async (res) => {
    if (res.ok && res.type === 'basic') await cache.put(key, res.clone());
    return res;
  });
  if (hit) {
    e.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}
