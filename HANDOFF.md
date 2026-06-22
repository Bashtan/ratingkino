# RatingKino — Handoff

## Live Site
- **Production:** https://findfilm.ai (custom domain) — also https://ratingkino.com
- **Cloudflare Pages fallback:** https://ratingkino.pages.dev
- **Cloudflare account:** `e8eeb644ca96a2d4cb2a9674ea599e79`
- **Pages project:** `ratingkino`
- **GitHub repo:** https://github.com/Bashtan/ratingkino

---

## What This Is

Single-file movie discovery platform — one `index.html` (~4000 lines) plus a Cloudflare Pages Function and a daily sync Worker. No build step, no framework, no dependencies.

Users browse movies fetched from KV (pre-enriched nightly) or live TMDB/OMDb, filter by genre/year, search with AI semantic search, open a modal with ratings + trailer + watch providers, and share deep links.

---

## File Structure

```
ratingkino/
├── index.html            ← entire site: CSS + JS + HTML (~4000 lines)
├── sw.js                 ← Service Worker (PWA offline cache + install prompt trigger)
├── functions/
│   └── api/[[path]].js   ← Cloudflare Pages Function (API proxy + KV reader + AI)
├── sync-worker.js        ← Cloudflare Worker — nightly data sync (deployed separately)
├── sync-worker.toml      ← wrangler config for sync Worker
├── wrangler.toml         ← wrangler config for Pages (KV + AI bindings)
├── assets/               ← static assets (icons, webmanifest, og-image)
│   ├── site.webmanifest  ← PWA manifest (display: standalone, start_url: /)
│   ├── icon-192.png      ← PWA icon 192×192
│   ├── icon-512.png      ← PWA icon 512×512
│   └── apple-touch-icon.png  ← 180×180 for iOS home screen
├── HANDOFF.md            ← this file
└── .claude/
    └── launch.json       ← local dev: python3 http.server port 8282
```

---

## Local Dev

```bash
# Static preview only — API endpoints won't work (need Cloudflare Workers runtime)
python3 -m http.server 8282 --directory /Users/bashtan/Projects/ratingkino
# open http://localhost:8282

# Full local dev with Pages Functions + KV + AI:
npx wrangler pages dev . --port 8282   # reads wrangler.toml bindings
```

