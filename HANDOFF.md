# RatingKino — Handoff

---

## ⚡ Most Recent Session (2026-07-14) — Stage 1 AI Features: Vibe Search, Tonight Wizard, Why-Match Tags

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
