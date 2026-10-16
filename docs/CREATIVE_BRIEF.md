# TrafficWatch — Creative Brief

> **Concept: "Windows onto the island."**
> Singapore's traffic cameras are small windows looking at the city. The map is
> the island. The app lets you look through those windows, and shows you when
> each one has just blinked a new frame.

---

## 1. The idea in one line

A living map of Singapore where every traffic camera floats above its spot as
a small picture-in-picture window. Each window **blinks** (a quick shutter
sweep) when the camera sends a new frame. The city should feel like it's
breathing, at the pace of the real data.

## 2. Principles

| # | Principle | What it means in practice |
|---|-----------|---------------------------|
| 1 | **Real data drives the motion** | Nothing moves in a loop forever. Every animation is caused by something real: a new frame, a tap, a pan. A still map means nothing changed. This is also the main battery rule. |
| 2 | **The map is the stage, the cameras are the cast** | The map is muted and low-contrast. Colour and contrast go to the camera windows and their status. |
| 3 | **Light at day, sodium at night** | The theme follows the system. Light mode is calm paper and ink. Dark mode is a night city lit by sodium-vapour amber and signal cyan. |
| 4 | **Physical, not flashy** | Windows have weight: they spring, settle and cast soft shadows. Transitions keep the object you touched (shared-element), so you never lose your place. |
| 5 | **Quiet confidence** | Text is short and exact: "12s ago", "Cam 2701", "Live". No exclamation marks, no spinners when a skeleton will do. |

## 3. Visual language

### 3.1 Palette

**Day Shift (light)**

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#F4F1EA` warm paper | app background / letterbox |
| `--surface` | `#FFFFFF` @ 92% | cards, sheets |
| `--ink` | `#14161A` | primary text |
| `--ink-2` | `#5B6170` | secondary text |
| `--hairline` | `rgba(20,22,26,.10)` | 1px borders |
| `--accent` | `#0A6CFF` signal blue | live state, focus, links |
| `--fresh` | `#12B76A` | frame < 4 min old |
| `--aging` | `#F59E0B` | 4–8 min |
| `--stale` | `#E5484D` | > 8 min / error |
| Map | OSM raster, `saturate(.55) contrast(.95) brightness(1.03)` | muted base |

**Night Shift (dark)**

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#07090D` | |
| `--surface` | `#11151C` @ 92% | |
| `--ink` | `#E9EDF3` | |
| `--ink-2` | `#8A93A6` | |
| `--hairline` | `rgba(255,255,255,.08)` | |
| `--accent` | `#FFB547` sodium amber | live state, focus |
| `--accent-2` | `#4FD1FF` signal cyan | secondary highlights |
| `--fresh` | `#3DDC97` | |
| `--aging` | `#FFB547` | |
| `--stale` | `#FF6B6B` | |
| Map | OSM raster, `invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) saturate(.35)` | navy night map; water stays dark, roads glow faintly |

The dark map comes from a CSS filter on the **tile pane only**. That is one
composited layer, so markers and windows keep their real colours.

### 3.2 Type

- **System UI stack** (`-apple-system, "SF Pro", "Segoe UI Variable", Roboto, Inter, sans-serif`): no webfont download, so it loads fast and costs nothing.
- Numbers use `font-variant-numeric: tabular-nums` so counters like "12s" don't jitter.
- Scale: 11 / 13 / 15 / 20 / 28. Labels are 11px with +4% tracking and uppercase, used rarely.

### 3.3 Shape and depth

- Window radius **14px**, chips **999px**, sheets **22px** top corners.
- Two shadow levels only:
  - `--shadow-1`: `0 1px 2px rgba(0,0,0,.08), 0 6px 18px rgba(0,0,0,.10)`
  - `--shadow-2`: `0 2px 6px rgba(0,0,0,.12), 0 18px 48px rgba(0,0,0,.22)` (lifted or expanded)
- In dark mode, shadows become a soft **outer glow** of the accent at 0–12% opacity. Light spills from the windows instead of shadows falling.
- Frosted glass (`backdrop-filter`) is used on **one** element at a time: the top HUD. It is never used on the camera windows, because many backdrop filters at once are a top cause of mobile GPU drain.

### 3.4 Iconography

- The mark is an **aperture**: a rounded square (the window) with a circle (the lens) and a small dot (the live LED). It works as the app icon, splash and favicon.
- UI icons: 1.75px stroke, rounded joins, 24px grid, inline SVG. No icon font.

## 4. The cast: components

### 4.1 Camera anchor ("the pin")

A 10px dot at the camera's real position, with a 2px surface-coloured ring.
Around it sits a **freshness arc** (conic gradient) that shows how old the
current frame is, like a clock hand running down:

- full arc = just updated, then it shrinks over 8 minutes (LTA frames usually arrive 1–5 minutes after capture)
- the colour moves fresh → aging → stale
- updated in 15-second steps by setting a CSS variable. No `requestAnimationFrame`.

