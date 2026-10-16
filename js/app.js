// TrafficWatch — app orchestration: map, feed, HUD, controls, intro, modes.

import { $, haptic, storage, reducedMotion, ageShort } from './util.js';
import { CameraFeed } from './feed.js';
import { PipLayer } from './pip-layer.js';
import { Wall } from './wall.js';
import { Viewer } from './viewer.js';

const L = window.L;
const SG_CENTER = [1.3521, 103.8198];
const SG_BOUNDS = L.latLngBounds([1.13, 103.55], [1.50, 104.12]);
const TICK_MS = 15e3;

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
const map = L.map('map', {
  center: SG_CENTER,
  zoom: innerWidth < 600 ? 11 : 12,
  minZoom: 10,
  maxZoom: 18,
  maxBounds: SG_BOUNDS.pad(0.15),
  maxBoundsViscosity: 0.8,
  zoomControl: false,
  attributionControl: true,
  zoomSnap: 1, // fractional zoom scales raster tiles: blurry, with seams
  wheelPxPerZoomLevel: 90,
});
map.attributionControl.setPrefix(false);
const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  keepBuffer: 2,
  updateWhenIdle: true,
  crossOrigin: true,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Images © LTA / data.gov.sg',
}).addTo(map);

// ---------------------------------------------------------------------------
// Feed + views
// ---------------------------------------------------------------------------
const feed = new CameraFeed();
let mode = 'map';
let userMoved = false;     // once the user has moved the map, never auto-fit again
let programmatic = false;  // true while *we* are moving the map
let wasOffline = false;
map.on('dragstart zoomstart', () => { if (!programmatic) userMoved = true; });

/** Move the map ourselves; `move` may finish synchronously. */
function moveMap(move, after) {
  programmatic = true;
  map.once('moveend', () => { programmatic = false; after?.(); });
  move();
}

function obstacles() {
  const out = [];
  for (const sel of ['.hud-capsule', '#controls', '.leaflet-control-attribution']) {
    const n = $(sel);
    if (n && n.offsetParent !== null) out.push(n.getBoundingClientRect());
  }
  return out.map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
}

const viewer = new Viewer(feed, {
  sourceFor: (id) => (mode === 'wall' ? wall.elementFor(id) : pips.elementFor(id)),
  onShowOnMap: (id) => showOnMap(id),
  onChange: (id) => pips.setHighlight(id),
});
const openViewer = (id, el) => { haptic(8); viewer.open(id, el); };
const pips = new PipLayer(map, feed, { onOpen: openViewer, obstacles });
const wall = new Wall($('#wall'), feed, { onOpen: openViewer });

feed.addEventListener('data', (e) => {
  const d = e.detail;
  pips.update(d);
  wall.update(d);
  viewer.update(d);
  hudBeat();
  renderHud();
  if (d.first) {
    firstData.resolve();
    if (!userMoved) fitAll(false);
  } else if (mode === 'wall' && d.changed.size > 2) {
    toast(`${d.changed.size} cameras updated`);
  }
});
feed.addEventListener('state', (e) => {
  renderHud();
  if (e.detail === 'offline') toast("You're offline. Showing the last frames.");
  if (e.detail === 'live' && wasOffline) toast('Back online');
  wasOffline = e.detail === 'offline';
});

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const hudStatus = $('#hud-status');
const hudText = hudStatus.querySelector('.hud-text');
const hudBtn = $('#hud-btn');
const hudPanel = $('#hud-panel');

function renderHud() {
  const n = feed.cameras.size;
  const s = feed.state;
  hudStatus.dataset.state = s === 'updating' ? (feed.lastSuccess ? 'live' : 'loading') : s;
  const since = feed.lastSuccess ? ageShort(Date.now() - feed.lastSuccess) : '';
  const cams = `<span class="opt">${n} cam${n === 1 ? '' : 's'} · </span>`;
  switch (s) {
    case 'loading': hudText.textContent = 'Connecting'; break;
    case 'paused': hudText.textContent = 'Paused'; break;
    case 'offline': hudText.innerHTML = `Offline${n ? ` · ${cams}${since}` : ''}`; break;
    case 'error': hudText.innerHTML = `Retrying${n ? ` · ${cams}${since}` : ''}`; break;
    default: hudText.innerHTML = `<b>Live</b> · ${cams}${since}`;
  }
  const detail = feed.lastSuccess
    ? `${n} cameras reporting. Last update ${new Date(feed.lastSuccess).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`
    : 'Waiting for first update…';
  $('#hud-detail').textContent = s === 'error' ? "Couldn't reach data.gov.sg. Retrying shortly." : detail;
}

function hudBeat() {
  hudStatus.classList.remove('beat');
  void hudStatus.offsetWidth;
  hudStatus.classList.add('beat');
}

