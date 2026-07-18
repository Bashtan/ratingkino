# RatingKino — Handoff

---

## ⚡ Most Recent Session (2026-07-18) — Compact Hero Trust Badge (Stats Condense)

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `e4d7de0` | **Condensed the hero stats/trust block into a single-line muted trust badge (frontend-only, `index.html`; no Tailwind — native CSS, Tailwind snippet handed to user).** Deployed `dadab867.ratingkino.pages.dev` → findfilm.ai. Replaced the old 4-line `.hero-band-copy` block — `.hero-title` (`#heroTitle`, big 900-weight "240,000 films. / 3 sources. 1 rating." with `.c-p`/`.c-o`/`.c-y` colored numerals) **plus** the `.hero-sub` explanatory paragraph (`data-i18n="hero.subtitle"`) — with one ultra-compact row: **`240K+ films • Unified AI Rating (IMDb, RT, Metacritic)`**. `#heroTitle` **kept** (JS rewrites it) but restyled: `.hero-title` now `font-weight:700`, `font-size:13px` (desktop) / 12/11.5/11px at the 768/430/375 breakpoints, `color:var(--muted)`, `display:inline-flex; flex-wrap:wrap` single line. Accents kept subtle: `.c-p` "240K+" purple (weight 800), `.c-o` "Unified AI Rating" orange; new `.ht-dot` (faint `rgba(148,163,184,.45)` bullet separator) + `.ht-src` (dim `rgba(148,163,184,.6)` "(IMDb, RT, Metacritic)"). `.hero-sub` element **removed** (its `hero.subtitle` i18n keys left in place, now unused/harmless). **JS:** both `#heroTitle` rewrite sites updated to emit the compact format — the language/`applyTranslations` path (~L5890, `240K+`/`150K+` + `t('hero.films')`/`t('hero.shows')` + `t('hero.unified')`) and `setContentType()` (~L6597/6599 Movies/TV branches). New EN i18n key `hero.unified`="Unified AI Rating" (other langs fall back via `t()`). `.how-ratings-link` ("How ratings work" micro-modal trigger) retained directly beneath. **Verified on preview:** desktop 1280 → 13px single line (18px tall); mobile 375 → 11px single line (15px tall, fits, no wrap); Movies↔TV toggle keeps compact copy ("240K+ films…"/"150K+ shows…"); `.hero-sub` gone; purple/orange accents confirmed; desktop + mobile screenshots show the tight above-the-fold hierarchy (feed rises higher). |

---

## ⚡ Session (2026-07-18) — Compact Utility Chips (Hero Discovery Row)

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `0a5a180` | **Refactored the hero `.hero-utils` utility row into a modern compact chip slider (frontend-only, `index.html`; no Tailwind — native CSS, Tailwind snippet handed to user).** Deployed `9bcf5d3f.ratingkino.pages.dev` → findfilm.ai. **(1) Dedup:** removed the **Voice** pill (`toggleDesktopVoice()` — mic already lives in `#searchMicBtn`) and **Watchlist** pill (`openWatchlist()` — bookmark already in header) from `.hero-utils`, leaving **3 discovery chips**: Pick for tonight (`openWizard()`), Choose with friends (`openGroupPicker()`), **Surprise me** (`.util-pill--accent` → `randomMovie()`, keeps `.rnd-spark`). Both removed handlers are still invoked elsewhere (search mic, header bookmark) so nothing breaks. Added `role="group" aria-label="Quick discovery actions"` on the row; chip SVG icons shrunk to 13–14px. **(2) Single scrollable row:** `.hero-utils` now `flex-wrap:nowrap` + `overflow-x:auto` + `-webkit-overflow-scrolling:touch` + `justify-content:safe center` (centers when the 3 chips fit, scrolls without left-clip when they overflow on narrow screens); **scrollbar fully hidden** (`scrollbar-width:none`, `-ms-overflow-style:none`, `.hero-utils::-webkit-scrollbar{display:none}`) — YouTube/Spotify chip-slider feel. **(3) Compact chip styling:** `.util-pill` → `flex-shrink:0` + `white-space:nowrap`, height 30px (was 36px), padding `0 12px` (was `0 15px`), border-radius 16px (was 20px), gap 6px, font 12px; `.util-pill--accent` neon gradient preserved. Mobile `@media(max-width:768px)`: `.hero-utils{gap:7px;justify-content:safe center}`, `.util-pill{height:29px;padding:0 11px;font-size:11.5px}`. `randomMovie()` (~L7916) spin selector `.util-pill--accent` unchanged. **Verified on preview:** exactly 3 chips render, `flex-nowrap`/`overflow-x:auto`/`scrollbar-width:none`/`safe center` computed; desktop (1280) row centered & fits (not overflowing), mobile (375) overflows to horizontal scroll with 0px scrollbar height (Surprise me peeks off the right edge); Surprise me retains accent; desktop + mobile screenshots. |

---

## ⚡ Session (2026-07-18) — iOS PWA Install UX (2-Stage Native-Look Flow)

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `dc0e1ba` | **Rebuilt the iOS "Add to Home Screen" install prompt into a friction-free 2-stage flow (frontend-only, `index.html`; no Tailwind — native CSS, Tailwind snippets handed to user).** Deployed `1c26b96e.ratingkino.pages.dev` → findfilm.ai. Replaced the old text-heavy bottom banner (`.ios-pwa-prompt` slide-up bar with `#iosPwaClose`/`#iosPwaSteps`/`.ios-pwa-desc` + per-browser `pwa.safariTip`/`pwa.chromeTip` instructions) with: **Stage 1 — native-look "fake OS alert":** centered `#iosPwaPrompt` card (+ new `#iosPwaBackdrop`) styled like an iOS system alert — 62px app icon (reused `#iosG` gradient SVG), headline `pwa.addToHome` ("Add **FindFilm.ai** to Home Screen", `data-i18n-html` so the `<span>` renders), one blue primary `#iosPwaAdd` (`pwa.addBtn` "Add"), tiny gray `#iosPwaNotNow` ("Not now"). **Stage 2 — text-free visual simulation:** new full-screen `#iosPwaSim` modal (`.ios-sim`) containing a CSS-only phone mock (`.ios-sim-phone`) that loops a 5s GPU-friendly animation (`@keyframes simTap`/`simSheet`/`simSharePulse`/`simRowHi`, all transform/opacity) — a tap ring (`.sim-tap`) presses the highlighted Safari **Share** icon (`.sim-share`), then the share sheet (`.sim-sheet`) slides up and the **Add to Home Screen** row (`.sim-row-add`) highlights; `prefers-reduced-motion` freezes it with the sheet open. **JS (near `showIosPwaPrompt` ~L10021):** `showIosPwaPrompt()`/`hideIosPwaPrompt()` now also toggle the backdrop; new `openIosSim()` (hides Stage 1, shows Stage 2), `closeIosSim()`, `dismissIosPwa(e)` (sets `rk_ios_pwa_dismissed`, 15-day cooldown). **Interactions wired via inline `onclick` in markup (NOT `addEventListener`)** — critical because the async **Skimlinks** affiliate script re-renders DOM (wraps the "FindFilm.ai" brand text) and was wiping listeners bound in `initIOSPrompt()`; inline handlers survive. `initIOSPrompt()` (~L10159) trimmed to guards + `data-browser` + cooldown + auto-show (`showIosPwaPrompt` after 3500ms; 500ms under `#pwa-debug`). ESC listener (~L9814) closes Stage 2 first, else Stage 1. Header `#btnInstall` + `#mobileInstallBanner` still call `showIosPwaPrompt` unchanged. **i18n:** added `pwa.addToHome`/`pwa.addBtn` to all 7 langs; removed now-dead `pwa.title`/`pwa.desc`/`pwa.chromeTip`/`pwa.safariTip`. **Verified on preview (`#pwa-debug`):** Add-button + whole-card tap → Stage 2 opens & Stage 1 hides; Not-now dismisses + sets cooldown (no Stage 2); backdrop/X/ESC close correctly; UK localization renders ("Додати FindFilm.ai на головний екран"); single `#iosPwaSim`/`#iosPwaPrompt`, no dup IDs; console clean (only static-preview TMDb 404 noise); screenshots of both stages (native alert + share-sheet simulation). |

