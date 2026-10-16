// Small shared helpers. No dependencies.

export const $ = (sel, root = document) => root.querySelector(sel);

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Frames usually land 1–5 min after capture, so the scale is minutes, not seconds.
export const FRESH_MS = 4 * 60e3;
export const STALE_MS = 8 * 60e3;

export function freshness(ageMs) {
  return {
    p: Math.max(0, Math.min(1, 1 - ageMs / STALE_MS)),
    state: ageMs < FRESH_MS ? 'fresh' : ageMs < STALE_MS ? 'aging' : 'stale',
  };
}

export function ageShort(ageMs) {
  const s = Math.max(0, Math.round(ageMs / 1000));
  if (s < 20) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export function ageLong(ageMs) {
  const s = Math.max(0, Math.round(ageMs / 1000));
  if (s < 20) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  return h === 1 ? '1 hour ago' : `${h} hours ago`;
}

export const sgClock = new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Paint an age chip (`.age-chip` with `.led` + text span). */
export function paintAge(chip, ageMs) {
  const { state } = freshness(ageMs);
  chip.classList.toggle('s-aging', state === 'aging');
  chip.classList.toggle('s-stale', state === 'stale');
  chip.lastElementChild.textContent = ageShort(ageMs);
}

export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

/** Run `fn` once when a CSS animation ends, with a timeout fallback. */
export function afterAnimation(node, fn, fallbackMs = 600) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    node.removeEventListener('animationend', onEnd);
    clearTimeout(timer);
    fn();
  };
  const onEnd = (e) => { if (e.target === node || node.contains(e.target)) finish(); };
  node.addEventListener('animationend', onEnd);
  const timer = setTimeout(finish, reducedMotion.matches ? 20 : fallbackMs);
}

/** Restart a one-shot CSS animation class. */
export function replayClass(node, cls, durationMs) {
  node.classList.remove(cls);
  void node.offsetWidth; // one forced style flush per event, never in a loop
  node.classList.add(cls);
  clearTimeout(node[`_t_${cls}`]);
  node[`_t_${cls}`] = setTimeout(() => node.classList.remove(cls), durationMs);
}

export const storage = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
};
