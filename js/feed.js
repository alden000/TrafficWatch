// CameraFeed — polls data.gov.sg for the latest traffic camera frames.
//
// Battery contract (docs/CREATIVE_BRIEF.md §6):
//  - polls only while the page is visible; refreshes immediately on return
//  - 30s cadence, backing off to 60s after 3 polls with no new frames
//  - 60s cadence when the user has Save-Data on
//  - exponential back-off on errors (max 2 min)

import { placeFor } from './places.js';

export const API_URL = 'https://api.data.gov.sg/v1/transport/traffic-images';

const BASE_MS = 30e3;
const IDLE_MS = 60e3;
const MAX_ERR_MS = 120e3;
const TIMEOUT_MS = 12e3;

export class CameraFeed extends EventTarget {
  constructor() {
    super();
    /** @type {Map<string, Camera>} */
    this.cameras = new Map();
    this.state = 'loading';  // loading | live | updating | paused | offline | error
    this.lastSuccess = 0;    // ms, when we last got a good response
    this.apiTime = 0;        // ms, the API's own timestamp
    this._timer = 0;
    this._quiet = 0;         // consecutive polls with no new frames
    this._errors = 0;
    this._inflight = null;
    this._started = false;
    this.saveData = !!navigator.connection?.saveData;

    document.addEventListener('visibilitychange', () => this._onVisibility());
    addEventListener('online', () => this.refresh());
    addEventListener('offline', () => this._setState('offline'));
  }

  start() {
    this._started = true;
    this._onVisibility();
  }

  _onVisibility() {
    if (!this._started) return;
    if (document.hidden) {
      clearTimeout(this._timer);
      this._inflight?.abort();
      this._setState('paused');
    } else {
      this.refresh();
    }
  }

  _schedule() {
    clearTimeout(this._timer);
    if (document.hidden) return;
    let ms = this._errors
      ? Math.min(MAX_ERR_MS, BASE_MS * 2 ** (this._errors - 1))
      : (this._quiet >= 3 || this.saveData ? IDLE_MS : BASE_MS);
    // Small jitter so many open clients don't hit the API in lock-step.
    ms += Math.random() * 2e3;
    this.nextPollAt = Date.now() + ms;
    this._timer = setTimeout(() => this.refresh(), ms);
  }

  async refresh() {
    if (!this._started || document.hidden) return;
    clearTimeout(this._timer);
    this._inflight?.abort();
    const ctrl = new AbortController();
    this._inflight = ctrl;
    const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    if (this.state !== 'loading') this._setState('updating');

    try {
      const res = await fetch(API_URL, { signal: ctrl.signal, cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const fromCache = res.headers.get('x-tw-cache') === 'offline';
      this._ingest(json, fromCache);
      this._errors = 0;
      this._setState(fromCache || !navigator.onLine ? 'offline' : 'live');
    } catch (err) {
      // Superseded by a newer refresh, or paused mid-flight: not an error.
      if (this._inflight !== ctrl || document.hidden) return;
      this._errors++;
      this._setState(navigator.onLine === false ? 'offline' : 'error');
      this.dispatchEvent(new CustomEvent('error', { detail: err }));
    } finally {
      clearTimeout(timeout);
      if (this._inflight === ctrl) {
        this._inflight = null;
        this._schedule();
      }
    }
  }

  _ingest(json, fromCache) {
    const item = json?.items?.[0];
    if (!item || !Array.isArray(item.cameras)) throw new Error('Unexpected response');
    const first = this.lastSuccess === 0;
    const seen = new Set();
    const changed = new Set();
    const added = new Set();

    for (const c of item.cameras) {
      const lat = +c.location?.latitude;
      const lng = +c.location?.longitude;
      if (!c.camera_id || !c.image || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const id = String(c.camera_id);
      seen.add(id);
      const prev = this.cameras.get(id);
      const ts = Date.parse(c.timestamp) || Date.now();
      if (!prev) {
        const place = placeFor(lat, lng);
        this.cameras.set(id, {
          id, lat, lng, url: c.image, ts,
          w: c.image_metadata?.width || 1920,
          h: c.image_metadata?.height || 1080,
          name: place.name, near: place.near, region: place.region,
        });
        added.add(id);
      } else if (prev.url !== c.image) {
        Object.assign(prev, { url: c.image, ts, lat, lng });
        changed.add(id);
      }
    }

    const removed = new Set();
    for (const id of this.cameras.keys()) {
      if (!seen.has(id)) { this.cameras.delete(id); removed.add(id); }
    }

    if (!fromCache) this.lastSuccess = Date.now();
    else if (!this.lastSuccess) this.lastSuccess = Date.parse(item.timestamp) || Date.now();
    this.apiTime = Date.parse(item.timestamp) || this.apiTime;
    this._quiet = changed.size || added.size ? 0 : this._quiet + 1;

    this.dispatchEvent(new CustomEvent('data', { detail: { first, changed, added, removed } }));
  }

  _setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.dispatchEvent(new CustomEvent('state', { detail: state }));
  }

  list() { return [...this.cameras.values()]; }
}

/**
 * @typedef {{id:string, lat:number, lng:number, url:string, ts:number,
 *   w:number, h:number, name:string, near:boolean, region:string}} Camera
 */