---

## ⚡ Session (2026-07-15) — Trust Signals, Feed Hierarchy & SEO (UX Audit Part 2)

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `e87bc40` | **Rating transparency + feed hierarchy + SEO semantics (frontend-only, `index.html`; no Tailwind — native CSS, Tailwind snippets handed to user).** Deployed `e01dd88d.ratingkino.pages.dev` → findfilm.ai; live curl confirms `hero-h1`/"Start here tonight"/"Hidden Gems"/"How ratings work" + `/api/cache/status` returns a real `timestamp`. **(1) Rating transparency — "How ratings work" micro-modal:** new `.how-ratings-link` (ⓘ pill) in the `.hero-band` opens `#ratingsInfoModal` (+ `#ratingsInfoBackdrop`) via `openRatingsInfo()`/`closeRatingsInfo()` (added after `updateFilterCount` ~L8236). Modal explains the IMDb+RT+Metacritic blend with two tiers — `.ri-dot-full` "Full Critic Data" (green) / `.ri-dot-early` "Early Metadata" (gray, "newer titles may temporarily show TMDB-only scores until full reviews drop"). ESC listener (~L9670) extended to close it. **Catalog-freshness stamp:** `loadCatalogFreshness()` (fire-and-forget in `init()` ~L10230) fetches `/api/cache/status` (KV `last-sync`), parses `.timestamp`, renders `↻ {relative}` in `#heroUpdated` (hero band) + fills `#riUpdated` in the modal via `relativeUpdated(d)` (mins/hrs/days/date buckets). CSS `.ri-backdrop`/`.ri-modal`/`.ri-head`/`.ri-title`/`.ri-close`/`.ri-body`/`.ri-tiers`/`.ri-tier`/`.ri-dot*`/`.ri-updated` after `.sbadge.mc` (~L738); `.how-ratings-link`/`.hero-updated` after `.hero-sub`. **(2) Feed hierarchy — dominant primary row + rename:** top row `#rowForYou` renamed **"🌙 Start here tonight"** (i18n `feed.forYou` EN updated; applyTranslations L5629 sets it) and given class `.feed-row--primary` (framed purple gradient band, 18px gradient-clip title, 158px cards) so it dominates. Middle row `#rowPopular` renamed **"💎 Hidden Gems"** (`feed.hiddenGems`): removed old `#rowPopularTitle` dynamic "🧠 AI Curated: {theme}" title; the daily `CURATED_THEMES[dayIdx].label` now shows in a `#rowPopularTheme` badge (set in `loadFeedSections` ~L6270). Visual order = Start here tonight → Best Available Now → Hidden Gems → Fresh Additions. **(3) SEO semantics:** added one `<h1 class="hero-h1" data-i18n="hero.h1">FindFilm — AI Movie Assistant & Unified Ratings</h1>` in the hero band (kept `#heroTitle` "240,000 films…" as the JS-driven tagline below it); all four feed-row titles converted `<span>`→`<h2 class="feed-row-title">` (added `margin:0` reset); `hero.subtitle` EN rewritten to a stronger value-prop paragraph. New i18n EN keys: `hero.h1`, `ratings.howLink/title/body1/tierFull/tierEarly/updated/updatedMins/updatedHrs/updatedDays`, `feed.best/bestBadge/hiddenGems` (other langs fall back to EN via `t()`). `ratings.body1/tierFull/tierEarly` use `data-i18n-html` (contain `<strong>`). **Verified on preview:** exactly 1 `<h1>`, 4 feed `<h2>`s in order, `.feed-row--primary` on rowForYou, modal opens/closes (ESC + backdrop + X) with `<strong>` rendered + 2 tiers, seeded-card screenshot shows the framed dominant "Start here tonight" vs plain "Best Available Now". |

---

## ⚡ Session (2026-07-15) — Hero Declutter & UI Hierarchy (UX Polish)

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `8d11f28` | **Above-the-fold declutter — dominant search, utility row, filters drawer (frontend-only, `index.html`; no Tailwind — native CSS, Tailwind snippets handed to user).** Deployed `ccb45174.ratingkino.pages.dev` → findfilm.ai. **(1) Slim sticky header:** removed the inline `#searchWrap`, `.btn-tonight`, `.btn-group`, `.btn-random` from `.header-inner`; header now = logo · spacer · `.btn-search-toggle` (search icon) · `#btnInstall` · `.btn-watchlist` · `.lang-switch`. Made `.btn-search-toggle` visible at base (`display:flex`, 40px, was `display:none`). Deleted orphaned `.btn-random`/`.btn-tonight`/`.btn-group` CSS + `@keyframes randomShimmer`/`aiAuraPulse` (~L423-482); kept `@keyframes randomSpin`, now applied via `.util-pill--accent.spinning .rnd-spark`. **(2) New hero band** `<section class="hero-search" id="heroSearch">` inserted right after `</header>` (scrolls away with page): `.hero-eyebrow` microcopy ("✨ Try AI search — describe any movie, mood, or plot"), the relocated `#searchWrap` **intact** (all inner IDs unchanged: `#searchInput`/`#aiIcon`/`#searchPhOverlay`/`.search-icon`/`#searchMicBtn`/`#searchNlpHint`/`#searchSuggestions`) enlarged via `.search-wrap--hero` (56px input), and `.hero-utils` row of 5 `.util-pill`s → Voice (`toggleDesktopVoice()`), Pick for tonight (`openWizard()`), Choose with friends (`openGroupPicker()`), **Surprise me** (`.util-pill--accent` → `randomMovie()`), Watchlist (`openWatchlist()`). `randomMovie()` (~L7703) spin selector updated `.btn-random`→`.util-pill--accent`. **(3) Filters bar slimmed** to `.ct-toggle` (Movies/TV `#ctMovies`/`#ctTV` inline) + `<button class="btn-filters" onclick="openFilters()">` with live badge `<span class="filters-count" id="filtersCount">`. **(4) Filters drawer** (mirrors watchlist `.wl-*` pattern) — `#filtersBackdrop` + `<aside class="filters-drawer" id="filtersDrawer">` (right slide-out, `translateX(110%)`→`.open` `translateX(0)`); `.fd-header`/`.fd-body`/`.fd-footer`; body holds the **moved** `#genrePills`, `#fCountry`, `#fMinRating`, sort buttons `#btnIMD/#btnRT/#btnMC/#btnAVG` (all IDs preserved → `loadGenres`/`setGenre`/`setContentType`/`toggleSrc`/`applyFilters` unchanged); footer `.fd-reset` (`resetAllFilters()`+`updateFilterCount()`) / `.fd-apply` (`closeFilters()`). **(5) New JS** (after `closeWatchlist` ~L8036): `openFilters()`/`closeFilters()` (`.open` toggle + guarded body scroll-lock, only restores overflow if movie `#overlay` not open), `updateFilterCount()` (counts `ACTIVE_GENRE`, `#fCountry`, `#fMinRating`, `SORT_SRC`; toggles `.filters-count.on`) — called inside `setGenre`/`setContentType`/`toggleSrc`/`applyFilters`; ESC listener (~L9452) extended to close the drawer; `toggleSearch()` desktop branch repointed to `window.scrollTo({top:0,behavior:'smooth'})` + focus `#searchInput`. **(6) i18n EN** (fallback covers other langs): `btn.random`→"Surprise me", `tonight.launch`→"Pick for tonight", `group.launch`→"Choose with friends"; new keys `util.voice`/`util.watchlist`/`hero.eyebrow`/`filter.filters`/`filter.genre`/`filter.reset`/`filter.showResults`. **(7) CSS** added before `/* FILTER BAR */`: `.hero-search`/`.hero-eyebrow`/`.search-wrap--hero`/`.hero-utils`/`.util-pill`(+`--accent`)/`.btn-filters`/`.filters-count`/`.filters-backdrop`/`.filters-drawer`/`.fd-*`; 768px mobile block rewritten (dead search/tonight/group/filter-row-2 rules removed; hero-utils wraps, drawer `width:min(400px,92vw)`). **Verified on preview:** DOM (1× `#searchInput` in hero, 5 util-pills, drawer holds all 4 sort btns + country + min-rating), drawer open/close + body-lock + count badge (RT persisted sort → shows "1"), all handlers resolve, desktop + mobile 375 screenshots (drawer near-full-width on mobile). |

