// Wall — "control room" mode. Every camera as a monitor tile, grouped by
// region. Frames load only while a tile is on screen, and are released when
// it scrolls away.

import { el, paintAge, ageLong } from './util.js';
import { REGIONS } from './places.js';
import { FrameBox } from './frames.js';

class Tile {
  constructor(cam, onOpen) {
    this.id = cam.id;
    this.root = el('button', 'tile');
    this.root.type = 'button';
    this.root._tile = this;
    this.fb = new FrameBox();
    const meta = el('div', 'pip-meta', '<span class="pip-name"></span><span class="age-chip"><i class="led"></i><span></span></span>');
    this.chip = meta.lastElementChild;
    const name = meta.firstElementChild;
    name.append(el('b'), el('span', 'tile-id', cam.code.toUpperCase()));
    name.firstChild.textContent = cam.name;
    this.root.append(this.fb.root, meta);
    this.root.addEventListener('click', () => onOpen(this.id, this.fb.root));
    this.visible = false;
  }
}

export class Wall {
  constructor(root, feed, { onOpen }) {
    this.root = root;
    this.feed = feed;
    this.onOpen = onOpen;
    /** @type {Map<string, Tile>} */
    this.tiles = new Map();
    this.shown = false;
    this._sig = '';
    this.io = new IntersectionObserver((entries) => this._onIntersect(entries), {
      root: this.root,
      rootMargin: '200px 0px',
    });
  }

  show() {
    this.shown = true;
    this.root.hidden = false;
    this.root.scrollTop = 0;
    this._build(true);
  }

  hide() {
    this.shown = false;
    for (const t of this.tiles.values()) { t.fb.clear(); t.visible = false; }
    this.root.hidden = true;
  }

  update({ changed }) {
    if (!this.shown) return;
    const sig = this._signature();
    if (sig !== this._sig) { this._build(false); return; }
    for (const id of changed) {
      const t = this.tiles.get(id);
      if (t?.visible) t.fb.set(this.feed.cameras.get(id).url);
    }
    this.tick(Date.now());
  }

  tick(now) {
    if (!this.shown) return;
    for (const [id, t] of this.tiles) {
      const cam = this.feed.cameras.get(id);
      if (!cam) continue;
      paintAge(t.chip, now - cam.ts);
      t.root.setAttribute('aria-label', `${cam.name} camera ${cam.id}, updated ${ageLong(now - cam.ts)}`);
    }
  }

  elementFor(id) {
    const t = this.tiles.get(id);
    if (!t || !this.shown) return null;
    const r = t.root.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight ? t.fb.root : null;
  }

  _signature() {
    return [...this.feed.cameras.keys()].sort().join(',');
  }

  _build(animate) {
    this._sig = this._signature();
    this.io.disconnect();
    for (const t of this.tiles.values()) t.fb.destroy();
    this.tiles.clear();
    this.root.textContent = '';

    const cams = this.feed.list();
    if (!cams.length) {
      this.root.append(el('p', 'wall-empty', "No cameras are reporting right now. We'll keep watching."));
      return;
    }
    const groups = new Map(REGIONS.map((r) => [r, []]));
    for (const c of cams) (groups.get(c.region) || groups.get('Central')).push(c);

    let i = 0;
    const frag = document.createDocumentFragment();
    for (const [region, list] of groups) {
      if (!list.length) continue;
      list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const sec = el('section', 'wall-region');
      const head = el('h3', 'wall-head');
      head.textContent = region;
      head.append(el('span', '', String(list.length)));
      const grid = el('div', 'wall-grid');
      for (const cam of list) {
        const t = new Tile(cam, this.onOpen);
        // Rising wave: 18ms apart, capped so a long wall doesn't drag.
        t.root.style.setProperty('--d', animate ? `${Math.min(i++ * 18, 420)}ms` : '0ms');
        if (!animate) t.root.style.animation = 'none';
        this.tiles.set(cam.id, t);
        grid.append(t.root);
      }
      sec.append(head, grid);
      frag.append(sec);
    }
    this.root.append(frag);
    for (const t of this.tiles.values()) this.io.observe(t.root);
    this.tick(Date.now());
  }

  _onIntersect(entries) {
    for (const e of entries) {
      const t = e.target._tile;
      if (!t) continue;
      t.visible = e.isIntersecting;
      const cam = this.feed.cameras.get(t.id);
      if (t.visible && cam) { t.fb.set(cam.url, { animate: false }); this.feed.touch(cam.id); }
      else if (!t.visible) t.fb.clear();
    }
  }
}
