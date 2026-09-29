# Workout Log

A personal, mobile-friendly **Progressive Web App** workout logger. Record which equipment you used, how much weight you lifted, and how many reps — with multiple sets per day and a browsable history. Everything stays in your browser (no backend). Install it to your iPhone Home Screen for a standalone, offline-capable experience.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (default [http://localhost:5173](http://localhost:5173)).

### Other scripts

```bash
npm run icons        # regenerate public/*.png app icons (requires sharp)
npm run build        # typecheck + production build (includes service worker + manifest)
npm run preview      # serve the production build locally
npm run preview:pwa  # serve build on 0.0.0.0:5173 (good for phone testing)
```

To expose the **dev** server on your network:

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

> **Note:** iOS “Add to Home Screen” and reliable offline caching work best against an **HTTPS** origin (or `localhost`). Use a tunnel (e.g. Cloudflare Tunnel, ngrok) or host the `dist/` folder on HTTPS when installing from a phone.

## Install on iPhone (Add to Home Screen)

Works with Safari on iOS (including recent iOS releases such as iOS 27):

1. Open the app’s **HTTPS** URL in **Safari** (not Chrome or in-app browsers).
2. Tap the **Share** button (square with an upward arrow).
3. Scroll and tap **Add to Home Screen**.
4. Confirm the name (**Workout Log**) and tap **Add**.
5. Open the new Home Screen icon — it launches **standalone** (no Safari chrome), with offline shell caching via the service worker.

After the first successful visit online, the app shell is cached so it can open from the Home Screen even without a network connection. Your sets still live in this device’s `localStorage`.


## Voice logging

### Guided (default)

1. Pick **equipment** first (recent chips or search).
2. Tap **mic** and say **numbers only**:
   - Strength → weight / reps / sets (e.g. `90 for 15 for 3 sets`)
   - Cardio → miles|flights, calories, minutes (e.g. `10 flights 200 calories 35 minutes`)
3. Tap mic again → confirm → save.

The selected equipment is **locked** for parsing, so Whisper inventing a wrong machine name is ignored.

**Freeform** (optional advanced tab): say the full utterance including equipment name.

### Engines

**Safari / Home Screen PWA:** Whisper only (`getUserMedia` → PCM → `POST /api/transcribe`, `whisper-medium.en`). Web Speech / Apple SpeechRecognition is **disabled** in the web app. Status shows “Listening…” / “Used Whisper”. Native iOS app may still use SFSpeech separately.

**iPhone tip:** Apple / Web Speech **cannot run in the Home Screen PWA** (WebKit). Whisper is the default there — the app shows a clear banner. For Apple speech, open the same HTTPS URL in a **Safari tab**, or use the native **WorkoutLogIOS** app. The on-screen **Apple diag** line shows `mode`, `started`, and `err`.

### How to log (Safari tab)

1. Open the **HTTPS tunnel URL in Safari** (not Chrome). Allow Microphone.
2. Open **Log** → leave mode on **Guided** → pick e.g. Stair Step Machine.
3. Tap mic → say `10 flights 200 calories 35 minutes` → tap again.
4. Status shows which engine won → confirm → **Save**.

Optional: **Quick voice log** auto-saves high-confidence parses. **Type instead** is secondary.

### Example phrases

- `bench press 185 for 8`
- `squat 225 pounds 5 reps`
- `leg press one thirty five by ten`
- `dumbbell curl 30 lbs times 12`
- `cable row 120 pounds 10 reps`

### Notes

- Needs **HTTPS** (or localhost) for microphone access.
- Mic capture starts **immediately** on tap (Web Audio PCM). Transcription runs on the server (first request may wait while the model loads).
- While listening, a volume bar shows the mic is live.
- If mic permission is denied, allow access for this site and tap the mic again.
- Quiet “Logged” feedback uses `speechSynthesis` only (no `HTMLAudioElement`).

### Run (static + ASR server)

```bash
npm run build
npm start          # or: npm run preview:pwa
# listens on 0.0.0.0:5173 — serves dist/ + /api/transcribe
```

```bash
npm run test:parse
```




## Siri Shortcut (deep-link logging)

iOS PWAs cannot register with Siri. Instead, create a **Shortcut** that dictates your set and opens Workout Log with a query string. The app parses the utterance and writes into **this phone’s** `localStorage` (no server storage).

### URL pattern

```
https://YOUR_ORIGIN/?log=YOUR%20UTTERANCE
```

- Prefer `log=` (also accepts `voice=`).
- Optional `autolog=0` to always show the confirm card (default is auto-log when the parse is strong).
- Example: `https://YOUR_ORIGIN/?log=bench%20press%20185%20for%208`

While using Cloudflare Tunnel, `YOUR_ORIGIN` is the `https://….trycloudflare.com` URL (same origin as the Home Screen PWA).

### Create the Shortcut (step-by-step)

1. Open the **Shortcuts** app → tap **+** (New Shortcut).
2. Add action **Dictate Text** (or **Ask for Input** → Text).
3. Add action **Open URLs**.
4. Set the URL to: your origin + `/?log=` + the **Dictated Text** variable.
   - Tip: type `https://YOUR_ORIGIN/?log=` then tap the variable chip for Dictated Text so Shortcuts URL-encodes spaces.
5. Tap the shortcut name / info (**ⓘ**) → **Add to Siri** → record a phrase like **“Log my set”**.
6. Say the phrase to Siri → speak e.g. “bench press 185 for 8” → Safari/PWA opens → set is logged (or confirm card if the parse is weak).

In-app: **Gear** tab shows the live URL prefix for your current origin (copy button).


## Features

- **Log a set** — pick or type equipment, weight with **lb/kg** toggle, reps, optional notes
- **Today’s session** — see everything logged today; edit or delete individual sets
- **Equipment library** — remembered names with autocomplete/quick pick; add, rename, remove
- **History** — browse past days; open a day for all equipment + sets; per-day totals
- **Persistence** — `localStorage`; **Export / Import JSON** from the Gear tab
- **PWA** — web app manifest, icons, Apple meta tags, service worker (Workbox via `vite-plugin-pwa`)
- **Nice extras** — quick-repeat last set, progress glance, dark gym UI, large tap targets, safe-area insets for notch / home indicator

## PWA verification

After `npm run build` and `npm run preview` (or `preview:pwa`):

| Check | Where |
| --- | --- |
| Manifest | [http://localhost:5173/manifest.webmanifest](http://localhost:5173/manifest.webmanifest) |
| Service worker | DevTools → Application → Service Workers (`sw.js` / Workbox) |
| Icons | `/icon-192.png`, `/icon-512.png`, `/apple-touch-icon.png` |
| Registration | `src/main.tsx` calls `registerSW({ immediate: true })` |

In Chrome DevTools you can also run Lighthouse → Progressive Web App.

## Usage tips

1. Open **Log**, enter an equipment name (or tap a suggestion), weight, and reps.
2. Switch to **Today** to review, edit, or delete sets.
3. Manage saved names under **Gear**; use **Export JSON** for backups.
4. Open **History** to revisit previous days.

Data never leaves this device unless you export or import a file yourself. The storage key remains `workout-log:v1`.

## Tech

- Vite + React + TypeScript
- `vite-plugin-pwa` (Workbox) for manifest + offline caching
- Client-only persistence via `localStorage`

## Project layout

```
public/           icons (192/512/maskable/apple-touch), favicon
scripts/          generate-icons.mjs
src/
  components/     UI screens (Today, Log, Gear, History)
  hooks/          useWorkoutStore — state + persistence
  storage.ts      load/save/export/import
  types.ts        shared types
  App.tsx         shell + bottom navigation
  main.tsx        React bootstrap + SW registration
```

## Limitations

- Data is per-browser / per-device (clearing site data wipes the log unless you exported)
- No cloud sync or multi-user accounts
- History day detail is read-only (edit/delete from **Today** for the current day)
- Import replaces the entire local dataset
- iOS Add to Home Screen requires Safari + preferably HTTPS; offline covers the app shell (UI), not cross-device sync