---

## ⚡ Session (2026-07-15) — Trust Signals & UX Clarity (Stage 2 Final Polish)

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `421993f` | **Three trust/clarity polish features on the vanilla stack (`index.html` only; no Tailwind — implemented natively, Tailwind snippets handed to user separately). Deployed `71f6b127.ratingkino.pages.dev` → findfilm.ai; live curl confirms `confidenceBadgeHTML`/`conf-full`/`conf-early`/`has-tip`/`mcr-spark`/tooltip strings present.** **(1) Confidence badges (data-quality signal on cards + modal):** new helper `confidenceBadgeHTML(m)` (index.html ~L6527, just before `avgBadgeHTML`) returns a pill — `✓ Full Critic Data` (`.conf-full`, green) when `imdb\|rt\|mc > 0`; else `TMDB Rated` (`.conf-tmdb`, cyan) when `tmdbVotes >= FEED_QUALITY.minVotes` (60); else `Early Metadata` (`.conf-early`, gray). Each has a `title=` tooltip explaining the tier. Wired into `renderCardHTML()` movie-info block (after `.movie-meta`, before `whyReasonHTML`) and into `refreshModalRatings()` (appended as `<div class="mr-conf">` inside the populated `.mr-score-card`). CSS `.conf-badge`/`.conf-full`/`.conf-tmdb`/`.conf-early`/`.mr-conf` after the `.cr.mc-*` rules (~L778). **(2) Pure-CSS nav tooltips (zero JS):** `.has-tip` class + `data-tip` attr on the two header CTAs — `.btn-tonight` → "Find a movie for right now", `.btn-group` → "Pick a movie with friends" (markup ~L3393-3400). CSS `.has-tip{position:relative}` + `::after` (pill: dark `rgba(13,0,32,.97)` bg, violet border, Montserrat 10.5px) + `::before` (caret) shown on `:hover`/`:focus-visible`, after `.btn-group:hover` (~L482); `prefers-reduced-motion` guard. **(3) For You explanation sparkle:** the reason label already existed (`renderMiniCard` `opts.reason` → `.mini-card-reason`, fed by `genRecommendReason()` — only used by `renderForYouRow()`); added a `<span class="mcr-spark">✨</span>` prefix (index.html:5974) + `.mcr-spark` CSS (after `.mini-card:hover .mini-card-reason` ~L2529) so labels like "Fan of Nolan"/"Top Action Pick"/"90s Thriller" read as AI match explanations. **Verified on preview:** `confidenceBadgeHTML` returns conf-full (critic), conf-tmdb (120 votes), conf-early (12 votes / zero) with correct labels; demo `renderCardHTML` card shows green "✓ FULL CRITIC DATA" pill; tooltip `::after` resolves `content:"Find a movie for right now"` + `opacity:1` on hover (screenshotted); `renderMiniCard` output contains `mcr-spark`; console clean (only expected static-preview TMDb 404 noise). **Tailwind deliverable snippets** for badge/tooltip/reason handed to user. No backend/D1/sync-worker changes. |

---

## ⚡ Session (2026-07-15) — UI Polish: Neon Share Button + Cinematic Loader

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `15494ef` | **Two visual upgrades on the vanilla-CSS stack (`index.html` only; project has no Tailwind — implemented natively, Tailwind snippets handed to user separately).** **(1) Charismatic Share button (`.btn-shr`, CSS ~L1244, markup L3699 `<button class="btn-shr" onclick="openShare()">`):** replaced the muted purple-outline pill (the core viral-loop CTA that was blending in) with a neon "AI action" — `linear-gradient(120deg,#22d3ee,#7c3aed,#d946ef)` (cyan→violet→magenta) w/ `background-size:200% 200%`, near-black text `#0b0713` for contrast, uppercase Montserrat 800. **Always-on** `@keyframes shrGlow` (breathing dual cyan+magenta `box-shadow`) + `shrFlow` (gradient drift) + `shrSheen` (light-sweep via `::before`). **Hover** = `transform:scale(1.06)` + `filter:brightness(1.08) saturate(1.15)` — deliberately on `filter` (not box-shadow) so it never clashes with the breathing animation's box-shadow. Adds `:active` scale-down, `:focus-visible` cyan ring, `@media (prefers-reduced-motion)` guard (static glow), and touch override (`@media (hover:none)` ~L2075 now `transform:none;filter:none` to keep the gradient, not the old flat purple). **(2) Cinematic loader (replaces plain-text spinners):** new JS helper `cineLoaderHTML(label)` (before `renderWizard()` ~L8543) returns a glowing SVG **film reel** (ring + hub + 6 spoke-holes, `url(#cineGrad)` cyan→purple, dual `drop-shadow`) that spins via `@keyframes cineSpin` (2.6s linear) above a **flickering** neon caption (`@keyframes cineFlicker` — film-gate opacity dip + cyan/purple `text-shadow`); `role="status" aria-live="polite"`, label `esc()`-escaped (XSS-safe against i18n). CSS `.cine-loader`/`.cine-reel`/`.cine-text` after `.wiz-loading` (~L918) + `prefers-reduced-motion` guard. Wired into `runWizard()` (~L8565, "Finding your perfect picks…" `wiz.loading`) and `runGroupPicker()` (~L8703, "Finding the perfect overlap…" `group.loading`), replacing `<div class="wiz-loading">`/`<div class="group-loading">` text. SVG+CSS only, no external assets. Old `.wiz-loading`/`.group-loading` rules kept (still used for empty/`needTwo` text states). **Verified on preview:** computed styles (gradient/color/box-shadow/animation-name), both button states + loader screenshotted, `hasSvgCircles:8`, label HTML-escaping, no console errors. **Deployed** (`627b3cd1.ratingkino.pages.dev` → findfilm.ai); live curl confirms `shrGlow`/`shrSheen`/`cineLoaderHTML`/`cine-reel`/`@keyframes cineSpin` present. **Punchier caption alts offered (not applied):** "Rolling the reels…" / "Rolling cameras…" / "Now screening your matches…". |

---

