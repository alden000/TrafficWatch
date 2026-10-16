# TrafficWatch

A PWA that shows Singapore's live traffic cameras as picture-in-picture windows over an OpenStreetMap base map. It follows the system light/dark theme, and when a camera sends a new frame, its window plays a "shutter blink."

Data: [LTA traffic images via data.gov.sg](https://data.gov.sg/datasets/d_6cdb6b405b25aaaacbaf7689bcc6fae0/view) (`https://api.data.gov.sg/v1/transport/traffic-images`).

**Read the creative brief first:** [`docs/CREATIVE_BRIEF.md`](docs/CREATIVE_BRIEF.md). It covers the concept, palette, motion system, components and the battery contract the code follows.

## Features

- **Map mode.** Each camera has a pin with a freshness arc. Windows float next to their pins on leader lines and are placed so they never overlap each other or cover a pin. The camera nearest the centre of the screen gets a window first.
- **Live updates.** The feed is polled every 30s while the app is visible. A new frame is decoded off-thread before it is shown, then swapped in with a scan-bar sweep, a crossfade and a radar ping on the pin.
- **Viewer.** Tapping a window opens it full screen with a shared-element transition. Swipe left/right to walk to the next camera along the island. Pull down or press Esc to close. "Show on map" flies the map to the camera.
- **Wall mode.** All cameras in a control-room grid, grouped by region. Images load lazily.
- **Offline.** The app shell and recent map tiles are cached. The last camera list is still shown when the network drops.
- **Accessibility.** Supports reduced motion, keyboard navigation and screen-reader labels.

## Battery / performance

- Polling **stops when the app is hidden** and fetches again as soon as it's visible. It backs off to 60s when nothing has changed, and polls every 60s with Save-Data on.
- Images are downloaded only for windows or tiles that are on screen. Wall tiles that scroll off screen release their memory.
- **Nothing animates while the map is idle.** All animation is transform/opacity only. A single 15s ticker updates the age labels.
- Window placement runs once after a pan or zoom ends, never during the gesture.
- No framework and no build step: plain ES modules plus Leaflet 1.9.4 (vendored).

## Run locally

```sh
npx http-server -p 8080 -c-1 .
# open http://localhost:8080
```

The service worker needs `localhost` or HTTPS.

## Deploy

It's a static site, so any static host works. `.github/workflows/pages.yml` deploys `main` to GitHub Pages. To turn it on, go to **Settings → Pages → Source: GitHub Actions**.

## Notes

- Camera names come from LTA DataMall's camera list (Annex G of the API guide). Any camera not on that list is labelled with the nearest well-known area (`js/places.js`).
- Since 30 June 2026 the API returns only 8 cameras (Woodlands, Tuas, Sentosa); before that it returned about 90 expressway cameras. The app shows whatever the API returns.
- Map tiles come from `tile.openstreetmap.org`, which is fine for personal or low traffic use under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/). For heavy public traffic, switch to a tile provider in `js/app.js`.
- Attribution: traffic images © LTA via data.gov.sg (Singapore Open Data Licence). Map © OpenStreetMap contributors.

## Structure

```
index.html            shell + inline intro
css/app.css           design tokens, components, motion
js/app.js             orchestration: map, HUD, controls, modes, intro
js/feed.js            visibility-aware polling
js/pip-layer.js       pins + PiP windows + collision placement
js/frames.js          decode-then-blink frame swapping
js/viewer.js          fullscreen FLIP viewer + gestures
js/wall.js            control-room grid
js/places.js          nearest-area naming
sw.js                 offline caching
```
