# RatingKino — Handoff

---

## ⚡ Most Recent Session (2026-07-09) — "Starring" Row with Micro-Avatars

All commits on `main`. Deployed via manual `wrangler pages deploy` (no git-integration auto-deploy).

| Commit | Feature |
|--------|---------|
| `004cdb5` | **Top-2 cast micro-avatars in modal hero** — New `castPhotos` field (`[{name, photo}]`, top 2 cast members) populated alongside existing `actors` in `mergeMovieData()` (`index.html` ~L5147, frontend live-enrichment) and `enrichOne()` (`sync-worker.js` ~L276, nightly cron). Passthrough/default added to `fromTMDb()`, `fromDiscover()`, `fromCache()` (`index.html`) and `basicMovie()` (`sync-worker.js`) so un-enriched movies simply render nothing until populated. New `<div class="m-starring" id="mStarring">` in modal hero (`index.html` ~L3252), between `#aiMatchPill` and `.m-ratings-row`. Render logic inline at the top of `refreshModalDetails()` (`index.html` ~L6694): shows overlapping circular avatars (`<img>` when `profile_path` exists, else 2-letter initials fallback `<div class="m-starring-initials">`) + `"Starring: Name1, Name2"` label, single-line with ellipsis truncation; `display:none` (no reserved space) when `castPhotos` is empty, avoiding CLS. New i18n key `modal.starring` in all 6 languages. CSS: `.m-starring`, `.m-starring-avatars`, `.m-starring-avatar`, `.m-starring-initials`, `.m-starring-names` (base rules ~L872 + `@media (max-width:768px)` override ~L1814 with smaller avatars/gaps). Existing `actors` string array (used by the Details/Cast row) left untouched. |

---

## ⚡ Most Recent Session (2026-07-08) — Mobile Modal Overflow Fix + AI Match Reasons Restored

All commits on `main`. Deployed live via manual `wrangler pages deploy` (see **Deployment**
section below — this project has **no git-integration auto-deploy**, discovered this session).

| Commit | Feature |
|--------|---------|
| `8548c7c` | **Mobile modal overflow fix** — Root cause: `.m-body { display:grid }` gives its columns (`.m-left`/`.m-right`) an implicit `min-width:auto`, so wide descendants (long cast list, `.provider-chip` "Where to Watch" buttons, `.vpn-banner` text) forced the column wider than the viewport instead of wrapping; `.modal{overflow:hidden}` then silently clipped the overflow instead of showing a scrollbar. Fixed by adding `min-width:0` to `.m-left`/`.m-right` inside `@media (max-width:768px)` (`index.html` ~L1781-1782), plus `overflow-wrap/word-break:break-word` on `.meta-item span, .provider-chip span`. `.providers-row`/`.awards` already had `flex-wrap:wrap` and needed no changes once the parent stopped over-expanding. |
| `8548c7c` | **Restored AI "why recommended" labels on similar movies** — `loadSimilarMovies()` (`index.html` ~L6587) rewritten to build a light card-view object per TMDB recommendation (`poster`→full URL, `avg`→string, `genres`) and call the shared `renderMiniCard(card, { reason: matchInsight(m, raw), listName:'Similar', style })` helper instead of hand-rolling markup — restoring the heuristic (non-LLM) match-reason logic (`matchInsight()`/`calcMatchScore()`/`AIM_VIBES`, `index.html` ~L6398-6435, originally built for the retired vertical `.aim-list` UI) via the already-built-but-unused `.mini-card-reason` CSS component (static always-visible subtitle on mobile, hover tooltip on desktop). `renderMiniCard()` gained an optional `opts.style` param (backward-compatible) to preserve the staggered fade-in animation. |

---