## ⚡ Session (2026-07-14) — Feed Quality Gate: "Best Available Now" vs "Fresh Additions"

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `1acb2d9` | **Feed ranking upgrade — filter "thin" metadata + split quality vs recency (frontend-only, `index.html`).** Problem: the homepage mixed freshness with quality; new low-vote titles cluttered "For You" and weakened trust in AI curation. **Data reality:** all 119 `/api/cache/new-releases` movies have `imdb/rt/mc = null` (sync-worker deliberately skips OMDb), 99/119 have <100 TMDB votes (median 19) — so a literal "exclude if `critic_score` null" would empty the feed. Chose a **confidence heuristic** using signals we have. **(1) Modular quality helpers** (after `scoredForProfile()` ~L5709): tunable `const FEED_QUALITY = {minVotes:60, minScore:6.0, requireDirector:true, priorVotes:60, priorMean:6.3}`; `isThinRecord(m,cfg)` → thin if blank director, OR (no critic data AND (`tmdbVotes<minVotes` OR `tmdbScore<minScore`)); real `imdb/rt/mc>0` always trusted (critic data is a **bonus, not a gate**); `qualityScore(m,cfg)` → critic-avg-or-tmdbScore base, Bayesian vote-confidence damping `conf=votes/(votes+priorVotes)` toward `priorMean`, `+0.5` critic bonus. **(2) Preserve confidence fields:** `fromKV()` (~L5872) + `fromDiscover()` (~L5895) now carry `tmdbScore`/`tmdbVotes` (previously dropped) so the client can judge confidence; display unchanged. **(3) New row + reorder:** added `#rowBest`/`#scrollBest` ("🏅 Best Available Now" + "Certified by ratings & votes" badge, hardcoded English like other feed titles); DOM order now **`#rowForYou` → `#rowBest` → `#rowPopular` (AI Curated) → `#rowFresh`**. **(4) `loadFeedSections()` refactor (~L6009) pool-first:** fetch fresh (KV→`fromKV`) + curated (TMDB discover→`fromDiscover`) via `Promise.allSettled`, build `window._FEED_POOL=[...fresh,...curated]` deduped **first**, then render in priority order each honoring `renderedMovieIds`: **For You** (`renderForYouRow()`) → **Best** = `fresh.filter(!isThinRecord).filter(!dup).sort(qualityScore desc).slice(0,20)` rendered with visible score (`avg: tmdbScore.toFixed(1)`) → **AI Curated** = themed discover `slice(0,20)` (independent source, untouched) → **Fresh** = `[...fresh].sort(year desc)` thin-allowed, `{showNew:true}` NEW badge. Each success branch now resets `row.style.display=''` (fixes a row staying hidden after a prior empty/failed load). **(5) For You strict-filter:** `renderForYouRow()` (~L5995) adds `.filter(m => !isThinRecord(m))`. Rationale: newest 2026 titles are low-vote (thin) so they naturally stay in **Fresh**, higher-confidence titles surface in **Best** — clean split, no duplicate cards. **Verified on preview:** helper edge cases (blank dir→thin, votes<60 no-critic→thin, votes≥60+score≥6→not-thin, weak score→thin, any critic→not-thin), `qualityScore` ranks 800-vote/7.5 above 5-vote/8.0 (damping works), DOM order `rowForYou,rowBest,rowPopular,rowFresh`, mock render → Best=[high-conf ids], Fresh=[thin ids w/ NEW], AI-Curated dedups a duplicate id out, **zero cross-row dupes**, all rows `display:block`, Best card shows "★ 7.8". **Against live 119-movie cache:** 25 pass `!isThinRecord` (Best non-empty but meaningfully smaller); tunability confirmed — `minVotes:200` drops passable to 12 (one-line threshold change shifts Best/Fresh membership). **Deployed** `npx wrangler pages deploy` → live; curl confirms `#rowBest`/"Best Available Now"×5 + `isThinRecord`/`qualityScore`/`FEED_QUALITY` present. No backend/D1/sync-worker changes. |

---

## ⚡ Session (2026-07-14) — Stage 2 Pass 2: "Movie Pitch" (Shared Voting + Discussion, Cloudflare D1)

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `81136b5` | **Stage 2 Pass 2 — "Movie Pitch": the first persistent, cross-device social feature.** Turn any movie into a shareable `/pitch/:id` link where friends vote 👍/🤷/👎 (live tallies) and leave comments. Introduces **Cloudflare D1** (`findfilm-pitch`, binding `DB`) + ~3s polling (no WebSockets). **Infra:** `schema.sql` (new) — 3 tables `pitches(id PK 8-char base62, movie_id, title, year, poster, created_at)` / `votes(pitch_id, voter, vote CHECK yes\|maybe\|no, created_at, PK(pitch_id,voter))` / `comments(id AUTOINC, pitch_id, name, body, created_at)` + `idx_votes_pitch`/`idx_comments_pitch`; created via `npx wrangler d1 create findfilm-pitch` + applied `--remote --file=schema.sql`; `wrangler.toml` adds `[[d1_databases]] binding="DB" database_name="findfilm-pitch" database_id="261cc44d-36e9-4913-a1c9-b61e1aed949e"`. **Backend (`functions/api/[[path]].js`):** route dispatch after `/fit-summary` — `POST /pitch → handlePitchCreate`, `/pitch/* → handlePitchSub(rest,…)`. Handlers at EOF, all D1 via parameterized `.bind()` (never interpolate), each with local `pitchJson()`: `genPitchId(8)` (base62 via `crypto.getRandomValues`); `handlePitchCreate` (validates `movieId` int + `title`≤200, `INSERT OR IGNORE` with retry-once on PK collision, returns `{id}`, guard `if(!env.DB) 503`); `handlePitchSub` (validates id `/^[A-Za-z0-9]+$/` sliced 16; GET→`pitchGet`, POST `/vote`→`pitchVote`, POST `/comment`→`pitchComment`, else 404); `pitchTallies(id,env)` (`GROUP BY vote` → `{yes,maybe,no,total}`); `pitchGet` (SELECT pitch or 404 "Pitch not found", tallies, comments `LIMIT 200 DESC` → `{id,movie:{movieId,title,year,poster},votes,comments}`); `pitchVote` (voter≤64 + vote∈yes/maybe/no, verify pitch exists, **upsert** `ON CONFLICT(pitch_id,voter) DO UPDATE` → one vote/person, returns fresh tallies); `pitchComment` (name≤40 default "Guest", body≤500 required + control-char strip, cap 200/pitch→429, returns `{ok:true,comment}`). **Pitch page (`pitch/index.html`, new standalone, clones `/tv/` shell — dark, blurred `#bg`, `noindex`, English-only, self-contained CSS+JS IIFE):** `getPitchId()` (`/\/pitch\/([A-Za-z0-9]+)/`), anon voter `localStorage ff_pitch_voter` (`crypto.randomUUID`), remembered choice `ff_pitch_vote_<id>`; `init()` GET `/api/pitch/:id` → `renderMovie` (poster via `posterUrl(p,size)` handling TMDB-path-or-full-URL, blurred backdrop), parallel `loadTrailer` (TMDB `videos` → YouTube click-to-play thumb `#playThumb`/`playTrailer()` injects autoplay iframe) + `loadFit` (POST `/api/fit-summary` → `#fitBlock` 3 rows, hidden on error); vote bar `#voteBlock` (3 `.vote-btn[data-v]` w/ `#cntYes/#cntMaybe/#cntNo`, `.sel` highlight), `window.vote()` optimistic + persist; comments `#cmtList` + `window.sendComment()` (name `ff_pitch_name`); `poll()` every 3000ms re-renders tallies + merges comments (only re-renders list when count changes), **paused on `document.hidden`** via `visibilitychange` + immediate poll on resume; `esc()` escapes all user strings. **Routing:** `_redirects` adds `/pitch/*  /pitch/  200` (mirrors `/tv`; static assets under `/pitch/` take precedence). **Entry point (`index.html`):** `#sharePitch` button in `#sharePanel` after `#shareCast` (violet accent `.share-pitch`, two-line label + spinner + `.loading`/`.copied` states, reset in `openShare()`); `pitchToFriends()` (after `copyLink()` ~L9093) guards `ACTIVE_MOVIE`, POST `/api/pitch {movieId,title,year,poster}`, builds `${location.origin}/pitch/${id}`, copies via clipboard (legacyCopy fallback), swaps button to "✓ Link copied — send it!"; i18n ×6 langs `share.pitch`/`pitchSub`/`pitchCopied`/`pitchFail`. **Verified:** D1 remote lists 3 tables; **live curl** (findfilm.ai/api/pitch) — create `{id}`, GET fresh `votes:{0}`+`comments:[]`, vote yes→`yes:1`, same voter no→`no:1` (upsert, no double-count), 2nd voter maybe→`total:2`, comment persists, bogus id→404; live `/pitch/:id` serves page (200, noindex, all element IDs, title "FindFilm.ai — Movie Pitch"); preview confirms `pitch/index.html` JS parses clean (`window.vote/sendComment/playTrailer` defined) + main app `pitchToFriends`/`#sharePitch`/`t('share.pitch')` all present, no SyntaxError. ⚠️ Browser MCP was disconnected this session → interactive click/poll verification deferred (logic mirrors proven `/tv` pattern + curl covers the API path). ⚠️ If `DB` binding fails to attach via `wrangler.toml` on future deploys, bind in Cloudflare **Pages → Settings → Functions → D1 bindings** (`DB`→`findfilm-pitch`). |

