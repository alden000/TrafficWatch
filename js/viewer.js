// Viewer — fullscreen camera with a shared-element (FLIP) transition from the
// element that opened it, live updates, swipe-to-browse and pull-to-close.

import { $, freshness, paintAge, ageLong, sgClock, haptic, reducedMotion, escapeHtml } from './util.js';
import { FrameBox } from './frames.js';

const OPEN_MS = 420;

/** Transform that makes `to` look like `from` (uniform scale, centred). */
function flip(from, to) {
  const s = from.width / to.width;
  const x = from.left - to.left;
  const y = from.top + from.height / 2 - (to.top + (to.height * s) / 2);
  return `translate(${x}px, ${y}px) scale(${s})`;
}

/** Order cameras into a nearest-neighbour walk, so swiping steps along the island. */
function tour(cams) {
  if (cams.length < 3) return cams.map((c) => c.id);
  const left = [...cams];
  left.sort((a, b) => a.lng - b.lng);
  const out = [left.shift()];
  while (left.length) {
    const last = out[out.length - 1];
    const cos = Math.cos((last.lat * Math.PI) / 180);
    let bi = 0;
    let bd = Infinity;
    left.forEach((c, i) => {
      const d = (c.lat - last.lat) ** 2 + ((c.lng - last.lng) * cos) ** 2;
      if (d < bd) { bd = d; bi = i; }
    });
    out.push(left.splice(bi, 1)[0]);
  }
  return out.map((c) => c.id);
}

export class Viewer {
  constructor(feed, { sourceFor, onShowOnMap, onChange }) {
    this.feed = feed;
    this.sourceFor = sourceFor;
    this.onShowOnMap = onShowOnMap;
    this.onChange = onChange;
    this.root = $('#viewer');
    this.media = $('#viewer-media');
    this.fb = new FrameBox(800);
    this.media.append(this.fb.root);
    this.id = null;
    this.order = [];
    this.isOpen = false;
    this._busy = false;
    this._returnFocus = null;

    $('#viewer-close').addEventListener('click', () => this.close());
    $('#viewer-prev').addEventListener('click', () => this.step(-1));
    $('#viewer-next').addEventListener('click', () => this.step(1));
    $('#viewer-map').addEventListener('click', () => {
      const id = this.id;
      this.close({ toMap: true }).then(() => this.onShowOnMap(id));
    });
    this.root.querySelector('.viewer-backdrop').addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', (e) => this._onKey(e));
    this._bindGestures();
  }

  open(id, sourceEl) {
    const cam = this.feed.cameras.get(id);
    if (!cam || this._busy) return;
    this._busy = true;
    this.isOpen = true;
    this._returnFocus = document.activeElement;
    this.order = tour(this.feed.list());
    this._render(cam);

    // Show the frame we already have on screen instantly, then go live.
    const srcImg = sourceEl?.querySelector?.('img:last-of-type');
    if (!(srcImg && srcImg.complete && this.fb.adopt(srcImg, srcImg.getAttribute('src')))) this.fb.clear();
    this.fb.set(cam.url, { animate: false });
    this.feed.touch(id);

    this.root.hidden = false;
    this.root.classList.remove('shown');
    this.root.style.removeProperty('--bd');
    const to = this.media.getBoundingClientRect();
    const from = sourceEl?.getBoundingClientRect?.();
    this.media.style.transition = 'none';
    this.media.style.opacity = '';
    this.media.style.transform = from && from.width && !reducedMotion.matches ? flip(from, to) : 'scale(.92)';
    if (!from || reducedMotion.matches) this.media.style.opacity = '0';
    void this.media.offsetWidth; // commit the starting frame

    requestAnimationFrame(() => {
      this.media.style.transition = '';
      this.media.style.transform = '';
      this.media.style.opacity = '';
      this.root.classList.add('shown');
      haptic(8);
      setTimeout(() => {
        this._busy = false;
        $('#viewer-close').focus({ preventScroll: true });
      }, OPEN_MS);
    });
    this.onChange?.(id);
  }