The `workerd` process (Cloudflare's local runtime) runs at port 8282 — if it's already running, the Pages Function routes (`/api/*`) will work locally.

To test PWA install prompt debug mode: open `http://localhost:8282#pwa-debug` — bypasses standalone/cooldown guards, shows iOS prompt after 500ms.

---

## Deployment

**Automatic:** git push to `main` triggers a Cloudflare Pages build automatically.

```bash
git push origin main   # triggers auto-deploy via Cloudflare Pages git integration
```

**Manual (if git integration is down):**
```bash
npx wrangler pages deploy . --project-name ratingkino
```

**Deploy / update sync Worker:**
```bash
npx wrangler deploy --config sync-worker.toml
```

**Secrets:**
```bash
# Pages
npx wrangler pages secret put TMDB_KEY --project-name ratingkino
npx wrangler pages secret put OMDB_KEY --project-name ratingkino

# Sync Worker
npx wrangler secret put TMDB_KEY --name ratingkino-sync
npx wrangler secret put OMDB_KEY --name ratingkino-sync
```

**Clean up old deployments after a manual deploy spree:**
```bash
npx wrangler pages deployment list --project-name ratingkino
npx wrangler pages deployment delete <id> --project-name=ratingkino --force
```

---

## Infrastructure

### Cloudflare Pages — `ratingkino`
- Serves `index.html` + runs `functions/api/[[path]].js`
- Bindings (wrangler.toml): `MOVIES_CACHE` (KV) + `AI` (Workers AI)
- Secrets: `TMDB_KEY`, `OMDB_KEY`

### Cloudflare Worker — `ratingkino-sync`
- Deployed separately: `npx wrangler deploy --config sync-worker.toml`
- Cron: `0 0 * * *`, `5 0 * * *`, `10 0 * * *` (3 phases, 00:00–00:10 UTC)
- Writes to `MOVIES_CACHE` KV: keys `popular`, `new-releases`, `random-pool`, `last-sync`
- Secrets: `TMDB_KEY`, `OMDB_KEY` (set on `ratingkino-sync` Worker, not Pages)

### KV Namespace — `MOVIES_CACHE`
- ID: `9b1ddd3fe25446c390304fd3a460606e`
- Keys: `popular` (100 movies), `new-releases` (~100), `random-pool` (500 lightweight), `last-sync` (timestamp)

---

## Pages Function Routes (`functions/api/[[path]].js`)

| Route | Method | Description |
|-------|--------|-------------|
| `GET /api/cache/popular` | GET | 100 pre-enriched popular movies from KV |
| `GET /api/cache/new-releases` | GET | Recent releases from KV |
| `GET /api/cache/random-pool` | GET | 500 lightweight movies for roulette |
| `GET /api/cache/status` | GET | Last sync timestamp + stats |
| `GET /api/geo-lang` | GET | Detect language from visitor's country (`request.cf.country`) |
| `POST /api/translate` | POST | Translate text via `@cf/meta/m2m100-1.2b`; body: `{text, targetLang}` |
| `POST /api/ai-search` | POST | Semantic search via `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; body: `{query}` |
| `GET /api/tmdb/*` | GET | Proxy to `api.themoviedb.org/3/*` (injects `TMDB_KEY`) |
| `GET /api/omdb` | GET | Proxy to `www.omdbapi.com` (injects `OMDB_KEY`) |

---

## PWA (Progressive Web App)

The site is fully installable as a PWA on all platforms.

### Architecture
- **`sw.js`** at origin root — registered in `<head>` with scope `/`
  - Navigation requests → network-first, cache fallback
  - Static assets (icons, fonts, manifest) → stale-while-revalidate
  - External API calls → network-only (never cached)
- **`assets/site.webmanifest`** — `display: "standalone"`, `start_url: "/"`
- **Apple meta tags** (required for iOS standalone mode):
  ```html
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="FindFilm">
  ```

### Install UX

**Mobile (≤768px) — `#mobileInstallBanner`**
- Full-width top banner above `<header>`, in document flow (not sticky)
- Dark glass aesthetic: `rgba(13,0,32,0.97)` + `backdrop-filter: blur(20px)` + purple gradient border
- iOS: banner appears after 1.2s; Install button opens `#iosPwaPrompt` (bottom-sheet with Share instructions)
- Android: banner appears on `beforeinstallprompt` event; Install button triggers native OS dialog
- X dismiss: collapses with max-height animation, saves `rk_install_banner_dismissed` timestamp
- **7-day cooldown**: banner stays hidden until 604,800,000ms after last dismiss
- Standalone guard: if already installed, banner never shows

**Desktop (>768px) — `#btnInstall` (header button)**
- Glassmorphism gradient-border button in header nav
- Gradient text ("Install App"), desktop only — icon-only was removed on mobile
- Android/Desktop: captured `beforeinstallprompt` stored in `_deferredInstallPrompt`
- iOS desktop: routes to iOS prompt (unlikely use case but handled)
- Hidden via `appinstalled` event

**iOS bottom-sheet — `#iosPwaPrompt`**
- Slide-up panel with step-by-step "Share → Add to Home Screen" instructions
- Auto-shows after 3.5s on iOS Safari (15-day cooldown: `rk_ios_pwa_dismissed`)
- Also triggered by: mobile banner Install button, header Install button
- `z-index: 10500` — above first-visit overlay (z:10000)
- `#pwa-debug` URL hash bypasses all guards, shows after 500ms (dev tool)

### Key JS functions
- `initIOSPrompt()` — sets up iOS bottom-sheet, auto-show timer
- `showIosPwaPrompt()` — global, called from banner + header button
- `initInstallButton()` — desktop header button; captures `_deferredInstallPrompt`
- `initMobileInstallBanner()` — mobile banner with 7-day cooldown logic
- `syncFiltersTop()` — measures header height, sets `filters-bar.style.top` dynamically

---

## i18n System

6 languages: **English, Español, Français, 中文, العربية, Українська**

- Geo-IP auto-detection via `/api/geo-lang` on first load
- Language stored in `localStorage['rk_lang']`
- All static strings use `data-i18n="key"` attributes; dynamic strings call `t('key')`
- `TRANSLATIONS` object embedded in `index.html` — no external JSON files
- Arabic sets `document.documentElement.dir = 'rtl'`; `[dir="rtl"]` CSS handles layout flip
- Movie description translation: `translateDesc(movieId, text, lang)` calls `/api/translate`
  - 3-tier cache: `Map` (in-memory) → `sessionStorage` (key: `rk_tr_{id}_{lang}`) → network

Key JS functions: `t(key, vars)`, `detectLang()`, `switchLang(lang)`, `applyTranslations()`, `toggleLangMenu(e)`, `translateDesc()`, `refreshDescTranslation(m)`

---

## Feed Architecture

Three horizontal scroll rows above the main grid:

| Row | Data source | Condition to show |
|-----|------------|-------------------|
| "Fresh Additions" | `GET /api/cache/new-releases` | Always |
| "Masterpieces" | `GET /api/cache/popular` filtered to avg ≥ 7.0 | Always |
| "For You" | KV popular, scored by taste profile | After 3+ interactions |

Taste profile stored in `localStorage['rk_taste_v1']`: `{ genres: {}, directors: {}, total: 0 }`.
`recordInteraction(m)` called on every `openMovie()`. `scoredForProfile(movies)` sorts by taste score.

---

## Movie Object Shape

```js
{
  id, title, titleOrig, year, genres, genre, country,
  director, actors, awards, desc, trailer,
  imdb,           // 0–10 float (OMDb imdbRating)
  rt,             // 0–100 int  (OMDb Rotten Tomatoes %)
  mc,             // 0–100 int  (OMDb Metascore)
  imdbV, rtV, mcV,// vote counts for weighted avg
  tmdbScore, tmdbVotes,
  poster, backdrop, imdbId,
  enriched,       // bool — has live OMDb data been fetched?
  fromKV,         // bool — came from KV cache (pre-enriched)
  grad, emoji, genreIds,
  watchProviders, // {flatrate:[{name,logo}], rent:[...], buy:[...]}
}
```

---

## Weighted Average Formula

```js
// All sources normalized to 0–10
srcs = [
  { v: imdb,      w: imdbVotes  || 1000 },
  { v: rt   / 10, w: rtVotes    || 1000 },
  { v: mc   / 10, w: mcVotes    || 1000 },
]
avg = Σ(v*w) / Σ(w)   → displayed as ★ X.X
```

---

## Key localStorage Keys

| Key | Contents |
|-----|---------|
| `rk_lang` | Current language code (`en`, `es`, `fr`, `zh`, `ar`, `uk`) |
| `rk_taste_v1` | Taste profile: `{genres:{}, directors:{}, total:0}` |
| `rk_filters_v1` | Last-used filter state |
| `rk_visited` | Set to `'1'` after first-visit overlay is dismissed |
| `rk_watchlist_v1` | AI Watchlist: array of movie objects |
| `rk_ios_pwa_dismissed` | Timestamp of last iOS PWA bottom-sheet dismiss (15-day cooldown) |
| `rk_install_banner_dismissed` | Timestamp of last mobile install banner dismiss (7-day cooldown) |

Session storage: `rk_tr_{movieId}_{lang}` — cached translated descriptions.

---

## CSS Color Palette

```css
--purple:      #7C3AED   /* primary brand, active states */
--purple-mid:  #5B21B6
--purple-dark: #2D0052
--orange:      #F97316   /* CTA, secondary accent */
--yellow:      #FBBF24   /* gradient end */
--bg:          #0D0020   /* page background */
--imdb:        #F5C518
--rt:          #FA320A
--mc:          #FFCC34
```

---

## Pending / Known Issues

- [ ] **AI description translation quality** — m2m100-1.2b is decent but not GPT-quality. Consider switching to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for translation if quality is unsatisfactory.
- [ ] **Chinese (ZH) translation** — m2m100 may struggle with simplified vs. traditional Chinese. Monitor user feedback.
- [ ] **For You row threshold** — currently shows after 3 interactions. May feel too slow on first visit. Consider lowering to 2.
- [ ] **Mobile RTL layout** — Arabic RTL tested on desktop; verify on mobile (375px) that filter bar and feed rows don't break.
- [ ] **OMDb rate limit** — free tier is 1000 req/day. Heavy live-browsing traffic will exhaust it. KV cache mitigates this for pre-loaded movies.
- [ ] **SEO** — `<meta name="description">`, Open Graph tags, and `<link rel="canonical">` are minimal. Expand before a marketing push.
- [ ] **Sync Worker monitoring** — no alerting if the nightly cron fails. Add a Cloudflare Worker Cron alert or check `/api/cache/status` in a health-check script.
- [ ] **`www.findfilm.ai` redirect** — verify Cloudflare Redirect Rule for `www` → apex is active.
- [ ] **Android install banner timing** — `beforeinstallprompt` only fires if the Service Worker is registered and the site meets installability criteria. If the event never fires (e.g. SW install failed), the banner never shows on Android. Monitor via DevTools → Application → Manifest.
- [ ] **Mobile reviews panel** — on very short viewports the iOS PWA bottom-sheet may clip. Consider reducing content or adding scroll within the sheet.
