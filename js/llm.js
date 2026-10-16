// LlmSource — Johor highway cameras from Lembaga Lebuhraya Malaysia.
//
// The camera list (llm-johor.json) is built daily by the Pages workflow
// (scripts/fetch-llm.mjs). LLM gives no capture time, so each image is
// re-downloaded and hashed: a frame counts as new only when its bytes change.
// Battery: cameras on screen refresh every 60s (LLM's own cache time), the
// rest every 3 minutes, and nothing at all while the app is hidden.

const LIST_URL = 'llm-johor.json';
const LIST_TTL = 6 * 3600e3;
const WATCHED_MS = 58e3;
const IDLE_MS = 180e3;

async function digest(buf) {
  if (!crypto.subtle) return `${buf.byteLength}`; // insecure context (local dev)
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
  return Array.from(h.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class LlmSource {
  constructor() {
    this.cams = [];
    this._listAt = 0;
    /** @type {Map<string, {hash?:string, url?:string, prev?:string, at:number, ts:number, busy?:boolean}>} */
    this.frames = new Map();
  }

  async loadList() {
    if (Date.now() - this._listAt < LIST_TTL) return;
    const res = await fetch(LIST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    this._listAt = Date.now();
    // Expired links would all 403; better to show nothing than "No signal" x9.
    this.cams = json.expires > Date.now() && Array.isArray(json.cameras) ? json.cameras : [];
  }

  /**
   * Refresh frames that are due. Resolves to the ids whose picture changed.
   * @param {(id:string)=>boolean} isWatched
   * @param {Set<string>} [force] ids to refresh now (just came on screen)
   * @param {(id:string)=>void} [onFrame] called as each new frame lands
   */
  async poll(isWatched, force, onFrame) {
    const now = Date.now();
    const due = this.cams.filter((c) => {
      const f = this.frames.get(c.id);
      if (!f) return true;
      if (f.busy) return false;
      if (force?.has(c.id)) return now - f.at > 15e3;
      return now - f.at > (isWatched(c.id) ? WATCHED_MS : IDLE_MS);
    });
    const changed = new Set();
    await Promise.all(due.map(async (c) => {
      const f = this.frames.get(c.id) || { at: 0, ts: 0 };
      this.frames.set(c.id, f);
      f.busy = true;
      try {
        const res = await fetch(c.url, { cache: 'no-cache', signal: AbortSignal.timeout?.(15e3) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const hash = await digest(buf);
        f.at = Date.now();
        if (hash === f.hash) return;
        // Keep the previous blob alive one more round: the viewer may still be
        // cloning it. Older ones are released.
        if (f.prev) URL.revokeObjectURL(f.prev);
        f.prev = f.url;
        f.url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
        f.hash = hash;
        f.ts = f.at;
        changed.add(c.id);
        onFrame?.(c.id);
      } catch {
        f.at = Date.now(); // retry on the normal cadence
      } finally {
        f.busy = false;
      }
    }));
    return changed;
  }

  /** Entries in the feed's camera format. */
  entries() {
    return this.cams.map((c) => {
      const f = this.frames.get(c.id);
      return {
        id: c.id, lat: c.lat, lng: c.lng,
        url: f?.url || null,
        ts: f?.ts || Date.now(),
        w: 320, h: 240,
        name: c.name, near: false, region: 'Johor',
        code: c.code, approx: !!c.approx, source: 'LLM', link: c.url,
      };
    });
  }
}