  close({ toMap = false } = {}) {
    if (!this.isOpen) return Promise.resolve();
    this.isOpen = false;
    this._busy = true;
    const target = toMap ? null : this.sourceFor(this.id);
    const from = target?.getBoundingClientRect?.();
    const onScreen = from && from.width && from.bottom > 0 && from.top < innerHeight && from.right > 0 && from.left < innerWidth;

    this.root.classList.remove('shown', 'dragging');
    this.media.style.transition = '';
    if (onScreen && !reducedMotion.matches) {
      // Undo any drag offset, then fly back into the element's *current* spot.
      const cur = this.media.style.transform;
      this.media.style.transform = '';
      const to = this.media.getBoundingClientRect();
      this.media.style.transition = 'none';
      this.media.style.transform = cur;
      void this.media.offsetWidth;
      this.media.style.transition = '';
      this.media.style.transform = flip(from, to);
    } else {
      this.media.style.opacity = '0';
      this.media.style.transform = 'scale(.94)';
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        this.root.hidden = true;
        this.media.style.transition = 'none';
        this.media.style.transform = '';
        this.media.style.opacity = '';
        this.fb.clear();
        this._busy = false;
        const ret = this._returnFocus;
        if (ret && document.contains(ret)) ret.focus?.({ preventScroll: true });
        this.onChange?.(null);
        resolve();
      }, reducedMotion.matches ? 140 : OPEN_MS);
    });
  }

  step(dir) {
    if (!this.isOpen || this._busy || this.order.length < 2) return;
    let i = this.order.indexOf(this.id);
    i = (i + dir + this.order.length) % this.order.length;
    const next = this.feed.cameras.get(this.order[i]);
    if (!next) return;
    this._busy = true;
    haptic(6);
    const out = dir > 0 ? 'slide-out-l' : 'slide-out-r';
    this.media.classList.add(out);
    const swap = () => {
      this.media.classList.remove(out);
      this.fb.clear();
      this._render(next);
      this.fb.set(next.url, { animate: false });
      this.feed.touch(next.id);
      // Parallax: the incoming frame starts 40% of the way across, moving slower.
      this.media.style.transition = 'none';
      this.media.style.transform = `translateX(${dir > 0 ? 40 : -40}vw)`;
      this.media.style.opacity = '0';
      void this.media.offsetWidth;
      this.media.style.transition = 'transform 300ms var(--ease-out), opacity 240ms var(--ease-out)';
      this.media.style.transform = '';
      this.media.style.opacity = '';
      setTimeout(() => { this.media.style.transition = ''; this._busy = false; }, 300);
      this.onChange?.(next.id);
    };
    setTimeout(swap, reducedMotion.matches ? 0 : 200);
  }

  /** Feed update while open. */
  update({ changed, removed }) {
    if (!this.isOpen) return;
    if (removed.has(this.id)) { this.close(); return; }
    this.order = tour(this.feed.list());
    const cam = this.feed.cameras.get(this.id);
    if (changed.has(this.id)) this.fb.set(cam.url);
    this._render(cam, true);
  }

  tick(now) {
    if (!this.isOpen) return;
    const cam = this.feed.cameras.get(this.id);
    if (!cam) return;
    const age = now - cam.ts;
    paintAge($('#viewer-age'), age);
    $('#viewer-time').textContent = `${sgClock.format(cam.ts)} SGT`;
    $('#viewer-time').title = ageLong(age);
  }

  _render(cam, quiet = false) {
    this.id = cam.id;
    if (!quiet) {
      $('#viewer-title').innerHTML = `${cam.near ? '<span class="muted">Near</span> ' : ''}${escapeHtml(cam.name)}`;
      $('#viewer-sub').textContent = `${cam.code} · ${cam.region} · ${cam.source}`;
      $('#viewer-pos').textContent = `${cam.approx ? '≈ ' : ''}${cam.lat.toFixed(3)}, ${cam.lng.toFixed(3)}`;
      $('#viewer-pos').title = cam.approx ? 'Approximate position, estimated from the KM marker' : '';
      const n = this.order.indexOf(cam.id);
      $('#viewer-count').textContent = n >= 0 ? `${n + 1} / ${this.order.length}` : '';
    }
    $('#viewer-res').textContent = `${cam.w}×${cam.h}`;
    $('#viewer-raw').href = cam.link || cam.url || '#';
    const { state } = freshness(Date.now() - cam.ts);
    this.media.dataset.state = state;
    this.tick(Date.now());
  }

  _onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.key === 'ArrowRight') this.step(1);
    else if (e.key === 'ArrowLeft') this.step(-1);
    else if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const f = [...this.root.querySelectorAll('button, a[href]')].filter((n) => n.offsetParent);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  _bindGestures() {
    const m = this.media;
    let sx = 0, sy = 0, dx = 0, dy = 0, axis = null, pid = null;
    m.addEventListener('pointerdown', (e) => {
      if (this._busy || !this.isOpen) return;
      pid = e.pointerId;
      sx = e.clientX; sy = e.clientY; dx = dy = 0; axis = null;
      m.setPointerCapture(pid);
    });
    m.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      dx = e.clientX - sx;
      dy = e.clientY - sy;
      if (!axis && Math.hypot(dx, dy) > 8) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (!axis) return;
      this.root.classList.add('dragging');
      if (axis === 'x') {
        m.style.transform = `translateX(${dx}px)`;
      } else {
        // Rubber band: up resists, down follows and fades the backdrop.
        const y = dy > 0 ? dy : dy / 4;
        const s = 1 - Math.min(0.25, Math.max(0, dy) / 1200);
        m.style.transform = `translateY(${y}px) scale(${s})`;
        this.root.style.setProperty('--bd', String(1 - Math.min(0.7, Math.max(0, dy) / 400)));
      }
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      this.root.classList.remove('dragging');
      this.root.style.removeProperty('--bd');
      if (axis === 'y' && dy > 110) { this.close(); return; }
      if (axis === 'x' && Math.abs(dx) > 70) {
        m.style.transform = '';
        this.step(dx < 0 ? 1 : -1);
        return;
      }
      m.style.transform = '';
    };
    m.addEventListener('pointerup', end);
    m.addEventListener('pointercancel', end);
  }
}