## ⚡ Most Recent Session (2026-07-08) — Mobile Movie Modal Compact Redesign

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `535aa39` | **Compact mobile movie modal** — Mobile hero area (rating box, full-width trailer toggle, stacked watch-provider buttons, full-width Share/Watchlist) condensed to fit poster/title/rating/actions + start of trailer without scrolling. `_refreshStreamingCtAs()` (`index.html` ~6862) success path now emits `<span class="stream-on-lbl">` + provider `<a class="btn-stream">` wrapped in a new `<div class="stream-row">`, with visible label moved into `<span class="btn-stream-label">` and an `aria-label` added per link (a11y-safe when label is hidden on mobile). Loading/disabled fallback branches unchanged. New i18n key `stream.streamOn` ("Stream on:") added to all 6 languages (en/es/fr/zh/ar/uk). CSS — all scoped to `@media (max-width:768px)`, desktop untouched (`#streamingCtAs{display:contents}` at L912 passes new wrappers through as flex items of `.m-actions`): rating card (`.mr-score-card`) now single-line inline pill (`flex-direction:row`, smaller fonts, `.mr-breakdown` gets a left divider); `.btn-trailer`/`.btn-shr`/`.btn-wl-modal` become small `order:1-3` auto-width pills (34px height); `.stream-on-lbl` (order 4) + `.stream-row` (order 5, horizontally scrollable, `.btn-stream` 42×42px icon-only via `.stream-row .btn-stream` specificity override) replace the old full-width stacked provider buttons; `.btn-stream`/`.btn-stream-disabled` fallback (no providers / still loading) keeps full-width readable style. General spacing: `.m-backdrop` 110→90px, `.m-info-strip` padding/margin tightened, `.m-meta-col` padding-top 22→16px, `.m-left` padding-top 10→8px. |

---

## ⚡ Most Recent Session (2026-07-06) — Conversational Query Refinement Chips

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `c62a5da` | **Conversational query refinement (dynamic chips)** — Backend `handleAISearch()` now returns `suggestedRefinements` (3-4 short, 1-3 word follow-up tweaks e.g. "Darker tone", "More recent", tailored to the query + returned movies), sanitized/deduped/capped at 4 (30-char hard cap). API response now `{ ids, reasons, suggestedRefinements, message }`. Frontend `renderFollowUps(query, dynamicChips)` (pre-existing static keyword-pool function, `index.html` ~5872) now prefers AI-generated chips passed from `aiSearch()`, falling back to the static `_followUpPool()` heuristic only when the backend supplies none. Chip icon changed `↳`→`↺` on `.ai-sug-chip` to match new spec. Reused pre-existing `applyFollowUp()` click-to-search logic unchanged (appends chip to `_lastQuery`, re-triggers `aiSearch()`) — no new CSS needed, `.ai-sug-chip`/`.ai-suggestions` styling (bordered pill, hover lift, `chipFadeIn` animation) already existed from the earlier follow-up-chips feature. |

---

## ⚡ Most Recent Session (2026-07-06) — AI "Why Recommended" Match Reasons

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `e620a3e` | **AI "why recommended" match reasons** — Backend `handleAISearch()` (`functions/api/[[path]].js`) system/user prompts now ask the LLM for a personalized `reason` (max 10-15 words) per movie, returned as `{ results:[{id,reason}], message }` (backward-compat fallback to legacy `{ids:[...]}` shape). Parsing dedupes/validates ids against catalog, caps at 20, sanitizes `reason` (strips newlines, caps 140 chars). `max_tokens` 400→1600. API response now `{ ids, reasons, message }`. Frontend: new `_aiMatchReasons` Map (tmdbId → reason string), cleared alongside `_aiMatchScores` in `resetAllFilters()`, `clearAISearch()`, `applyFilters()`, and start of `aiSearch()`; populated in `aiSearch()` after `buildMatchScores()`. `renderCardHTML()` renders `.ai-why-reason` pill (✨ sparkle + italic text) under the title/meta row when a reason exists. CSS: `.ai-why-reason`, `.ai-why-spark`, `.ai-why-text` (2-line clamp), `@keyframes aiWhyFadeIn`. |

