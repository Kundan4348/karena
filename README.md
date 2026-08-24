# Lumina Clock

A living, full-screen **PWA clock** that reacts to **music** and **weather** — installable on **iPhone, Android, and desktop**. Pure HTML + CSS + vanilla JS (Canvas 2D + Web Audio). No build step, no framework, no account, works offline.

## 14 clock faces (swipe left/right to change)
| Face | What it is |
|---|---|
| **Aurora** | StandBy-style big numerals over a drifting gradient mesh |
| **Neon** | Multi-layer glowing neon tubes — near-white core, flicker, floor reflection, bass-reactive |
| **Flip** | **True 3D split-flap** cards with a real fold + shadow sweep |
| **Seven-Seg** | Authentic recessed DSEG LED panel with ghost segments + bloom |
| **Word** | Time spelled in words on a letter grid |
| **Glass** | Holographic glassmorphism card — iridescent conic border + sheen |
| **Analog** | Realistic metallic bezel, weighted hands, smooth sweeping second hand |
| **HUD** | Tron-style concentric glowing rings (h/m/s) + reticle + counter-rotating ring |
| **Synthwave** | Retro grid horizon, chromatic-aberration digits, scanlines, glitch-on-tick |
| **Pulse** | Dot-matrix digits riding a live spectrum equalizer |
| **Constellation** | Stars connect into the digits over a twinkling field |
| **Chroma Rain** | Matrix waterfall with the time held crisp in the center |
| **Solaris** | An orrery — planets on rings encode hours / minutes / seconds |
| **Ember** | Thousands of glowing sparks converge into the numerals |

## Features
- **Music sync** — microphone (reacts to room music, works on iPhone & Android) *or* a built-in generated ambient loop published to the lock-screen media controls. Beat + bass/mid/treble drive every animated face.
- **Weather sync** — free, keyless **Open-Meteo** + geolocation. Sky palette shifts through dawn → day → dusk → night, and animated rain / snow / fog / stars match real conditions.
- **Portrait & landscape** auto-layouts, safe-area aware (notch-safe).
- **Keep screen awake** (Wake Lock), fullscreen, auto night-dimming, OLED burn-in drift.
- **Installable & offline** via manifest + service worker.

## Run locally
```bash
cd lumina-clock
./serve.sh              # serves http://localhost:8099  (localhost is a secure context)
```
Open **http://localhost:8099** on this machine — everything (service worker, wake lock, mic, geolocation) works over `localhost`.

## Install on your phone
Service workers, microphone and geolocation require **HTTPS** (or `localhost`). To get it on a phone, host the folder on any static HTTPS host — e.g. **GitHub Pages**, Netlify, Vercel, Cloudflare Pages (all free):
1. Push this folder to a repo → enable Pages, **or** drag-drop the folder into Netlify Drop.
2. Open the HTTPS URL on the phone.
   - **iPhone (Safari):** Share → **Add to Home Screen** → launch it for a chromeless full-screen clock.
   - **Android (Chrome):** tap the **Install** button (or menu → Install app).

## Notes on music
Browsers cannot read *another app's* now-playing (e.g. Spotify) on iOS or Android — no web API exposes it. So Lumina reacts to music two supported ways: **the microphone** (ambient room audio, the only cross-platform route) or **its own audio** (which it also publishes to the OS media controls). Grant mic permission when prompted for the best beat sync.

## Files
- `index.html` — the whole app (inline CSS + JS)
- `manifest.webmanifest`, `sw.js` — PWA install + offline
- `icons/` — app icons (generated)
- `serve.sh` — local dev server (binds 127.0.0.1)
