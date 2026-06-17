# RatingKino — Handoff

## Live Site
- **Production:** https://ratingkino.com
- **Cloudflare Pages fallback:** https://ratingkino.pages.dev
- **Cloudflare account:** `e8eeb644ca96a2d4cb2a9674ea599e79`
- **Pages project:** `ratingkino`

---

## What This Is

Single-file movie discovery platform — one `index.html` (~3700 lines) plus a Cloudflare Pages Function and a daily sync Worker. No build step, no framework, no dependencies.

Users browse movies fetched from KV (pre-enriched nightly) or live TMDB/OMDb, filter by genre/year, search with AI semantic search, open a modal with ratings + trailer + watch providers, and share deep links.

---

## File Structure

```
ratingkino/
├── index.html            ← entire site: CSS + JS + HTML (~3700 lines)
├── functions/
│   └── api/[[path]].js   ← Cloudflare Pages Function (API proxy + KV reader + AI)
├── sync-worker.js        ← Cloudflare Worker — nightly data sync (deployed separately)
├── sync-worker.toml      ← wrangler config for sync Worker
├── wrangler.toml         ← wrangler config for Pages (KV + AI bindings)
├── assets/               ← static assets (posters cache, icons)
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

---

## Infrastructure

### Cloudflare Pages — `ratingkino`
- Deploys automatically on every push to `main`
- Serves `index.html` + runs `functions/api/[[path]].js`
- Bindings (wrangler.toml): `MOVIES_CACHE` (KV) + `AI` (Workers AI)
- Secrets (set via CLI): `TMDB_KEY`, `OMDB_KEY`

### Cloudflare Worker — `ratingkino-sync`
- Deployed separately: `npx wrangler deploy --config sync-worker.toml`
- Cron: `0 0 * * *`, `5 0 * * *`, `10 0 * * *` (3 phases, 00:00–00:10 UTC)
- Writes to `MOVIES_CACHE` KV: keys `popular`, `new-releases`, `random-pool`, `last-sync`
- Secrets: `TMDB_KEY`, `OMDB_KEY` (set on `ratingkino-sync` Worker, not Pages)

### KV Namespace — `MOVIES_CACHE`
- ID: `9b1ddd3fe25446c390304fd3a460606e`
- Keys: `popular` (100 movies), `new-releases` (~100), `random-pool` (500 lightweight), `last-sync` (timestamp)
- Populated nightly by `ratingkino-sync`; read by Pages Function at `/api/cache/*`

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

Session storage keys: `rk_tr_{movieId}_{lang}` — cached translated descriptions.

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

## Deployment Commands

```bash
# Pages deploys automatically on git push to main
git push origin main

# Manual Pages deploy (if needed)
npx wrangler pages deploy . --project-name ratingkino

# Deploy / update sync Worker
npx wrangler deploy --config sync-worker.toml

# Set secrets on Pages
npx wrangler pages secret put TMDB_KEY --project-name ratingkino
npx wrangler pages secret put OMDB_KEY --project-name ratingkino

# Set secrets on sync Worker
npx wrangler secret put TMDB_KEY --name ratingkino-sync
npx wrangler secret put OMDB_KEY --name ratingkino-sync

# Clean up old deployments (run after push, keep only the latest)
npx wrangler pages deployment list   # find old IDs
npx wrangler pages deployment delete <id> --project-name=ratingkino --force
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
- [ ] **`www.ratingkino.com` redirect** — add a Cloudflare Redirect Rule for `www` → apex if not already done.