---

## ⚡ Most Recent Session (2026-07-06) — AI Loading Micro-copy + Rating Tooltip

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `4275155` | **AI loading micro-copy** — `getThinkingPhrases()` now returns 4 phrases (indices 0–3, dropped 4). English `ai.thinking.0-3` updated to: "Analyzing your prompt…" / "Scanning 240,000+ films…" / "Calculating unified ratings…" / "Finding the perfect matches…". Cycle interval `startThinkingText()`: 2600 → 1800ms. Fade CSS unchanged (`.ai-banner-text { transition: opacity 0.22s, transform 0.22s }` / `.fading { opacity:0; translateY(5px) }`). |
| `f5cb18a` | **Unified rating breakdown tooltip** — `#rtip.rtip` (`position:fixed` on `<body>`, escapes `.movie-card { overflow:hidden }`). Triggered by `onmouseenter`/`onmouseleave`/`ontouchstart` on `.rb.avg` badge. `avgBadgeHTML()` updated to inject `data-mid` + handlers. Functions: `showRatingTooltip(mid,el)`, `hideRatingTooltip()`, `toggleRatingTooltip(mid,el)`, `_buildRtipRows(m)`. Shows IMDb (yellow `#F5C518`), RT (red `#ff7055`), MC (green/amber/red by score), TMDB fallback (blue). Viewport-clamped + flip-below-if-no-room-above. Document click listener dismisses on outside tap (mobile). CSS: `.rtip`, `.rtip.show`, `.rtip-header`, `.rtip-row`, `.rtip-src`, `.rtip-imdb`, `.rtip-rt`, `.rtip-mc-good/mid/bad`, `.rtip-tmdb`, `.rtip-val`, `.rtip-denom`. `.rb.avg` gets `pointer-events:auto` to override `.poster-ratings { pointer-events:none }`. |

---

## ⚡ Most Recent Session (2026-07-05) — Mobile Modal UX + Project Memory

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `fda50d0` | **Project memory** — `CLAUDE.md` (auto-loaded every session, defines HANDOFF.md protocol). `.claude/settings.json` Stop hook: checks `last_handoff_commit != HEAD`, outputs reminder, self-terminates once HANDOFF.md is at HEAD. |
| `61fe1da` | **llms.txt** — AEO/GEO file at `https://findfilm.ai/llms.txt`. H1 + blockquote summary, feature bullets, data sources, limitations. Served as static file by Cloudflare Pages. |
| `61a0af1` | **Similar movies horizontal scroll** — `loadSimilarMovies()` rewritten: renders `mini-card` poster strip directly into `#similarScroll` (`.feed-scroll.m-similar-scroll`), replacing vertical `aim-list` inside `ai-matches-wrap`. `_SIM_SKEL` const for skeleton. `#similarLbl` now shown/hidden alongside scroll. `openMovie()` adds `.m-body?.scrollTo({top:0,behavior:'instant'})` after `populateModal()`. `.m-similar-scroll` CSS: removed `display:block;overflow-x:visible` overrides that defeated `.feed-scroll`. Mobile: `.trailer-wrap` → `aspect-ratio:16/9; padding-bottom:0; height:auto`. |
| `94bb0d6` | **Aggressive mobile hero compaction** — Hero section −130px on 375px phones; ABOUT now above fold. `.m-backdrop` 160→110px. `.m-info-strip` margin-top −52→−28px. `.m-poster` 80→66px. `.m-meta-col` padding-top 58→22px. `.m-title` 18→16px. Rating card: `.mr-avg-num` 36→24px, `.mr-hero-lbl` hidden, padding 6/9px. `.m-orig` margin 14→3px. `.m-ratings-row` margin 14→5px. Buttons reordered via CSS `order`: Trailer(1)\|Watchlist(2) row 1, Streaming(3) full-width row 2, Share(4) full-width row 3. `.m-actions` now `display:flex;flex-wrap:wrap;gap:6px`. |