When the camera sends a new frame, the pin gives off **one radar ping**: a
ring that scales from 1× to 3.2× and fades over 900ms. It plays once per
update and never loops.

### 4.2 The PiP window

A 16:9 window floating near its pin, joined to it by a **leader line** (a
1px line with a 3px dot at the pin end).

```
            ┌──────────────────────────┐
            │                          │
            │      (camera frame)      │
            │                          │
            │ ▌WOODLANDS        ● 12s  │  ← label chip / age chip
            └──────────┬───────────────┘
                       │  leader line
                       ●  pin + freshness arc
```

- **Sizes by zoom:** S 132×74 (zoom ≤ 11), M 176×99 (12–13), L 232×131 (≥ 14). On phones the tier steps down one size.
- **Label:** a gradient scrim at the bottom 40% with the place name (uppercase, 11px) and an age chip with a coloured LED (fresh/aging/stale).
- **Skeleton:** before the first frame decodes, the window shows a slow diagonal shimmer. This is the *only* looping animation, it stops as soon as the image arrives, and it is skipped when reduced motion is on.

**Signature effect, "the shutter blink."** When a new frame is ready (already
downloaded and decoded off-thread, so it never flashes half-loaded):

1. A bright scan bar (a soft gradient, 30% of the window width) sweeps left to right across the window in **560ms** (`cubic-bezier(.2,.7,.2,1)`).
2. The new frame crossfades in **behind** the bar, so the bar seems to "paint" the new image.
3. The window gives a tiny **0.98 → 1.0 scale pop**, like a camera shutter clicking.
4. The pin sends its radar ping at the same moment.

It is all `transform` and `opacity`, all on the compositor, with no layout
work.

### 4.3 Collision choreography

Windows never stack on top of each other. After the map settles (`moveend` /
`zoomend`, never during the gesture), a placement pass tries eight positions
around each pin (N, NE, E, SE, S, SW, W, NW) in order of preference. It picks
the first one that doesn't collide with windows already placed and stays
inside the viewport. Windows that move **glide** to their new spot (420ms
spring curve), and their leader lines swing with them. If there's no room, a
window steps back to being just a pin and returns when there's space.

Priority goes to cameras **nearest the centre of the screen**, so what you
are looking at always gets a window.

### 4.4 Zoom behaviour

- When a zoom starts, windows **fade and shrink toward their pins** in 160ms. A scaling raster under live DOM cards looks cheap, so we hide them.
- When the zoom ends, they come back in a **staggered cascade** (25ms per window, nearest-to-centre first) with a soft spring (`cubic-bezier(.34,1.56,.64,1)`, 380ms).

### 4.5 HUD (top bar)

A floating frosted capsule, 12px from the top safe-area inset:

```
 ╭───────────────────────────────────────────────╮
 │ [◉] TrafficWatch     ● LIVE · 8 cams · 12s    │
 ╰───────────────────────────────────────────────╯
```

- The **live LED** pulses **once per successful poll** (heartbeat), not all the time.
- States: `LIVE` (accent), `UPDATING…` (LED spins once), `PAUSED` (tab hidden, grey), `OFFLINE` (stale colour; shows the last frames from cache).
- Tapping the capsule opens a small panel with source attribution and the time of the last update.

### 4.6 Control cluster (bottom right, thumb zone)

Round 48px glass buttons stacked vertically:

1. **Locate me**: asks for geolocation only when tapped, then flies to you with a soft accuracy circle.
2. **Wall / Map toggle**: switches to Control Room mode (§4.8).
3. **Fit all**: zooms out to show every camera.

Buttons press with a 0.94 scale and give 8ms of haptic feedback where it's supported.

### 4.7 The Viewer (fullscreen camera)

Tap a window and it **becomes** the viewer through a shared-element transition:

1. The window's on-screen rectangle is measured (FLIP).
2. A fixed viewer layer starts exactly over the window, then animates to full width (letterboxed 16:9) in **420ms** using `cubic-bezier(.2,.8,.2,1)`. The corner radius goes from 14px to 0px on phones (or 20px on desktop).
3. The backdrop darkens behind it (opacity only).
4. The metadata sheet slides up from below with a 60ms delay: place name, camera ID, capture time ("19:15:57 · 42s ago"), coordinates, frame resolution.
5. Closing plays the same animation backwards, back to the window's *current* position. Swiping down on the image also closes it, and the image follows your finger with rubber-band resistance.

Inside the viewer:

- **Swipe left/right** steps to the next or previous camera *by distance*, so you walk along the road network. The image slides with a parallax offset (outgoing image moves at 0.6× speed).
- The viewer keeps updating live: the shutter blink plays here too, bigger and slower (800ms).
- **"Show on map"** closes the viewer and flies the map to the camera, and the pin pings.
- Pinch zoom isn't built in. The 1920×1080 frame shown full-screen is already sharp, so the native browser zoom is enough.

