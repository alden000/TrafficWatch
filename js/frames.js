// FrameBox: a container that shows one camera frame and plays the
// "shutter blink" when a newer frame replaces it. Shared by the map windows,
// the wall tiles and the viewer.
//
// Frames are downloaded and decoded *before* they are shown (img.decode()),
// so a swap never flashes a half-loaded image and decoding stays off the
// main thread.

import { el, replayClass, reducedMotion } from './util.js';

function decodeFrame(url) {
  const img = new Image();
  img.decoding = 'async';
  img.alt = '';
  img.draggable = false;
  img.src = url;
  if (img.decode) {
    // Some engines reject decode() for very large images; fall back to load.
    return img.decode().then(() => img, () => (img.complete && img.naturalWidth ? img : loaded(img)));
  }
  return loaded(img);
}

function loaded(img) {
  return new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth) return resolve(img);
    img.onload = () => resolve(img);
    img.onerror = reject;
  });
}

function release(img) {
  img.onload = img.onerror = null;
  img.removeAttribute('src');
  img.remove();
}

export class FrameBox {
  constructor(blinkMs = 560) {
    this.root = el('div', 'fb is-empty');
    this.sweep = el('div', 'fb-sweep');
    this.root.append(this.sweep);
    this.url = null;      // currently shown
    this.wanted = null;   // most recently requested
    this.blinkMs = blinkMs;
    this.dead = false;
  }

  /**
   * Show `url`. Resolves true when it is on screen.
   * @param {{animate?: boolean}} opts animate=false skips the blink (first paint).
   */
  set(url, { animate = true } = {}) {
    if (!url || url === this.wanted) return Promise.resolve(url === this.url);
    this.wanted = url;
    return decodeFrame(url).then(
      (img) => {
        if (this.dead || this.wanted !== url) { release(img); return false; }
        this._swap(img, animate);
        return true;
      },
      () => {
        if (this.dead || this.wanted !== url) return false;
        this.wanted = null; // allow a retry on the next poll
        if (!this.url) this.root.classList.add('is-error');
        this.root.classList.remove('is-empty');
        return false;
      },
    );
  }

  /** Reuse an already decoded <img> (e.g. from the window that opened the viewer). */
  adopt(srcImg, url) {
    if (!srcImg || !url) return false;
    const img = srcImg.cloneNode();
    img.className = '';
    this._clearImages();
    this.root.insertBefore(img, this.sweep);
    this.url = this.wanted = url;
    this.root.classList.remove('is-empty', 'is-error');
    return true;
  }

  currentImg() {
    const imgs = this.root.getElementsByTagName('img');
    return imgs[imgs.length - 1] || null;
  }

  _swap(img, animate) {
    const first = !this.url;
    const blink = animate && !first && !reducedMotion.matches;
    img.className = blink ? 'in-blink' : 'in-first';
    const old = [...this.root.getElementsByTagName('img')];
    this.root.insertBefore(img, this.sweep);
    this.url = this.wanted;
    this.root.classList.remove('is-empty', 'is-error');
    if (blink) replayClass(this.root, 'blink', this.blinkMs + 40);
    // Drop the previous frame once the new one has fully faded in.
    setTimeout(() => old.forEach(release), blink ? this.blinkMs + 60 : 400);
  }

  _clearImages() {
    [...this.root.getElementsByTagName('img')].forEach(release);
  }

  /** Free decoded memory (off-screen wall tiles, removed windows). */
  clear() {
    this._clearImages();
    this.url = this.wanted = null;
    this.root.classList.remove('is-error');
    this.root.classList.add('is-empty');
  }

  destroy() {
    this.dead = true;
    this._clearImages();
  }
}
