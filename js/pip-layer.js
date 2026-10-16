// PipLayer — camera pins plus floating picture-in-picture windows over a
// Leaflet map.
//
// Placement runs once after the map settles (moveend / zoomend), never during
// a gesture. It reads every position first, then writes every transform in a
// single animation frame. Windows live in a custom Leaflet pane, so panning
// moves them for free (the pane rides on the map pane's transform).

import { el, freshness, paintAge, ageLong, replayClass, afterAnimation } from './util.js';
import { FrameBox } from './frames.js';

const L = window.L;

const TIERS = { s: [132, 74], m: [176, 99], l: [232, 131] };
const DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const NEAR = 20;  // leader-line length, first ring
const FAR = 64;   // second ring when the first is crowded
const FARTHEST = 110;
const STAGGER = 25;

function tierFor(zoom, narrow) {
  const z = narrow ? zoom - 1 : zoom;
  return z <= 11 ? 's' : z <= 13 ? 'm' : 'l';
}

function rectAt(px, py, w, h, dir, g) {
  const d = g * 0.72;
  switch (dir) {
    case 'n': return { x: px - w / 2, y: py - g - h, w, h };
    case 'ne': return { x: px + d, y: py - d - h, w, h };
    case 'e': return { x: px + g, y: py - h / 2, w, h };
    case 'se': return { x: px + d, y: py + d, w, h };
    case 's': return { x: px - w / 2, y: py + g, w, h };
    case 'sw': return { x: px - d - w, y: py + d, w, h };
    case 'w': return { x: px - g - w, y: py - h / 2, w, h };
    default: return { x: px - d - w, y: py - d - h, w, h }; // nw
  }
}

const overlaps = (a, b, pad = 0) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

const inside = (r, v) => r.x >= v.x && r.y >= v.y && r.x + r.w <= v.x + v.w && r.y + r.h <= v.y + v.h;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class Pip {
  constructor(cam, onOpen, animateIn) {
    this.id = cam.id;
    this.root = el('div', animateIn ? 'pip is-new' : 'pip');
    this.line = el('div', 'pip-line');
    this.card = el('button', 'pip-card');
    this.card.type = 'button';
    this.fb = new FrameBox();
    const meta = el('div', 'pip-meta', '<span class="pip-name"></span><span class="age-chip"><i class="led"></i><span></span></span>');
    this.nameEl = meta.firstElementChild;
    this.chip = meta.lastElementChild;
    this.nameEl.textContent = cam.name;
    this.card.append(this.fb.root, meta);
    this.root.append(this.line, this.card);
    this.card.addEventListener('click', () => onOpen(this.id, this.fb.root));
    this.angle = 0;
    this.tier = null;
    this.dir = null;
    if (animateIn) afterAnimation(this.card, () => this.root.classList.remove('is-new'), 1400);
  }

  place(r, tier, dir, px, py) {
    if (tier !== this.tier) {
      this.root.className = this.root.className.replace(/\bt-\w\b/g, '').trim() + ` t-${tier}`;
      this.root.style.width = `${r.w}px`;
      this.root.style.height = `${r.h}px`;
      this.tier = tier;
    }
    this.dir = dir;
    this.root.style.transform = `translate3d(${Math.round(r.x)}px,${Math.round(r.y)}px,0)`;

    // Leader line: from the pin to the nearest point on the window's edge.
    const ax = px - r.x;
    const ay = py - r.y;
    const qx = clamp(ax, 0, r.w);
    const qy = clamp(ay, 0, r.h);
    const len = Math.hypot(qx - ax, qy - ay);
    let ang = (Math.atan2(qy - ay, qx - ax) * 180) / Math.PI;
    // Rotate the short way round so a gliding line never spins.
    while (ang - this.angle > 180) ang -= 360;
    while (ang - this.angle < -180) ang += 360;
    this.angle = ang;
    this.line.style.transform = `translate(${ax}px,${ay}px) rotate(${ang}deg) scaleX(${Math.max(0, len - 2)})`;
    this.card.style.transformOrigin = `${ax}px ${ay}px`;
  }

  tick(cam, now) {
    const age = now - cam.ts;
    paintAge(this.chip, age);
    this.card.setAttribute('aria-label', `${cam.name} camera ${cam.id}, updated ${ageLong(age)}`);
  }

  leave(animated) {
    this.root.classList.add('is-leaving');
    const done = () => { this.fb.destroy(); this.root.remove(); };
    if (animated) afterAnimation(this.card, done, 400);
    else done();
  }
}

