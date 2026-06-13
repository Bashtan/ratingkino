# RatingKino — Handoff

## Live Site
- **Production:** https://ratingkino.com
- **Cloudflare Pages fallback:** https://ratingkino.pages.dev
- **Cloudflare account:** e8eeb644ca96a2d4cb2a9674ea599e79
- **Pages project:** `ratingkino`

---

## What This Is

Single-file static movie discovery platform. Users enter API keys once (stored in `localStorage`), the site fetches live data from TMDb and enriches each card with IMDb, Rotten Tomatoes, and Metacritic scores via OMDb.

**Stack:** Zero build, zero dependencies — one `index.html` (~1650 lines). Vanilla HTML/CSS/JS.

---

## File Structure

```
ratingkino/
├── index.html       ← entire site (CSS + JS + HTML, ~1650 lines)
├── HANDOFF.md       ← this file
└── .claude/
    └── launch.json  ← local dev server (python3 http.server, port 8282)
```

**Run locally:**
```bash
python3 -m http.server --directory /Users/bashtan/Projects/ratingkino 8282
# open http://localhost:8282
```

---

## APIs

| API | Key stored in | Purpose | Free tier |
|-----|--------------|---------|-----------|
| **TMDb** | `localStorage['rk_tmdb']` | Movie catalog, posters, trailers | Required — get at [themoviedb.org](https://www.themoviedb.org/settings/api) |
| **OMDb** | `localStorage['rk_omdb']` | IMDb rating, RT%, Metacritic score | Optional — 1000 req/day at [omdbapi.com](http://www.omdbapi.com/apikey.aspx) |

Settings modal auto-opens on first visit (no TMDb key). Both keys are saved per-browser in `localStorage` under `rk_tmdb` and `rk_omdb`.

---

## Key Code Locations (`index.html`)

| Concern | Line | Description |
|---------|------|-------------|
| CSS variables | ~13 | `--purple`, `--orange`, `--yellow`, `--bg`, `--imdb`, `--rt`, `--mc` |
| Sort buttons (HTML) | ~706 | IMDb / RT / Metacritic / Avg ★ |
| Hero subtitle | ~721 | "We aggregate scores from IMDb, Rotten Tomatoes, and Metacritic..." |
| Settings modal (HTML) | ~830 | TMDb key (required) + OMDb key (optional) |
| `CFG` object | ~869 | localStorage-backed API key getters/setters |
| API base URLs | ~876 | `TMDB_BASE`, `OMDB_BASE` |
| Enrichment queue | ~908 | `MAX_ENRICHERS = 3`, `ENRICH_QUEUE`, `ENRICH_PROMISES` |
| `fromTMDb(raw)` | ~1002 | Maps raw TMDb API response → internal movie object |
| `calcAvg(m)` | ~1041 | Weighted average of IMDb + RT/10 + MC/10, normalized to 0–10 |
| `doEnrich(tmdbId)` | ~1081 | Step 1: TMDb details (imdbId, director, cast, trailer) → Step 2: OMDb (IMDb+RT+MC) |
| `badgesHTML(m)` | ~1181 | Renders IMDb / RT / MC / Avg ★ badge HTML for cards |

---

## Architecture

### Data flow
1. **Page load** → check TMDb key → if missing, show settings modal
2. **`loadPage()`** → TMDb `/discover/movie` (or `/search/movie`) → renders skeleton cards
3. **Background enrichment** → `queueEnrich()` → `pumpEnrich()` → `doEnrich()` (max 3 concurrent)
4. **`doEnrich()`** → TMDb `/movie/{id}?append_to_response=credits,videos,external_ids` → then OMDb `/?i={imdbId}` → updates card in grid
5. **Modal open** → `enrichNow()` bypasses queue for immediate enrichment

### Movie object shape
```js
{
  id, title, titleOrig, year, genres, genre, country,
  director, actors, awards, desc, trailer,
  imdb,   // 0–10 float (from OMDb imdbRating)
  rt,     // 0–100 int  (from OMDb Ratings[Rotten Tomatoes])
  mc,     // 0–100 int  (from OMDb Metascore)
  imdbV, rtV, mcV,     // vote counts for weighted avg
  tmdbScore, tmdbVotes,
  poster, backdrop, imdbId,
  enriched, grad, emoji, genreIds
}
```

### Weighted average formula
```js
// All sources normalized to 0–10 before weighting
srcs = [
  { v: imdb,      w: imdbVotes  || 1000 },
  { v: rt   / 10, w: rtVotes    || 1000 },
  { v: mc   / 10, w: mcVotes    || 1000 },
]
avg = sumWV / totalW
```

---

## Color Palette

```css
--purple:      #7C3AED   /* primary brand, active states */
--purple-mid:  #5B21B6
--purple-dark: #2D0052
--orange:      #F97316   /* secondary accent, CTA buttons */
--orange-dark: #C2410C
--yellow:      #FBBF24   /* tertiary, gradient end */
--bg:          #0D0020   /* page background */
--imdb:        #F5C518   /* IMDb badge */
--rt:          #FA320A   /* Rotten Tomatoes badge */
--mc:          #FFCC34   /* Metacritic badge */
```

---

## Deployment

Deployed via Wrangler CLI to Cloudflare Pages:
```bash
npx wrangler pages deploy /Users/bashtan/Projects/ratingkino \
  --project-name ratingkino \
  --commit-dirty=true
```
DNS: two CNAMEs (`@` and `www`) → `ratingkino.pages.dev`, proxied through Cloudflare.

---

## Pending / Known Issues

- [ ] **`www.ratingkino.com`** — SSL cert still provisioning (was `pending` at handoff). Should auto-activate within an hour.
- [ ] **API keys are browser-local** — visitors on other devices need their own keys. Consider a Cloudflare Worker proxy to embed keys server-side.
- [ ] **OMDb rate limit** — free tier is 1000 req/day. Each movie enrichment = 1 request. Heavy traffic will exhaust this quickly.
- [ ] **No redirect `www` → root** — add a Cloudflare Redirect Rule for `www.ratingkino.com` → `ratingkino.com` once `www` is active.
- [ ] **SEO** — `<meta name="description">`, Open Graph tags, and `<link rel="canonical">` are missing.
- [ ] **Mobile layout** — filter bar wraps awkwardly on narrow screens; not tested below 375px.
- [ ] **Admin / key management** — no way to change API keys once set without opening Settings modal.