---

## ⚡ Most Recent Session (2026-07-04) — Product Hunt Pre-Launch Polish

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `840cd31` | **Session continuity** — `saveSession()` / `restoreSession()` hook into `applyFilters()`, `toggleSrc()`, `clearAISearch()`, `init()`. Persists query/genre/country/rating/sort to `sessionStorage['ff_session']`. |
| `addfadb` | **NordVPN affiliate CTA** — `.btn-nordvpn` in `_refreshStreamingCtAs()` (all 3 branches). Affiliate URL: `https://go.nordvpn.net/aff_c?offer_id=15&aff_id=151623&url_id=902`. `vpn.nordvpn` i18n key in all 6 languages. Footer disclosure added. |
| `3cc2e62` | **Animated NLP placeholder** — `#searchPhOverlay` span (hides native `::placeholder`), `_cycleDeskPh()` cycles 4 strings with fade. `initDesktopPlaceholder()` starts the 3.8s interval. `.search-nlp-hint` bar below search. All 6 languages. |
| `d70b67d` | **Empty + error states** — `_showNoResultsState()`, `_showErrorState()`, `resetAllFilters()`, `retryLastFetch()`. HTML: `#emptyResetBtn`, `#emptyRetryBtn`. CSS: `.state-btn`, `.state-btn-retry`. `applyTranslations()` updated to re-apply correct i18n on lang change. |
| `a0c1629` | **Search suggestion pills** — `#searchSuggestions` glass dropdown on empty-input focus. `getSuggestions()`, `renderSuggestionPills()`, `showSuggestions()`, `hideSuggestions()`, `_applySuggestion()`, `initSearchSuggestions()`. Uses `mousedown` (not `click`) to fire before `blur`. Hidden on mobile. |
| `a8b2153` | **Mobile modal UX** — `.modal` becomes flex column (`overflow: hidden`) on ≤768 px. `.m-body` scrolls independently (`flex:1; overflow-y:auto; min-height:0`). `.m-close` already 44×44 px. Inline `.btn-nordvpn` hidden on mobile. New `<a class="m-nordvpn-footer" id="mNordvpnFooter">` sticky bottom bar: full-width, `min-height:44px`, bold, `box-shadow` above. Desktop: `display:none`. |
| `a5b6533` | **Search state machine + CLS fix** — `showSuggestions()` now guards `inp.value.length > 0 \|\| IS_LOADING \|\| AI_SEARCH_ACTIVE`. `_cycleDeskPh()` adds same fetch guards. Focus handler also checks `!IS_LOADING && !AI_SEARCH_ACTIVE`. CLS: `<div class="results-zone">` wraps `#movieGrid` + `#emptyState` (`min-height:60vh`); `.movie-grid:empty { min-height:0 }`. |

---

## Live Site

- **Production:** https://findfilm.ai (custom domain) — also https://ratingkino.com
- **Cloudflare Pages fallback:** https://ratingkino.pages.dev
- **Cloudflare account:** `e8eeb644ca96a2d4cb2a9674ea599e79`
- **Pages project:** `ratingkino`
- **GitHub repo:** https://github.com/Bashtan/ratingkino

---

## What This Is

Single-file movie discovery platform — one `index.html` (~7 500 lines) plus a Cloudflare Pages Function and a daily sync Worker. No build step, no framework, no dependencies.

Users browse movies fetched from KV (pre-enriched nightly) or live TMDB/OMDb, filter by genre/year, search with AI semantic search, open a modal with ratings + trailer + watch providers, and share deep links.

---

## File Structure