hudBtn.addEventListener('click', () => {
  const open = hudPanel.hidden;
  hudPanel.hidden = !open;
  hudBtn.setAttribute('aria-expanded', String(open));
  pips.schedule();
});
document.addEventListener('pointerdown', (e) => {
  if (!hudPanel.hidden && !e.target.closest('#hud')) {
    hudPanel.hidden = true;
    hudBtn.setAttribute('aria-expanded', 'false');
  }
});

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function fitAll(animate = true) {
  const cams = feed.list();
  if (!cams.length) return;
  const b = L.latLngBounds(cams.map((c) => [c.lat, c.lng]));
  const hud = $('.hud-capsule').getBoundingClientRect();
  const narrow = innerWidth < 600;
  const opts = {
    paddingTopLeft: [narrow ? 40 : 140, hud.bottom + (narrow ? 70 : 120)],
    paddingBottomRight: [narrow ? 80 : 160, narrow ? 80 : 120],
    maxZoom: 15,
  };
  moveMap(() => {
    if (animate && !reducedMotion.matches) map.flyToBounds(b, { ...opts, duration: 0.9 });
    else map.fitBounds(b, { ...opts, animate: false });
  });
}

function showOnMap(id) {
  const cam = feed.cameras.get(id);
  if (!cam) return;
  if (mode === 'wall') setMode('map');
  const z = Math.max(map.getZoom(), 15);
  moveMap(() => {
    if (reducedMotion.matches) map.setView([cam.lat, cam.lng], z, { animate: false });
    else map.flyTo([cam.lat, cam.lng], z, { duration: 0.9 });
  }, () => pips.ping(id));
}

$('#ctl-fit').addEventListener('click', () => { haptic(); fitAll(true); });
$('#ctl-zoom-in').addEventListener('click', () => map.zoomIn());
$('#ctl-zoom-out').addEventListener('click', () => map.zoomOut());

let youMarker = null;
let youCircle = null;
$('#ctl-locate').addEventListener('click', () => {
  const btn = $('#ctl-locate');
  if (!('geolocation' in navigator)) { toast('Location is not available on this device'); return; }
  haptic();
  btn.classList.add('is-busy');
  // Location is used only on this device to centre the map; it is never sent anywhere.
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.classList.remove('is-busy');
      btn.classList.add('is-on');
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (!SG_BOUNDS.contains(ll)) { toast("You're outside Singapore"); return; }
      youCircle?.remove();
      youMarker?.remove();
      youCircle = L.circle(ll, { radius: pos.coords.accuracy, stroke: false, fillColor: getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim(), fillOpacity: 0.12, interactive: false }).addTo(map);
      youMarker = L.marker(ll, { icon: L.divIcon({ className: 'pin-icon', html: '<div class="you-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, keyboard: false }).addTo(map);
      const z = Math.max(map.getZoom(), 14);
      moveMap(() => (reducedMotion.matches ? map.setView(ll, z, { animate: false }) : map.flyTo(ll, z, { duration: 0.9 })));
    },
    (err) => {
      btn.classList.remove('is-busy');
      toast(err.code === 1 ? 'Location permission denied' : "Couldn't get your location");
    },
    { enableHighAccuracy: false, timeout: 10e3, maximumAge: 60e3 },
  );
});

function setMode(next) {
  if (next === mode) return;
  mode = next;
  const btn = $('#ctl-wall');
  btn.setAttribute('aria-pressed', String(mode === 'wall'));
  btn.setAttribute('aria-label', mode === 'wall' ? 'Show map' : 'Show camera wall');
  if (mode === 'wall') {
    pips.setActive(false);
    wall.show();
    requestAnimationFrame(() => document.body.classList.add('mode-wall'));
  } else {
    document.body.classList.remove('mode-wall');
    setTimeout(() => { if (mode === 'map') wall.hide(); }, 340);
    pips.setActive(true);
  }
}
$('#ctl-wall').addEventListener('click', () => { haptic(); setMode(mode === 'wall' ? 'map' : 'wall'); });

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
const toastEl = $('#toast');
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

// ---------------------------------------------------------------------------
// One ticker for every age label and freshness arc — only while visible.
// ---------------------------------------------------------------------------
let ticker = 0;
function tick() {
  const now = Date.now();
  pips.tick(now);
  wall.tick(now);
  viewer.tick(now);
  renderHud();
}
function syncTicker() {
  clearInterval(ticker);
  ticker = 0;
  if (!document.hidden) { tick(); ticker = setInterval(tick, TICK_MS); }
}
document.addEventListener('visibilitychange', syncTicker);

// ---------------------------------------------------------------------------
// Intro → reveal
// ---------------------------------------------------------------------------
function deferred() {
  let resolve;
  const p = new Promise((r) => { resolve = r; });
  p.resolve = resolve;
  return p;
}
const firstData = deferred();
const tilesReady = deferred();
tiles.once('load', () => tilesReady.resolve());

const intro = $('#intro');
const skipIntro = intro.classList.contains('skip');
Promise.race([
  Promise.all([firstData, tilesReady]),
  new Promise((r) => setTimeout(r, skipIntro ? 1200 : 4000)),
]).then(() => {
  storage.set('tw:intro', '1');
  if (skipIntro) { intro.remove(); pips.reveal(); return; }
  // Hold the "focus" moment a beat, then fly through the lens.
  setTimeout(() => {
    intro.classList.add('out');
    setTimeout(() => pips.reveal(), reducedMotion.matches ? 0 : 260);
    setTimeout(() => intro.remove(), 900);
  }, 250);
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------
feed.start();
syncTicker();
renderHud();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Exposed for debugging in the console.
window.tw = { map, feed, pips, wall, viewer };