### 4.8 Control Room ("Wall") mode

A second view: every camera as a tile in a responsive grid of monitors, like a
traffic control centre.

- The transition from the map is a **cross-dissolve plus lift**: the map dims and scales down to 0.96, and tiles rise in a staggered wave from the bottom, 18ms apart.
- Tiles are sorted by region (north to south), with sticky region headers.
- Images load lazily as they scroll into view (IntersectionObserver). Tiles off screen release their images.
- The same shutter blink plays here, so the wall flickers to life as frames arrive, which is the "control room" feel.

### 4.9 Intro (first paint)

1. **0ms:** the background colour with the aperture mark in the centre, drawn in the HTML itself so it shows instantly.
2. **0–500ms:** the lens circle of the mark "focuses" (the stroke draws via `stroke-dashoffset`).
3. **When the first data and the map are ready:** the mark scales up 1.0 → 14 and fades, like flying *through* the lens into the map, while the map fades in from 0 to 1 opacity.
4. Windows then cascade in (see §4.4).

The intro is skipped on revisits within the same session and shortened to a
200ms fade when reduced motion is on.

### 4.10 Toasts

These are small, bottom-centre capsules, and at most one is shown at a time:

- "3 cameras updated": only in Wall mode, or when the update comes after a long gap.
- "You're offline — showing last frames"
- "Back online"

They slide up 12px and fade in (240ms), stay for 2.4s, then fade out.

## 5. Motion system

| Token | Curve | Duration | Use |
|-------|-------|----------|-----|
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | 240–420ms | most transitions |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | 380ms | windows appearing |
| `--ease-glide` | `cubic-bezier(.25,1,.5,1)` | 420ms | repositioning |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | 160ms | hiding / exits |
| `--t-blink` | `cubic-bezier(.2,.7,.2,1)` | 560ms | shutter blink |

Rules:

- Only `transform` and `opacity` are animated. Never `width`, `height`, `top`, `left` or `filter`.
- `will-change` is added only while an animation is running.
- **Reduced motion:** springs become 120ms fades, no sweeps, no pings, no parallax.
- **Background tab:** CSS animations stop naturally. JS polling stops (§6).

## 6. Performance and battery contract

This is how the engineering keeps the creative ideas cheap to run:

1. **Polling follows visibility.** Poll the API every 30s while visible, stop when the tab is hidden, and fetch at once when it becomes visible again. If 3 polls in a row bring no new frames, back off to 60s. With `Save-Data`, poll every 60s.
2. **Only fetch what's seen.** A camera's image is downloaded only when its window or tile is on screen. Hidden cameras just remember their latest URL.
3. **Decode before display.** `img.decode()` runs before the swap, so frames never flash or tear, and decoding happens off the main thread.
4. **Zero idle animation.** After the intro, a still map draws zero frames. Only the skeleton shimmer loops, and only until its image loads.
5. **Batched DOM writes.** Placement runs once per `moveend`, reads all positions first, then writes all transforms in a single `requestAnimationFrame`.
6. **One timer.** A single 15s ticker updates all age labels and freshness arcs while visible.
7. **Service worker:**
   - App shell: precached (cache-first).
   - API JSON: network-first with a 6s timeout, falling back to the last cached response (offline mode).
   - OSM tiles: stale-while-revalidate, capped at 600 tiles (LRU-trimmed), within OSM's tile-usage policy.
   - Camera images: not cached. They are cross-origin without CORS and short-lived (max-age 300), and the browser's HTTP cache already handles them.
8. **No frameworks.** Plain ES modules and Leaflet (~40 KB gzipped). No build step needed.

## 7. Voice and microcopy

| Situation | Copy |
|-----------|------|
| Age chip | `now`, `12s`, `3m`, `1h` |
| HUD | `LIVE · 8 cams` / `PAUSED` / `OFFLINE` |
| Viewer meta | `Captured 19:15:57 · 42s ago` |
| Empty (API gives 0 cams) | "No cameras are reporting right now. We'll keep watching." |
| Error | "Couldn't reach data.gov.sg. Retrying in 30s." |
| Attribution | "Traffic images © LTA via data.gov.sg · Map © OpenStreetMap contributors" |

## 8. Accessibility

- Every window is a `<button>` with an `aria-label` ("Woodlands camera 2701, updated 12 seconds ago").
- Focus ring: 2px `--accent` with 2px offset, shown only with `:focus-visible`.
- The viewer is a dialog: it traps focus, closes on Escape, and returns focus to the window that opened it.
- Text contrast is ≥ 4.5:1 in both themes. Text on images always sits on a scrim.
- All touch targets are ≥ 44px.

## 9. Out of scope (v1)

- Historical playback / time-lapse. The API supports `date_time`, so this is a natural v2: "scrub the last hour".
- Push notifications.
- Route-based camera filtering.