```
ratingkino/
├── index.html            ← entire site: CSS + JS + HTML (~7500 lines)
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

**IMPORTANT — no git integration.** `wrangler pages project list` confirms this Pages
project has `Git Provider: No`. `git push origin main` does **not** auto-deploy — it
only updates the GitHub repo. Confirmed 2026-07-08: the live site was ~1 week/several
sessions of commits stale until a manual deploy was run. **Every session that changes
`index.html` or `functions/` must end with a manual deploy, not just a git push.**

```bash
git push origin main                                          # updates GitHub only, does NOT deploy
npx wrangler pages deploy . --project-name ratingkino --branch main   # actually deploys to findfilm.ai
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

---

## Known Environment Quirk (Stop Hook)

Three **unrelated** preview servers trigger the verification stop-hook on every `index.html` edit:

| Server name | Port | Project |
|-------------|------|---------|
| `ratingkino` (misleading name) | 8181 | bakalo-site |
| `design-preview` | 4321 | starbook |
| `nextjs-dev` | 3000 | starbook |

**Workaround:** After each edit, run `preview_list` — confirm none are in `/Users/bashtan/Projects/ratingkino/` — then verify production with:
```bash
curl -sf https://findfilm.ai | grep -c "<landmark_string>"
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

## Key JS Functions Reference

| Function | Purpose |
|----------|---------|
| `loadMovies(page, append)` | Main paginated fetch; sets/clears `IS_LOADING`; calls `renderGrid()` |
| `aiSearch(query)` | AI semantic search; sets `AI_SEARCH_ACTIVE`; calls `renderGrid()` |
| `renderGrid(movies, append)` | Renders cards or calls `_showNoResultsState()`; removes `.show` from `#emptyState` |
| `showSkeletons(n)` | Fills grid with skeleton placeholders; hides empty state |
| `_refreshStreamingCtAs()` | Builds streaming provider buttons + NordVPN CTA inside `#streamingCtAs` |
| `applyTranslations()` | Walks DOM for `[data-i18n]`; re-renders suggestion pills on lang change |
| `saveSession()` / `restoreSession()` | Read/write `sessionStorage['ff_session']` |
| `showSuggestions()` | Guards: `inp.value.length > 0 \|\| IS_LOADING \|\| AI_SEARCH_ACTIVE` |
| `_cycleDeskPh()` | Pause: `inp.value \|\| IS_LOADING \|\| AI_SEARCH_ACTIVE` |
| `resetAllFilters()` | Clears all 5 filter dimensions + AI state + sessionStorage → `loadMovies(1,false)` |
| `retryLastFetch()` | Alias for `loadMovies(1, false)` |
| `_applySuggestion(text)` | Populates input, hides pills, triggers `aiSearch()` or `loadMovies()` |
| `initSearchSuggestions()` | Wires focus/input/mousedown; focus guard: `!inp.value && !IS_LOADING && !AI_SEARCH_ACTIVE` |
| `initDesktopPlaceholder()` | Sets first placeholder text; starts 3.8s `_cycleDeskPh` interval |
| `_showNoResultsState()` | Sets emptyState to 🍿 + no-results copy + reset CTA |
| `_showErrorState()` | Sets emptyState to ⚠️ + error copy + retry CTA; hides load spinner |

---

## CSS Architecture (selected additions from 2026-07-04)