---

## ⚡ Session (2026-07-14) — Stage 2 Pass 1: Onboarding Quiz, Group Picker, Spoiler-Free Fit Summary

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `09eb6a0` | **Stage 2 "Retention & Social" Pass 1 — three no-database features on the existing vanilla stack (`index.html` + `functions/api/[[path]].js` + KV `MOVIES_CACHE` + Workers AI llama-3.3-70b). Reuses the `.wiz-overlay`/`.wiz-modal` modal pattern and the `rk_taste_v1` taste profile.** **(A) Taste Onboarding Quiz (cold-start):** 5-question single-choice quiz seeds the taste profile on first visit so "For You" lights up immediately. `ONBOARD_QUESTIONS` (pace/ending/realism/tone/era — each option carries a `genres:{}` weight map using TMDB genre names incl. 'Science Fiction'), state `ONBOARD_STATE`/`ONBOARD_STEP`. Overlay `#onboardQuizOverlay .onboard-quiz-overlay` w/ `#onboardProgress` dots + `#onboardBody`. Fns (all after `runGroupPicker`, ~L8618): `startOnboardFromIntro`/`openOnboardQuiz`/`closeOnboardQuiz`/`onboardOverlayClick`/`onboardSelect(qKey,optKey)` (auto-advance)/`onboardGoStep`/`_onboardProgressHTML`/`renderOnboardQuiz`/`finishOnboardQuiz`/`finishOnboardDone`. `finishOnboardQuiz()` writes `p.prefs={pace,ending,realism,tone,era}` + seeds `p.genres` weights + bumps `p.total` past `TASTE_THRESHOLD`, sets `localStorage.rk_onboard_quiz_done='1'`, renders "All set!" done step (`.onboard-done`) with disabled Letterboxd "coming soon" row (`.onboard-lb`) + gradient `.onboard-finish` button. **`getTasteProfile()` extended** with non-breaking `prefs:{}` default (+ full genres/directors/total validation). Trigger: first-visit intro CTA replaced with `.fv-cta` "Personalize in 30s" (`onclick="startOnboardFromIntro()"`) + `.fv-skip-link` "Skip — just browse". Re-entry: `.foryou-refine` chip in the For You row header (`onclick="openOnboardQuiz()"`). **(B) Group Picker (taste overlap):** input 2–5 people's tastes as free text → LLM finds the catalog intersection. Backend **`POST /api/group-picker`** → `handleGroupPicker(request,env,cors)` (`[[path]].js` ~L1067): sanitizes `body.people` (2–5 strings ≤120 chars), loads `new-releases` catalog, llama-3.3-70b (temp 0.2, max_tokens 1400) system="group movie-night matchmaker … maximize *shared* appeal", parses `{results:[{id,overlap,appeals}], groupSummary}`, validates ids against catalog, caps 6, returns `{ ids, reasons(=overlap text), appeals(=person labels), groupSummary, message }`. Frontend: header `.btn-group` (cyan, users-group SVG, `onclick="openGroupPicker()"`, mobile icon-only) after `.btn-tonight`; overlay `#groupOverlay .group-overlay` → `#groupBody`; state `GROUP_PEOPLE=['','']`; fns `openGroupPicker`/`closeGroupPicker`/`groupOverlayClick`/`_syncGroupInputs`/`addGroupPerson`(max 5)/`removeGroupPerson`(min 2)/`renderGroupInputs`/`runGroupPicker` (~L8446). `runGroupPicker()`: `_syncGroupInputs()`, needs ≥2 (else `t('group.needTwo')`), POST → resolves `data.ids` against **`CACHE_MOVIES`** (wizard pattern), pushes picks into `MOVIES`, maps `data.reasons`→`_aiMatchReasons`/`data.appeals`→`_aiMatchTags`, renders `.group-summary` header + `renderCardHTML()` cards into `.group-results` (3-col, 1-col mobile). CSS: `.group-modal`/`.group-people`/`.group-person`/`.group-add`(dashed cyan)/`.group-find`(cyan gradient)/`.group-summary`/`.group-restart`. **(C) Spoiler-Free Fit Summary (movie modal):** on-demand LLM block "For you / Skip if / The experience", KV-cached, visually distinct from synopsis. Backend **`POST /api/fit-summary`** → `handleFitSummary(request,env,cors,waitUntil)` (~L1205): body `{id,title,year,genres,overview}` (client sends what it has → no TMDB subrequest); KV cache `fit:{id}` in `MOVIES_CACHE` → returns `{...data,cached:true}` on hit; miss → llama-3.3-70b (temp 0.3, max_tokens 350, "NEVER reveal plot twists/fates/ending"), parses `{forYou,skipIf,experience}` (each cleaned ≤160 chars), `waitUntil`-writes with `expirationTtl 60*60*24*30` (30-day TTL), returns `{...payload,cached:false}`. Frontend: block after `#mDescToggle` — `#mFitLbl` ("SPOILER-FREE FIT") + `#mFitSummary` w/ 3 `.fit-row` (`.fit-for` 👍 `#fitFor` / `.fit-skip` ⏭️ `#fitSkip` / `.fit-vibe` ✨ `#fitVibe`). `refreshFitSummary(m)` + `_renderFitSummary(m,data)` (before `populateModal`): sessionStorage `ff_fit_{id}` cache-first, `.fit-loading` skeleton, POST `/api/fit-summary` `{id,title,year,genres,overview:m.desc}`, race-guard `ACTIVE_MOVIE.id===m.id`, hides `#mFitLbl`+`#mFitSummary` on error/empty. Called from `openMovie()` after `populateModal(m)`. CSS: `.fit-summary` (indigo linear-gradient panel, `rgba(129,140,248,0.28)` border), `.fit-row`/`.fit-ico`/`.fit-role` (color variants #86efac/#fca5a5/#c4b5fd)/`.fit-val`, `.fit-loading` shimmer, `@keyframes fitFade`/`fitShimmer`. **i18n:** ~41 keys ×6 langs (en/es/fr/zh/ar/uk) — `modal.fit*` (5), `group.*` (12), `onboard.*` quiz keys (24 incl. `q.pace/ending/realism/tone/era` + 15 option labels). **Verified on preview** (mocks + screenshots, console clean): quiz seeds `prefs`+genres (Drama:8/Comedy:8…)+total4>threshold3+`rk_onboard_quiz_done=1`; Group Picker renders groupSummary+3 cards+overlap reasons+appeals chips; Fit Summary renders 3 rows, sessionStorage cache blocks refetch (calls stay 1), block hidden on API error. **Live `curl` confirmed:** `POST /api/group-picker` → ids/reasons/appeals/groupSummary; `POST /api/fit-summary` → `{forYou,skipIf,experience,cached:false}` then `cached:true` on repeat (KV working). ⚠️ **Pass 2 (deferred):** Movie Pitch (shared voting/comments) needs Cloudflare D1 + polling + `/pitch/` page — outlined in plan, not implemented. |

