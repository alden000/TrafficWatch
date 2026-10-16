// CameraFeed — polls data.gov.sg (LTA, Singapore) and LLM (Johor highways)
// for the latest traffic camera frames.
//
// Battery contract (docs/CREATIVE_BRIEF.md §6):
//  - polls only while the page is visible; refreshes immediately on return
//  - 30s cadence, backing off to 60s after 3 polls with no new frames
//  - 60s cadence when the user has Save-Data on
//  - exponential back-off on errors (max 2 min)

import { placeFor } from './places.js';
import { LlmSource } from './llm.js';

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
    this.llm = new LlmSource();
    this._lta = [];          // last good LTA entries (kept when a poll fails)
    this._merged = false;
    this._touched = new Set();
    this._touchTimer = 0;
    /** Is this camera on screen right now? Set by the app. */
    this.isWatched = () => false;

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

    // Johor cameras run alongside and merge in as each frame lands; a slow
    // or failing LLM never holds up Singapore.
    this._llmRound();

    let ltaErr = null;
    let fromCache = false;
    try {
      const res = await fetch(API_URL, { signal: ctrl.signal, cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      fromCache = res.headers.get('x-tw-cache') === 'offline';
      this._lta = parseLta(json);
      if (!fromCache) this.lastSuccess = Date.now();
      else if (!this.lastSuccess) this.lastSuccess = Date.parse(json.items[0].timestamp) || Date.now();
      this.apiTime = Date.parse(json.items[0].timestamp) || this.apiTime;
    } catch (err) {
      ltaErr = err;
    }

    try {
      // Superseded by a newer refresh, or paused mid-flight: drop this round.
      if (this._inflight !== ctrl || document.hidden) return;
      this._merge();
      if (ltaErr) {
        this._errors++;
        this._setState(navigator.onLine === false ? 'offline' : 'error');
        this.dispatchEvent(new CustomEvent('error', { detail: ltaErr }));
      } else {
        this._errors = 0;
        this._setState(fromCache || !navigator.onLine ? 'offline' : 'live');
      }
    } finally {
      clearTimeout(timeout);
      if (this._inflight === ctrl) {
        this._inflight = null;
        this._schedule();
      }
    }
  }

  /** A camera just came on screen: fetch its Johor frame now if it's due. */
  touch(id) {
    if (!this.llm.cams.some((c) => c.id === id)) return;
    this._touched.add(id);
    clearTimeout(this._touchTimer);
    this._touchTimer = setTimeout(async () => {
      const ids = this._touched;
      this._touched = new Set();
      if (document.hidden) return;
      this.llm.poll(this.isWatched, ids, () => this._mergeSoon()).catch(() => {});
    }, 250);
  }

  async _llmRound() {
    if (this._llmBusy) return;
    this._llmBusy = true;
    try {
      const before = this.llm.cams;
      await this.llm.loadList();
      if (this.llm.cams !== before) this._mergeSoon(); // pins before frames
      await this.llm.poll(this.isWatched, null, () => this._mergeSoon());
    } catch { /* list missing (local dev) or offline: Singapore carries on */ }
    finally { this._llmBusy = false; }
  }

  /** Coalesce frames that land close together into one update. */
  _mergeSoon() {
    if (this._mergeTimer || !this._merged) {
      // Before the first LTA answer, let refresh() do the first merge,
      // unless LTA is down: then Johor alone still shows up.
      if (!this._merged && !this._mergeTimer) this._mergeTimer = setTimeout(() => { this._mergeTimer = 0; this._merge(); }, 4000);
      return;
    }
    this._mergeTimer = setTimeout(() => { this._mergeTimer = 0; this._merge(); }, 120);
  }

  _merge() {
    clearTimeout(this._mergeTimer); // this merge includes anything pending
    this._mergeTimer = 0;
    const first = !this._merged;
    this._merged = true;
    const seen = new Set();
    const changed = new Set();
    const added = new Set();

    for (const e of [...this._lta, ...this.llm.entries()]) {
      seen.add(e.id);
      const prev = this.cameras.get(e.id);
      if (!prev) {
        this.cameras.set(e.id, e);
        added.add(e.id);
      } else if (prev.url !== e.url) {
        Object.assign(prev, { url: e.url, ts: e.ts, lat: e.lat, lng: e.lng, link: e.link });
        changed.add(e.id);
      }
    }

    const removed = new Set();
    for (const id of this.cameras.keys()) {
      if (!seen.has(id)) { this.cameras.delete(id); removed.add(id); }
    }

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

function parseLta(json) {
  const item = json?.items?.[0];
  if (!item || !Array.isArray(item.cameras)) throw new Error('Unexpected response');
  const out = [];
  for (const c of item.cameras) {
    const lat = +c.location?.latitude;
    const lng = +c.location?.longitude;
    if (!c.camera_id || !c.image || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const id = String(c.camera_id);
    const place = placeFor(id, lat, lng);
    out.push({
      id, lat, lng, url: c.image,
      ts: Date.parse(c.timestamp) || Date.now(),
      w: c.image_metadata?.width || 1920,
      h: c.image_metadata?.height || 1080,
      name: place.name, near: place.near, region: place.region,
      code: `Camera ${id}`, approx: false, source: 'LTA', link: c.image,
    });
  }
  return out;
}

/**
 * @typedef {{id:string, lat:number, lng:number, url:string|null, ts:number,
 *   w:number, h:number, name:string, near:boolean, region:string,
 *   code:string, approx:boolean, source:'LTA'|'LLM', link:string}} Camera
 */