```css
/* Results zone — prevents footer CLS */
.results-zone        { min-height: 60vh; }
.empty-state         { min-height: 60vh; display: none; flex-direction: column;
                       align-items: center; justify-content: center; }
.empty-state.show    { display: flex; }
.movie-grid:empty    { min-height: 0; }   /* zone owns the floor */

/* Animated search placeholder */
#searchInput::placeholder         { color: transparent; -webkit-text-fill-color: transparent; }
.search-ph-overlay                { position: absolute; left: 40px; right: 44px;
                                    opacity transitions on .ph-fading }
.search-wrap.typing .search-ph-overlay,
.search-wrap:focus-within .search-ph-overlay,
.search-wrap.ai-active .search-ph-overlay { opacity: 0; }

/* Search suggestions dropdown */
.search-suggestions               { position: absolute; glass effect; z-index: 200; }
.search-suggestions.ss-visible    { opacity: 1; pointer-events: auto; transform: translateY(0); }
.ss-pill                          { border-radius: 20px; purple-tinted }
@media (max-width: 768px) { .search-suggestions { display: none; } }

/* NordVPN — desktop inline vs mobile sticky footer */
.btn-nordvpn         { flex-basis: 100%; height: 36px; blue border #4687FF }
.m-nordvpn-footer    { display: none; }   /* hidden on desktop */
@media (max-width: 768px) {
  .btn-nordvpn       { display: none; }
  .m-nordvpn-footer  { display: flex; flex-shrink: 0; min-height: 44px;
                       font-weight: 700; box-shadow: 0 -4px 18px rgba(0,0,0,0.42); }
  /* Modal becomes scrollable flex column */
  .modal   { display: flex; flex-direction: column; overflow: hidden; max-height: 90vh; }
  .m-body  { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  .m-close { width: 44px; height: 44px; }
}
```

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

Session storage: `ff_session` (query/genre/country/rating/sort), `rk_tr_{movieId}_{lang}` (translated descriptions).

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

## PWA (Progressive Web App)

The site is fully installable as a PWA on all platforms.

### Architecture
- **`sw.js`** at origin root — registered in `<head>` with scope `/`
  - Navigation requests → network-first, cache fallback
  - Static assets (icons, fonts, manifest) → stale-while-revalidate
  - External API calls → network-only (never cached)
- **`assets/site.webmanifest`** — `display: "standalone"`, `start_url: "/"`

### Install UX

**Mobile (≤768px) — `#mobileInstallBanner`**
- Full-width top banner; iOS shows after 1.2s, Android on `beforeinstallprompt`
- 7-day cooldown: `rk_install_banner_dismissed`

**Desktop (>768px) — `#btnInstall` (header button)**
- Glassmorphism gradient-border button; captured `_deferredInstallPrompt`

**iOS bottom-sheet — `#iosPwaPrompt`**
- Slide-up panel, auto-shows after 3.5s; 15-day cooldown: `rk_ios_pwa_dismissed`
- `z-index: 10500`; `#pwa-debug` URL hash bypasses all guards

---

## Pending / Next Steps

- [ ] **Product Hunt listing** — confirm title, tagline, description, and gallery screenshots are ready
- [ ] **SEO** — `<meta name="description">`, Open Graph tags, `<link rel="canonical">` minimal — expand before marketing push
- [ ] **`www.findfilm.ai` redirect** — verify Cloudflare Redirect Rule for `www` → apex is active
- [ ] **Sync Worker monitoring** — no alerting if nightly cron fails; consider health-check script against `/api/cache/status`
- [ ] **AI description translation quality** — m2m100-1.2b; consider switching to llama-3.3-70b-instruct for translation
- [ ] **OMDb rate limit** — free tier 1000 req/day; monitor under traffic spike
- [ ] **For You row threshold** — shows after 3 interactions; consider lowering to 2
- [ ] **Mobile RTL layout** — Arabic RTL; verify on 375px that filter bar and feed rows are correct
- [ ] **Star hover state bug** — dual CSS + inline colour on review stars; can leave stuck state on rapid mouse exit (pre-existing)
- [ ] **Admin password on mobile modal** — client-side toggle only, no real auth
- [ ] **Cross-device watchlist** — currently localStorage only

---

## Suggested Skills for Next Session

- **`web-perf`** — run Lighthouse / Core Web Vitals audit; the CLS fix (`results-zone`) from this session should be measurable. Good to do before Product Hunt.
- **`cloudflare`** or **`wrangler`** — if touching Pages Functions, D1, KV, or deployment config.
- **`handoff`** — at end of next session to produce the next handoff doc (`/handoff`).