export class PipLayer {
  /**
   * @param {L.Map} map
   * @param {import('./feed.js').CameraFeed} feed
   * @param {{onOpen:(id:string, el:Element)=>void, obstacles:()=>DOMRect[]}} opts
   */
  constructor(map, feed, { onOpen, obstacles }) {
    this.map = map;
    this.feed = feed;
    this.onOpen = onOpen;
    this.obstacles = obstacles;
    this.pane = map.createPane('pipPane');
    this.pane.style.zIndex = 550; // below markers (600), so pins stay tappable
    this.pane.classList.add('pip-pane', 'is-hidden');
    /** @type {Map<string, {marker: L.Marker, el: HTMLElement}>} */
    this.pins = new Map();
    /** @type {Map<string, Pip>} */
    this.pips = new Map();
    this.active = true;
    this.held = true;       // hidden until reveal() (intro)
    this._raf = 0;
    this._jump = false;
    this._reveal = false;

    map.on('zoomstart', () => this.pane.classList.add('is-hidden'));
    map.on('zoomend viewreset', () => { this._reveal = true; this.schedule(true); });
    map.on('moveend resize', () => this.schedule());
  }

  /** Called after the intro: cascade the windows in. */
  reveal() {
    this.held = false;
    this._reveal = true;
    this.schedule(true);
  }

  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      this._reveal = true;
      this.schedule(true);
    } else {
      this.pane.classList.add('is-hidden');
      // Release every decoded frame while the map is not visible.
      for (const pip of this.pips.values()) pip.leave(false);
      this.pips.clear();
    }
  }

  /** New data from the feed. */
  update({ first, changed }) {
    this._syncPins();
    if (!first) {
      for (const id of changed) {
        const pin = this.pins.get(id);
        if (pin && this.active) replayClass(pin.el, 'ping', 950);
        const pip = this.pips.get(id);
        if (pip) pip.fb.set(this.feed.cameras.get(id).url);
      }
    }
    this.tick(Date.now());
    this.schedule();
  }

  tick(now) {
    for (const [id, pin] of this.pins) {
      const cam = this.feed.cameras.get(id);
      if (!cam) continue;
      const { p, state } = freshness(now - cam.ts);
      pin.el.style.setProperty('--p', p.toFixed(3));
      pin.el.classList.toggle('s-aging', state === 'aging');
      pin.el.classList.toggle('s-stale', state === 'stale');
    }
    for (const [id, pip] of this.pips) {
      const cam = this.feed.cameras.get(id);
      if (cam) pip.tick(cam, now);
    }
  }

  /** The element that currently represents a camera on screen (for FLIP). */
  elementFor(id) {
    const pip = this.pips.get(id);
    if (pip && this.active && !this.pane.classList.contains('is-hidden')) return pip.fb.root;
    return this.pins.get(id)?.el || null;
  }

  ping(id) {
    const pin = this.pins.get(id);
    if (pin) replayClass(pin.el, 'ping', 950);
  }

  setHighlight(id) {
    for (const [pid, pin] of this.pins) pin.el.classList.toggle('is-active', pid === id);
  }

  _syncPins() {
    const cams = this.feed.cameras;
    for (const [id, pin] of this.pins) {
      if (!cams.has(id)) { pin.marker.remove(); this.pins.delete(id); }
    }
    for (const cam of cams.values()) {
      const pin = this.pins.get(cam.id);
      if (pin) {
        const ll = pin.marker.getLatLng();
        if (ll.lat !== cam.lat || ll.lng !== cam.lng) pin.marker.setLatLng([cam.lat, cam.lng]);
        continue;
      }
      const marker = L.marker([cam.lat, cam.lng], {
        icon: L.divIcon({
          className: 'pin-icon',
          html: '<div class="pin"><span class="arc"></span><span class="dot"></span></div>',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        title: `${cam.name} camera ${cam.id}`,
        riseOnHover: true,
      }).addTo(this.map);
      const node = marker.getElement().firstElementChild;
      marker.on('click', () => this.onOpen(cam.id, node));
      this.pins.set(cam.id, { marker, el: node });
    }
  }

  schedule(jump = false) {
    this._jump ||= jump;
    if (!this._raf) this._raf = requestAnimationFrame(() => this._layout());
  }

  _layout() {
    this._raf = 0;
    const jump = this._jump;
    this._jump = false;
    if (!this.active) return;
    const map = this.map;
    if (map._animatingZoom) return; // zoomend will schedule us again

    // ---- read phase -------------------------------------------------------
    const size = map.getSize();
    const narrow = size.x < 600;
    const tier = tierFor(map.getZoom(), narrow);
    const [w, h] = TIERS[tier];
    const maxCards = narrow ? 8 : 18;
    const view = { x: 8, y: 8, w: size.x - 16, h: size.y - 16 };
    const ui = this.obstacles();
    const cx = size.x / 2;
    const cy = size.y / 2;

    const vis = [];
    for (const cam of this.feed.cameras.values()) {
      const p = map.latLngToContainerPoint([cam.lat, cam.lng]);
      if (p.x < 0 || p.y < 0 || p.x > size.x || p.y > size.y) continue;
      vis.push({ cam, p, d: (p.x - cx) ** 2 + (p.y - cy) ** 2 });
    }
    vis.sort((a, b) => a.d - b.d); // the camera you're looking at gets a window first
    const pinRects = vis.map((v) => ({ id: v.cam.id, x: v.p.x - 10, y: v.p.y - 10, w: 20, h: 20 }));

    const placed = [];
    const plan = [];
    for (const v of vis) {
      if (plan.length >= maxCards) break;
      const id = v.cam.id;
      const prev = this.pips.get(id);
      // Stability: try the side the window was already on first.
      const order = prev?.dir && prev.tier === tier ? [prev.dir, ...DIRS.filter((d) => d !== prev.dir)] : DIRS;
      const find = (g) => {
        for (const dir of order) {
          const r = rectAt(v.p.x, v.p.y, w, h, dir, g);
          if (!inside(r, view)) continue;
          if (ui.some((o) => overlaps(r, o, 4))) continue;
          if (placed.some((o) => overlaps(r, o, 6))) continue;
          // Never cover another camera's pin: crossed leader lines read as noise.
          if (pinRects.some((o) => o.id !== id && overlaps(r, o, 2))) continue;
          return { r, dir };
        }
        return null;
      };
      const spot = find(NEAR) || find(FAR) || find(FARTHEST);
      if (!spot) continue; // no room: stays a pin until there is
      placed.push(spot.r);
      plan.push({ cam: v.cam, p: v.p, ...spot });
    }

    // ---- write phase ------------------------------------------------------
    const origin = map.containerPointToLayerPoint([0, 0]);
    const hidden = this.held || this.pane.classList.contains('is-hidden');
    if (jump) this.pane.classList.add('no-glide');

    const keep = new Set();
    const revealing = this._reveal && !this.held;
    let fresh = 0;
    plan.forEach(({ cam, p, r, dir }, i) => {
      keep.add(cam.id);
      let pip = this.pips.get(cam.id);
      const isNew = !pip;
      if (isNew) {
        pip = new Pip(cam, this.onOpen, !hidden);
        this.pips.set(cam.id, pip);
        this.pane.append(pip.root);
        pip.tick(cam, Date.now());
        pip.fb.set(cam.url, { animate: false });
      }
      pip.place(
        { x: r.x + origin.x, y: r.y + origin.y, w: r.w, h: r.h },
        tier, dir, p.x + origin.x, p.y + origin.y,
      );
      // Cascade nearest-to-centre first on reveal; stagger newcomers on pan.
      const delay = revealing ? i * STAGGER : isNew ? fresh++ * STAGGER : 0;
      pip.card.style.setProperty('--d', `${delay}ms`);
    });

    for (const [id, pip] of this.pips) {
      if (keep.has(id)) continue;
      pip.leave(!hidden);
      this.pips.delete(id);
    }

    if (jump) {
      void this.pane.offsetWidth; // commit the jump before re-enabling glides
      this.pane.classList.remove('no-glide');
    }

    if (revealing) {
      this._reveal = false;
      this.pane.classList.remove('is-hidden');
    }
    if (revealing || fresh) {
      // Delays are for the entrance only; hover/press must respond instantly.
      clearTimeout(this._clearDelays);
      this._clearDelays = setTimeout(() => {
        for (const pip of this.pips.values()) pip.card.style.setProperty('--d', '0ms');
      }, plan.length * STAGGER + 450);
    }
  }
}