---

## ⚡ Session (2026-07-14) — Stage 1 AI Features: Vibe Search, Tonight Wizard, Why-Match Tags

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `2495f35` | **Stage 1 "must-have" AI features — three trust/choice-paralysis additions on the existing closed-world `/api/ai-search` 119-movie catalog.** **(F1) Vibe Search & natural negative filters:** new `parseVibeQuery(query)` (`index.html`, before `aiSearch()`) regex-extracts exclusion clauses `/\b(?:no\|not\|without\|avoid\|except\|minus)\s+([^,.;]+)/gi` → `{ cleanQuery, exclude[] }` (clauses stripped from cleanQuery so they don't double as positive signal, deduped, ≤8, each ≤40 chars). `aiSearch()` now POSTs `{ query: cleanQuery, exclude }`. Backend `handleAISearch()` (`functions/api/[[path]].js`) reads/sanitizes `exclude` from body, injects a **HARD EXCLUSIONS** block into the user prompt + system-prompt instruction "never recommend a movie whose tone/content matches any hard exclusion; prefer omitting borderline titles." ⚠️ Closed-world/no-runtime-field limit: duration/numeric excludes are soft LLM hints only; theme/vibe/genre excludes are honored. **(F2) "What Should I Watch Tonight?" wizard:** header launcher `.btn-tonight` (`onclick="openWizard()"`, before `.btn-random`, mobile icon-only). New overlay `#wizardOverlay .wiz-overlay` (z-250, between movie-modal z-200 and share z-300) → `.wiz-modal` w/ `#wizProgress` dots (`.wiz-dot`/`.wiz-dot.done`) + `#wizBody`. State `WIZARD_STATE{mood,time,company}` / `WIZARD_STEP` / `WIZ_STEPS` / `WIZ_OPTIONS` (mood ×6, time ×3, company ×4 — each `{key,emoji,q}` w/ English query fragment). Fns: `openWizard`/`closeWizard`/`wizardOverlayClick`/`wizardSelect(key,val)` (stores + auto-advances)/`wizGoStep(n)`/`wizardRestart`/`_wizProgressHTML`/`renderWizard`/`runWizard()`. `runWizard()` composes `"A ${mood.q} movie, ${time.q}, good for ${company.q}"`, runs it through `parseVibeQuery`, POSTs to `/api/ai-search`, resolves top-3 `data.ids` against **`CACHE_MOVIES`** (or `data.movies` for actorQuery branch via `fromTMDb`), pushes picks into `MOVIES` so a card click resolves in `openMovie()`, populates reason/tag maps, renders 3 cards via `renderCardHTML()` into `.wiz-results` (`grid-template-columns:repeat(3,1fr)`, 1-col mobile bottom-sheet). `openMovie()` dismisses `#wizardOverlay` (like the actor-overlay pattern). **(F3) "Why This Matches" tags:** new `_aiMatchTags` Map (`tmdbId → ["Slow-burn mystery",…]`) next to `_aiMatchScores`/`_aiMatchReasons`. `handleAISearch()` system+user prompts request per-result `"tags": [2-3 labels, 1-3 words each]`; parsing loop builds `tags{}` (each `String(t).slice(0,26)`, `.slice(0,3)`); response adds `tags` field (both main and actor-search branches). `renderCardHTML()` builds `whyTagsHTML` chips injected after `whyReasonHTML`; new `.ai-why-tags`/`.ai-why-tag` CSS (indigo-tinted pills, 9.5px, after `@keyframes aiWhyFadeIn`). Empty Map on normal browsing → no chips (no clutter). `aiSearch()` clears/populates `_aiMatchTags` in both branches. i18n: 24 wizard/tonight keys ×6 langs (`tonight.launch`, `wiz.qMood/qTime/qCompany`, `wiz.step` w/ `{n}`/`{total}` vars, `wiz.back/results/restart/loading/empty`, `wiz.mood.*` ×6, `wiz.time.*` ×3, `wiz.company.*` ×4). Verified on preview: `parseVibeQuery` excludes extraction, tag chips render (3 chips) on AI cards + absent on normal cards, full wizard flow (step nav + auto-advance + back + loading + error + 3-card results w/ reasons+chips, desktop 3-col + mobile bottom-sheet), no JS syntax errors. Live `curl` confirms `tags[]` per result + `exclude` accepted. |

---

## ⚡ Most Recent Session (2026-07-13) — Cast to TV: Leanback Receiver + State Machine + QR Fallback

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `124d369` | **Cast to TV upgrade — second-screen experience, not a mirror.** Four parts. **(1) Action clarity:** share `#shareCast` button restructured to two-line layout — bold title `#castBtnText` (`share.cast` = "Cast Trailer to TV") + `<small>` `#castBtnSub` (`share.castSub` = "Watch trailer & AI rating on the big screen"); TV icon `.cast-ico-tv` + hidden stop icon `.cast-ico-stop` + `.cast-spinner` (`#castSpinner`). **(2) State machine `_castSetState(state)`** (`index.html` ~L7680): `idle` / `connecting` (adds `.connecting`, spinner shown via `.share-cast.connecting .cast-spinner{display:block}`, `disabled=true`) / `connected` (`.connected`, solid `var(--cyan)` bg, stop icon, "Connected — Tap to Disconnect" + "Casting to your TV" sub). `castToTV()` rewritten: if already `.connected` → `_castDisconnect()` (terminates `_castConn`); else builds `tvUrl = ${location.origin}/tv/${ACTIVE_MOVIE.id}`, `_castSetState('connecting')`, `new PresentationRequest([tvUrl]).start()` with 12s `_castTimer` → QR fallback on timeout; on success wires `close`/`terminate` listeners back to idle; catch differentiates user-cancel (`NotAllowedError`/`AbortError` → silent idle) vs failure (→ QR). No Presentation API → `openCastQr()` directly. **(3) QR failsafe modal** `#castQrOverlay` (z-index 500) / `.cast-qr-modal`: `openCastQr(url)` renders via vendored **MIT qrcode-generator** (inlined `var qrcode=function` before main `<script>`, ~L3453) → `qrcode(0,'M').addData(url).make().createSvgTag({cellSize:6,margin:2,scalable:true})` into `#castQrCode`; `#castQrLink` + `copyCastTvLink()` (`#castQrCopy`, `.copied` state). `closeCastQr()`/`castQrOverlayClick()`. **(4) New `/tv/index.html` Leanback receiver** (standalone, ~12KB, NOT a mirror): fullscreen dark, `#bg` blurred backdrop (`blur(34px) brightness(0.42)`, `.ready` fade-in), centered unified rating `.unified`/`#uNum` (replicates `calcAvg` via `unifiedRating(r)` + `scoreColor(v)`), autoplay muted trailer `#player` iframe, `#srcChips`, `#overview`, `#brand` watermark. `getMovieId()` reads `/tv/(\d+)` path OR `?m=`; fetches `/api/tmdb/movie/{id}?append_to_response=videos,external_ids` + `/api/omdb?i={imdb_id}`; `showError()` fallback. **Routing:** `_redirects` rewrites `/tv/*  /tv/  200` (200 = rewrite, URL stays `/tv/:id`). ⚠️ Destination is canonical `/tv/` **not** `/tv/index.html` — the latter 308-redirects to `/tv/`, which broke the internal rewrite (served root SPA index.html instead). Static assets under `/tv/` still take precedence, so the rule only fires for dynamic `/tv/:id`. i18n keys added ×6 langs: `share.cast`, `share.castSub`, `share.castConnecting`, `share.castConnectedSub`, `share.lookingDevices`, `share.castConnected`, `share.castNone`, `cast.qrTitle`, `cast.qrSub`, `cast.qrCopy`. Verified: state text/class/disabled swaps, QR SVG renders (178×178, scannable, screenshot), TV page serves at live `/tv/27205` (Inception — TMDB proxy returns title/backdrop/imdb_id/trailer key `cdx31ak4KbQ`). |

---

## ⚡ Session (2026-07-13) — Actor Filmography Dedupe

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `ca6a1dd` | **Fix: duplicate cards in actor filmography grid** — `openActorProfile()` (`index.html` ~L7293) mapped `combined_credits.cast` straight to cards, but TMDB returns one object per credit/role so the same title recurs (multi-episode TV, dual cast+crew, recurring award-show appearances) — e.g. "Golden Globe Awards" ×4, "Jimmy Kimmel Live!" ×2 rendered as separate cards. Fix: after the `poster_path` filter, collapse into a `Map` keyed by `` `${c.media_type}:${c.id}` `` (`_seenFilm`, keeps movie vs TV id namespaces distinct), then `Array.from(_seenFilm.values())` before the existing `popularity` sort — sort/render logic otherwise unchanged. Verified via real `openActorProfile()` flow with a stubbed `tmdbGet` returning 8 dupe-laden credits → exactly 3 unique cards (no-poster item filtered, sort order 90→80→50 intact). |

---

## ⚡ Most Recent Session (2026-07-11) — Synopsis Overflow: Grid Blowout Fix

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `132af4c` | **Fix: synopsis text overflowing off-screen as one continuous line (persisted after `80b4ce7`)** — The prior `80b4ce7` wrap/clamp fix was correct on `.m-desc` itself but the real defect lived in its parent grid. `.m-body` is `display:grid; grid-template-columns:1fr 300px` (`index.html` ~L1076); the desktop `.m-left`/`.m-right` grid items (~L1079-1080) lacked `min-width:0` (only the mobile `@media` override at ~L1870 had it). Default `min-width:auto` let a wide child inside `.m-left` (the `#similarScroll` horizontal `.feed-scroll` and/or the trailer `iframe`) force the `1fr` track past the modal width → `.m-desc` then laid out at that oversized width and the synopsis rendered as a single non-wrapping horizontal line running off the viewport (no clamp/button visible because the element was wider than its text). Fix: add `min-width:0` to desktop `.m-left` and `.m-right` so the `1fr` track can shrink and inner scrollers scroll instead of expanding the track. Verified via the **real** `openMovie()` flow (not isolated textContent): `docScrollW === winW` (no horizontal page overflow), `.m-desc` constrained to 595px desktop / 323px mobile, clamp `-webkit-line-clamp:4` active (`clientH 95 < scrollH 143`), `#mDescToggle` "Read more" appended + visible, `toggleSynopsis()` expand→"Show less"/collapse→"Read more" both correct. Lesson: earlier preview test measured `.m-desc` in isolation with `.open` pre-applied, so it missed the sibling-driven grid blowout — always drive the real `openMovie` path. |

---

## ⚡ Most Recent Session (2026-07-09) — Synopsis "Read More" + Wrap Fix

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `80b4ce7` | **Modal synopsis wrap fix + Read more/Show less** — `.m-desc` (`#mDesc`, the About synopsis, `index.html` ~L1086) gained `overflow-wrap:anywhere; word-break:break-word` so no long token can push the modal layout off-screen. Long text now collapses to 4 lines via a new `.m-desc.clamped` (`display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden`) with a subtle toggle `<button class="m-desc-toggle" id="mDescToggle" onclick="toggleSynopsis()">` (new HTML after `#mDesc` ~L3368). New JS: `_setupSynopsisClamp()` runs after every synopsis text set (all three branches of `refreshDescTranslation()` — English/no-desc, cached translation, async translation) and measures `scrollHeight > clientHeight` to decide whether to keep the clamp + show the toggle (adds `.has-more` for tight 6px spacing) or drop it for short text; `toggleSynopsis()` flips the `.clamped` class + swaps button label. New i18n keys `modal.readMore` / `modal.showLess` (6 languages). Verified via preview: long→clamp+"Read more", toggle→"Show less"/expand, short→no button, 400-char unbroken token→no horizontal overflow. |

---

## ⚡ Most Recent Session (2026-07-09) — Genre Filter Fix

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `e0889f1` | **Fix: genre/country/rating filters looked broken** — Root cause was NOT the fetch: `setGenre(id)` → `applyFilters()` → `loadMovies(1,false)` → `fetchPage()` already appended `with_genres` correctly (verified against live `/api/tmdb/discover/movie?with_genres=27` → all Horror), `tryCache()` already bypassed the KV cache when a genre is set, and the grid re-rendered with filtered results. The disconnect: `loadMovies()` (`index.html` ~L5732 + ~L5847) only hid the discovery feed rows (`#feedSections`: For You / Fresh / Masterpieces) and scrolled `#movieGrid` into view **when a search query was present** (`if (sq)`). Selecting a genre (no query) left the unfiltered feed rows pinned above the grid and never scrolled down → the filter appeared to do nothing. Fix: new shared `_browseFilter = !!(sq \|\| ACTIVE_GENRE \|\| _country \|\| _rating > 0)` flag now drives both the feed-hide and the scroll-into-view (mirroring search behavior); clearing to "All" (`_browseFilter` false) restores the feed with no scroll. `_isFiltered` (count-row "searching" class) now derives from `_browseFilter \|\| AI_SEARCH_ACTIVE`. Same fix also repairs the identical latent issue for Country + Min-Rating filters. |

---

## ⚡ Most Recent Session (2026-07-09) — Modal History Stack & Back Button

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `5b76e35` | **Modal view-history stack + Back button UX** — Deep `Movie ➔ Actor ➔ Movie ➔ Actor` navigation now has a modern Back step alongside the X close. New state after `TRAILER_OPEN` (`index.html` ~L4709): `VIEW_STACK` (`[{type:'movie'\|'actor', id}]`), `CURRENT_VIEW`, `_navBack` flag. Helpers (~L7204): `_recordNavigation(view)` pushes the outgoing view when navigating deeper / resets the trail on a fresh open from grid/search / consumes a pending Back re-render via `_navBack`; `_updateBackBtns()` toggles `.show` on `#mBack`/`#actorBack` when `VIEW_STACK.length>0`; `goBack()` pops the last view, sets `_navBack=true`, and re-opens it in place (`openMovie`/`openActorProfile`). Wired: `_recordNavigation({type:'movie',id})` at the top of `openMovie()` (after the `if(!m)` resolve, before the infinite-loop clean-switch), `_recordNavigation({type:'actor',id})` at the top of `openActorProfile()`. Unified `closeModal()` now closes BOTH overlays, clears the stack, resets `CURRENT_VIEW`; `closeActorProfile()` removed entirely; `actorOverlayClick()` (backdrop) + both modal X buttons call `closeModal()`. `popstate` handler also clears the stack. New Back buttons (← chevron SVG, `<button class="m-back" id="mBack"/"actorBack" onclick="goBack()">`) top-left of both modals, X stays top-right. CSS `.m-back` (base ~L871: absolute top/left 12px, 36×36 blur circle, `display:none`; `.m-back.show{display:flex}`; hover → accent + scale; mobile ~L1846 → 44×44). |

---

## ⚡ Most Recent Session (2026-07-09) — Interactive Actor Avatars, Filmography Modal & AI Actor Search

All commits on `main`, all live on https://findfilm.ai.

| Commit | Feature |
|--------|---------|
| `fe917ab` | **Clickable actor avatars** — `castPhotos` (`[{id,name,photo}]`) now carries real TMDB `person_id`, added in `mergeMovieData()` (`index.html` ~L5148) and `enrichOne()` (`sync-worker.js` ~L277). `refreshModalDetails()` (`index.html` ~L6718) restructured: each actor is its own clickable `<button class="m-starring-actor" onclick="openActorProfile(id)">` (avatar+name together); actors without an `id` (pre-existing KV-cached data) degrade to a non-interactive `<span class="m-starring-static">` until the next sync. CSS reworked from overlapping-avatar-stack to per-actor chips: `.m-starring-actor`, `.m-starring-static`, `.m-starring-sep`, `.m-starring-name` (base ~L873, mobile override ~L1829 — negative-margin overlap rule removed). |
| `fe917ab` | **Actor Filmography Modal** — New nested overlay `.actor-overlay`/`#actorOverlay` (`z-index:400`, stacks above the main `.overlay` at 200 and `.share-panel` at 300 — first nested-modal precedent in the codebase). Opens via `openActorProfile(personId)` (`index.html`, near `closeModal()`): fetches `/person/{id}` + `/person/{id}/combined_credits` via the existing generic `tmdbGet()` proxy (zero backend changes needed), shows photo/name/bio, and renders filmography using the **existing** `renderCardHTML()` `.movie-grid` component (inherits Unified Ratings + AI hover states for free). New `fromPersonCredit(raw)` normalizer (`index.html`, next to `fromTMDb()`) — needed because `combined_credits.cast[]` mixes movie/TV via `raw.media_type`, unlike `fromTMDb()` which reads the global `CONTENT_TYPE`. `closeActorProfile()` guards `document.body.style.overflow` so closing the actor overlay doesn't re-enable scroll if the main movie modal is still open underneath; wired into `closeModal()` alongside the existing `closeShare()` call. New `TIMG_W185` image-size constant. Mobile: bottom-sheet slide-up (`@media max-width:768px`, mirrors `.overlay` mobile pattern). New i18n key `actor.filmography` (6 languages). |
| `fe917ab` | **AI Search actor-query support** — `_parseIntent()` (`functions/api/[[path]].js` ~L259) extended with a 3rd intent value `actor_search` + `actor_name` field. New `_actorMovies(actorName, env)` helper (~L305, next to `_keywordsToGenreIds()`): 2 direct TMDB calls (`/search/person` → `/person/{id}/movie_credits`, same one-off-fetch pattern as the existing `/discover/movie` call), filters `vote_count>=20`, top 12 by `vote_average`. `handleAISearch()` (~L746) now calls `_parseIntent()` unconditionally at the top; on `actor_search` intent with a resolved actor, branches into a dedicated flow — bypasses the closed-world `CACHE_MOVIES` KV catalog entirely (an actor's real filmography is almost never a subset of the ~119-movie AI-search cache), generates "why recommended" reasons via a small scoped LLM prompt (same model, mini catalog of ≤12 candidates), and returns `{ actorQuery:true, personName, movies, reasons, suggestedRefinements, message:null }`. Any failure (intent parse, actor not found, reason-gen) falls through unchanged to the existing catalog-embedding flow — zero behavior change for non-actor queries. Frontend `aiSearch()` (`index.html` ~L6197) branches on `data.actorQuery`: pushes raw TMDB movies through the existing `fromTMDb()` + `MOVIES.push()` pattern (safe here since `movie_credits` never returns TV items, matching `fromTMDb()`'s `CONTENT_TYPE==='movie'` assumption), sets `_aiMatchReasons`, and shows the typewriter banner via new i18n key `ai.foundForActor` (6 languages, e.g. en `"Top movies starring {name}"`). |
| `be1ba47` | **Fix: Starring row invisible on homepage feed** — Root cause of "actor features not visible in live UI": the 119 homepage feed movies come from KV pre-marked `enriched:true` but their data predates the `castPhotos` feature (KV never re-synced), so `castPhotos` is absent. `openMovie()` (`index.html` ~L6485) skips `enrichNow()` for `enriched` movies, so `mergeMovieData()` never ran → `refreshModalDetails()` hid the Starring row (`if (m.castPhotos?.length)`) → clickable actors never rendered for any homepage movie. Added a backfill block in `openMovie()`: for any `enriched` movie lacking `castPhotos`, fetch `/movie/{id}?append_to_response=credits` via `tmdbGet()`, populate `castPhotos` (with `person_id`) + `actors`, then `refreshModalDetails(m)`. Self-healing — stops firing once the nightly sync repopulates KV with `castPhotos`. No extra fetch for movies that already have `castPhotos` (verified: only `/recommendations` fires from `loadSimilarMovies`). |
| `0784274` | **Infinite-loop UX (Movie ➔ Actor ➔ Movie ➔ Actor)** — Filmography grid cards already call `openMovie(id)` via `renderCardHTML()`'s `onclick`, and `populateModal()` already resets all per-movie state (ratings, cast, watch providers, trailer iframe `src=''`+`.active` removal, reviews, similar section) on every switch. The only broken piece was z-index layering: `openMovie()` opens `#overlay` (z-index 200) but the actor overlay `#actorOverlay` (z-index 400) stayed on top, hiding the new movie modal. Fix: `openMovie()` (`index.html` ~L6454) now dismisses the actor overlay when open (Option A clean-switch) — clicking a filmography card seamlessly reveals that movie's modal, enabling endless Movie➔Actor cycling. Single reused `#overlay`+`#actorOverlay` elements (no modal stacking/leak); shared 0.22s opacity transitions crossfade smoothly; body scroll stays locked throughout (`openMovie` re-sets `overflow:hidden`). TV items from `combined_credits` enrich correctly via `doEnrich()`'s `isTV ? 'tv' : 'movie'` endpoint. Verified full 5-step loop + fresh-cast reset via preview mock injection. |

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
| `openActorProfile(personId)` / `closeActorProfile()` | Opens/closes the nested Actor Filmography Modal (`#actorOverlay`); fetches `/person/{id}` + `/person/{id}/combined_credits` via `tmdbGet()` |
| `fromPersonCredit(raw)` | Normalizes a `combined_credits.cast[]` item (mixed movie/TV via `raw.media_type`) into a card-renderable movie object |

Backend (`functions/api/[[path]].js`): `_actorMovies(actorName, env)` resolves an actor name → top 12 movie credits via TMDB `/search/person` + `/person/{id}/movie_credits`; used by `handleAISearch()`'s actor-query branch (triggered by `_parseIntent()`'s `actor_search` intent).

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
