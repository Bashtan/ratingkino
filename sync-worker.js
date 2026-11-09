/**
 * FindFilm.ai — Daily Sync Worker (3-Phase)
 *
 * Cloudflare Workers free plan limits each invocation to 50 subrequests.
 * Enriching 119 movies needs 119 TMDB detail calls, so we split across
 * 3 cron triggers that run 5 minutes apart:
 *
 *   00:00 UTC  Phase 1 — fetch 6 discover pages (6 subreqs) +
 *                         enrich movies  0–39 (40 subreqs) = 46 total
 *   00:05 UTC  Phase 2 — read raw IDs from KV (0 subreqs) +
 *                         enrich movies 40–79 (40 subreqs) = 40 total
 *   00:10 UTC  Phase 3 — read raw IDs from KV (0 subreqs) +
 *                         enrich movies 80–118 (39 subreqs) +
 *                         merge & write final 'new-releases' key
 *
 * KV keys:
 *   nr-raw          – raw discover results (temp, 24 h TTL)
 *   nr-enriched-0   – enriched batch 0 (temp, 24 h TTL)
 *   nr-enriched-1   – enriched batch 1 (temp, 24 h TTL)
 *   new-releases    – final 119 fully-enriched movies (48 h TTL)
 *   last-sync       – JSON object with timestamp + stats (48 h TTL)
 *   rx:v1:<type>:<id> – FF Bot's arc for a title's trailer (30 d TTL, 00:20 UTC;
 *                     see "Trailer arcs" below)
 *   ogimg:v2:<type>:<id> – a title's link-preview card, written by the Pages site
 *                     (functions/og/); at 00:40 UTC the listed titles' cards are
 *                     requested so they're drawn ahead of a share (see "Preview cards")
 *
 * Vectorize findfilm-films (binding VECTORIZE): the vibe-search index. At
 * 00:30 UTC the new releases go in and the recent ones get fresh votes
 * (see "Vibe index" below).
 *
 * NOTE: OMDb ratings are skipped because:
 *   a) each OMDb call consumes a subrequest (counts against the 50 limit)
 *   b) the OMDb free key allows 1000 req/day — easily exceeded with 119 movies
 *   c) brand-new 2026 releases often don't have OMDb entries yet
 *   To re-enable: upgrade to Cloudflare Workers Standard ($5/mo, 1000 subreqs)
 *   then restore the OMDb block in enrichOne().
 */

import { detailsRow, docText, metadata, tagFilms, tagInput, embed, vectorId } from './tools/vibe/film-doc.mjs';

const TMDB_BASE = 'https://api.themoviedb.org/3';

const NEW_RELEASES_COUNT = 119; // exact homepage quota
const NR_PAGES           = 6;   // 6 × 20 = 120 ≥ 119 (release_date.desc)
const NR_DAYS            = 180; // look-back window (6 months ensures enough titles)
const PHASE_BATCH        = 40;  // movies per phase (40 TMDB calls ≤ 50 subreq limit)

// Phase 0 — popular + random-pool (lightweight discover, no per-movie enrichment)
// Budget: POPULAR_PAGES + RANDOM_POOL_PAGES = 5 + 25 = 30 subreqs ≤ 50 ✓
const POPULAR_COUNT      = 100;
const POPULAR_PAGES      = 5;   // 5 × 20 = 100 popular movies
const RANDOM_POOL_COUNT  = 500;
const RANDOM_POOL_PAGES  = 25;  // 25 × 20 = 500 movies for roulette

const BATCH_SIZE         = 3;   // concurrent enrichments within a phase
const BATCH_DELAY_MS     = 400; // ms between batches (TMDB asks ≤ 50 req/10 s)
const RETRY_DELAY_MS     = 5000;// ms to wait after a retryable error
const KV_TTL_SEC         = 172800; // 48 h
const KV_TEMP_TTL_SEC    = 86400;  // 24 h (temp keys between phases)

// Trailer arcs (syncTrailerArcs). The lists are the site's own: Cinematic's
// Trending and Top Rated, movies and series (TYPES and CHIPS in
// cinematic/index.html), page 1 each.
const RX_LISTS = [
  ['movie', '/trending/movie/week', {}],
  ['tv',    '/trending/tv/week',    {}],
  ['movie', '/discover/movie', { sort_by: 'vote_average.desc', 'vote_count.gte': '5000', without_genres: '99,10770' }],
  ['tv',    '/discover/tv',    { sort_by: 'vote_average.desc', 'vote_count.gte': '1500', without_genres: '10767,10763,10764,10766' }],
];
const RX_MODEL    = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// The reactions FFBot.watch knows (RX in assets/social.js; findfilm-tiktok-bot's bot-moods.py too).
const RX_NAMES    = ['watch', 'curious', 'tense', 'wow', 'hyped', 'laughing', 'shocked', 'teary'];
const RX_GAP      = 0.05;   // beats closer than this (a share of the trailer) are one beat
const RX_MAX_RUN  = 40;     // new arcs per run: 2 subrequests each (TMDB + AI)
const RX_TTL_SEC  = 60 * 60 * 24 * 30;   // 30 d: a title still listed then gets a fresh arc

// Preview cards (syncPreviewCards): the same lists' link-preview images.
const CARD_URL    = 'https://findfilm.ai/og/v2';   // CARD_VERSION in functions/og/[[path]].js
const CARD_KV     = 'ogimg:v2';                    // its KV key prefix
const CARD_POOL   = 3;                             // cards drawn at once (each ~3–4 s)

// Guests' saved data on its way from ratingkino.com to findfilm.ai (functions/_lib/transfer.js). A code
// lasts 8 minutes and this runs every minute, which is what makes the privacy page's "ten minutes at the
// latest" true for a code nobody ever claims.
async function sweepTransfers(env) {
  await env.USERS.prepare('DELETE FROM transfers WHERE expires_at < ?1').bind(Date.now()).run();
}

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    if      (cron === '55 23 * * *') ctx.waitUntil(syncPhase0(env));
    else if (cron === '0 0 * * *')   ctx.waitUntil(syncPhase1(env));
    else if (cron === '5 0 * * *')   ctx.waitUntil(syncPhase2(env));
    else if (cron === '10 0 * * *')  ctx.waitUntil(syncPhase3(env));
    else if (cron === '20 0 * * *')  ctx.waitUntil(syncTrailerArcs(env));
    else if (cron === '30 0 * * *')  ctx.waitUntil(syncVibeIndex(env));
    else if (cron === '40 0 * * *')  ctx.waitUntil(syncPreviewCards(env));
    else if (cron === '* * * * *')   ctx.waitUntil(sweepTransfers(env));
  },

  // Manual trigger: GET /sync-now?phase=popular|0|1|2|rx|vibe|cards
  // Each phase returns immediately; poll /api/cache/status to track progress.
  // Except rx, vibe and cards, which answer with their stats once done: a fetch's
  // waitUntil is cut 30 s after the response, and these runs take minutes.
  // vibe&dry=1 only reports what a run would do; vibe&max=N tags at most N films.
  async fetch(request, env, ctx) {
    const url   = new URL(request.url);
    const phase = url.searchParams.get('phase') ?? '0';
    if (url.pathname === '/sync-now' && phase === 'rx') {
      return Response.json(await syncTrailerArcs(env));
    }
    if (url.pathname === '/sync-now' && phase === 'cards') {
      return Response.json(await syncPreviewCards(env));
    }
    if (url.pathname === '/sync-now' && phase === 'vibe') {
      const max = parseInt(url.searchParams.get('max') || '', 10);
      return Response.json(await syncVibeIndex(env, {
        dry: url.searchParams.get('dry') === '1',
        maxTag: max > 0 ? Math.min(max, VIBE_MAX_TAG) : VIBE_MAX_TAG,
      }));
    }
    if (url.pathname === '/sync-now') {
      const fn = phase === 'popular' ? syncPhase0
               : phase === '1'       ? syncPhase2
               : phase === '2'       ? syncPhase3
               :                       syncPhase1;
      ctx.waitUntil(fn(env));
      const prev = await env.MOVIES_CACHE.get('last-sync').catch(() => null);
      return new Response(JSON.stringify({
        message: `phase ${phase} started`,
        previous: prev ? JSON.parse(prev) : null,
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('FindFilm.ai Sync Worker', { status: 200 });
  },
};

/* ─── Phase 1: discover + enrich batch 0 (movies 0–39) ─────── */
// Subrequest budget: 6 discover + 40 TMDB detail = 46 ≤ 50 ✓

async function syncPhase1(env) {
  console.log('[phase1] Starting at', new Date().toISOString());

  // 1. Fetch raw new-releases from TMDB (6 pages = 6 subrequests)
  const raw = await fetchNewReleasesPool(env);
  console.log(`[phase1] Fetched ${raw.length} raw movies`);

  // 2. Save raw list for phases 2 and 3 to reuse
  await env.MOVIES_CACHE.put('nr-raw', JSON.stringify(raw), { expirationTtl: KV_TEMP_TTL_SEC });

  // 3. Enrich batch 0 (movies 0–PHASE_BATCH-1), no OMDb
  const batch0 = raw.slice(0, PHASE_BATCH);
  const enriched0 = await enrichBatch(batch0, env);
  console.log(`[phase1] Enriched ${enriched0.filter(m => m.enriched).length}/${batch0.length}`);
  await env.MOVIES_CACHE.put('nr-enriched-0', JSON.stringify(enriched0), { expirationTtl: KV_TEMP_TTL_SEC });

  await writeMeta(env, { phase: 1, enriched0: enriched0.filter(m => m.enriched).length });
  console.log('[phase1] Done');
}

/* ─── Phase 2: enrich batch 1 (movies 40–79) ───────────────── */
// Subrequest budget: 0 discover + 40 TMDB detail = 40 ≤ 50 ✓

async function syncPhase2(env) {
  console.log('[phase2] Starting at', new Date().toISOString());
  const raw = JSON.parse(await env.MOVIES_CACHE.get('nr-raw') || '[]');
  if (!raw.length) { console.error('[phase2] nr-raw missing — phase 1 may not have run'); return; }

  const batch1 = raw.slice(PHASE_BATCH, PHASE_BATCH * 2);
  const enriched1 = await enrichBatch(batch1, env);
  console.log(`[phase2] Enriched ${enriched1.filter(m => m.enriched).length}/${batch1.length}`);
  await env.MOVIES_CACHE.put('nr-enriched-1', JSON.stringify(enriched1), { expirationTtl: KV_TEMP_TTL_SEC });

  await writeMeta(env, { phase: 2, enriched1: enriched1.filter(m => m.enriched).length });
  console.log('[phase2] Done');
}

/* ─── Phase 3: enrich batch 2 (movies 80–118), merge, finalize ─ */
// Subrequest budget: 0 discover + 39 TMDB detail = 39 ≤ 50 ✓

async function syncPhase3(env) {
  console.log('[phase3] Starting at', new Date().toISOString());

  const [rawStr, e0Str, e1Str] = await Promise.all([
    env.MOVIES_CACHE.get('nr-raw'),
    env.MOVIES_CACHE.get('nr-enriched-0'),
    env.MOVIES_CACHE.get('nr-enriched-1'),
  ]);

  if (!rawStr) { console.error('[phase3] nr-raw missing'); return; }
  const raw = JSON.parse(rawStr);

  const batch2   = raw.slice(PHASE_BATCH * 2, NEW_RELEASES_COUNT);
  const enriched2 = await enrichBatch(batch2, env);
  console.log(`[phase3] Enriched ${enriched2.filter(m => m.enriched).length}/${batch2.length}`);

  // Merge all three batches into the final list
  const enriched0 = e0Str ? JSON.parse(e0Str) : [];
  const enriched1 = e1Str ? JSON.parse(e1Str) : [];
  const allMovies = [...enriched0, ...enriched1, ...enriched2].slice(0, NEW_RELEASES_COUNT);

  const meta = {
    timestamp:        new Date().toISOString(),
    newReleasesCount: allMovies.length,
    totalEnriched:    allMovies.filter(m => m.enriched).length,
    phase:            3,
  };

  // Write final result + clean up temp keys
  await Promise.all([
    env.MOVIES_CACHE.put('new-releases', JSON.stringify(allMovies), { expirationTtl: KV_TTL_SEC }),
    env.MOVIES_CACHE.put('last-sync',    JSON.stringify(meta),      { expirationTtl: KV_TTL_SEC }),
    env.MOVIES_CACHE.delete('nr-raw'),
    env.MOVIES_CACHE.delete('nr-enriched-0'),
    env.MOVIES_CACHE.delete('nr-enriched-1'),
  ]);

  console.log('[phase3] Done —', meta);
}

/* ─── Phase 0: popular + random-pool ──────────────────────── */
// Runs at 23:55 UTC — 5 min before Phase 1 kicks off.
// Uses lightweight discover data only (no per-movie enrichment).
// Budget: 5 popular pages + 25 random-pool pages = 30 subreqs ≤ 50 ✓

async function syncPhase0(env) {
  console.log('[phase0] Starting at', new Date().toISOString());
  await Promise.all([
    syncPopular(env),
    syncRandomPool(env),
  ]);
  console.log('[phase0] Done');
}

async function syncPopular(env) {
  const movies = await fetchDiscoverPages(env, {
    sort_by:         'popularity.desc',
    'vote_count.gte': '100',
    include_adult:   'false',
    language:        'en-US',
  }, POPULAR_PAGES);

  const mapped = movies.slice(0, POPULAR_COUNT).map(basicMovie);
  await env.MOVIES_CACHE.put('popular', JSON.stringify(mapped), { expirationTtl: KV_TTL_SEC });
  console.log(`[phase0] popular: ${mapped.length} movies written`);
}

async function syncRandomPool(env) {
  const movies = await fetchDiscoverPages(env, {
    sort_by:         'vote_average.desc',
    'vote_count.gte': '500',
    include_adult:   'false',
    language:        'en-US',
  }, RANDOM_POOL_PAGES);

  const mapped = movies.slice(0, RANDOM_POOL_COUNT).map(basicMovie);
  await env.MOVIES_CACHE.put('random-pool', JSON.stringify(mapped), { expirationTtl: KV_TTL_SEC });
  console.log(`[phase0] random-pool: ${mapped.length} movies written`);
}

/* ─── Trailer arcs: FF Bot's script for a title's trailer ─────── */
// Runs at 00:20 UTC. For each title in RX_LISTS without one yet, the 70B writes
// the arc FFBot.watch (assets/social.js) follows while that title's trailer
// plays: [[share of the trailer, reaction], …], from TMDB's facts (genres,
// keywords, tagline, overview). The trailer itself is never fetched (the
// owner's rule: no YouTube downloads), so the beats follow the film's story
// and tone, not the trailer's actual cuts. A title that has an arc is skipped,
// so a night costs only the new ones. Served by /api/rx/<type>/<id>
// (functions/api/[[path]].js); titles without one keep the genre's arc.
// Budget: 4 list pages + 2 per new arc (TMDB + AI), ≤ RX_MAX_RUN arcs.

const RX_SCHEMA = {
  type: 'object',
  properties: {
    beats: {
      type: 'array',
      items: {
        type: 'object',
        properties: { at: { type: 'number' }, moment: { type: 'string' }, rx: { type: 'string', enum: RX_NAMES } },
        required: ['at', 'moment', 'rx'],
      },
    },
  },
  required: ['beats'],
};

// Without moments, every arc came out on one template (curious, tense, wow,
// hyped at the same shares, Law & Order included): naming what the trailer
// shows makes the model picture this title's trailer before it reacts.
function rxPrompt(type) {
  const what = type === 'tv' ? 'series' : 'film';
  return `You plan how FF Bot, FindFilm.ai's little robot mascot, reacts while it watches the official trailer of one ${what} beside the viewer, like a streamer's reaction cam. You can't see the trailer, so picture it from what you know about this ${what} and the facts given: the moments its trailer would really show, in order, and how a fan would react to each.

Trailers differ: a comedy's is a string of gags with straight-faced beats between, a horror film's is long dread broken by scares, a drama's builds quietly to one emotional swell, an epic's opens on a mystery and climbs to a montage of spectacle, a crime story's turns on a reveal. Shape this one to fit the ${what}.

The reactions, and only these names:
- watch: just watching (the logos, quiet moments)
- curious: intrigued by the setup or a mystery
- tense: suspense, danger closing in, dread
- wow: awe at spectacle, scale or a striking reveal
- hyped: pumped by action, a chase, a triumphant moment
- laughing: a joke, comic chaos, absurdity
- shocked: a scare, a brutal surprise, a horrifying reveal
- teary: grief, love, a moving moment

Return JSON: beats, 6 to 9 of them, in order. Each beat has:
- at: the share of the trailer (0 to 1) where the moment starts. The first is at 0 (the logos, watch); the last starts by 0.92; keep them at least 0.06 apart, spaced the way this trailer would be, not evenly.
- moment: what the trailer shows then, in 3 to 8 words, specific to this ${what}. Nothing past its premise: no twists or endings.
- rx: the reaction to that moment.
React the way a real viewer of this ${what} would: a crime drama is curious and tense rather than hyped, a comedy laughs often, a weepie turns teary, a horror film is tense and shocked. Don't add action or spectacle the ${what} doesn't have. Use at least three different reactions.`;
}

// TMDB's details (English, with keywords) → the fact sheet the model reads.
// A shorter cousin of _fitFacts() in functions/api/[[path]].js (separate runtime).
function rxFacts(type, d) {
  const year = (d.release_date || d.first_air_date || '').slice(0, 4);
  const keywords = (d.keywords?.keywords || d.keywords?.results || []).slice(0, 15).map(k => k.name);
  return [
    `${type === 'tv' ? 'TV series' : 'Film'}: ${d.title || d.name}${year ? ` (${year})` : ''}`,
    d.genres?.length && `Genres: ${d.genres.map(g => g.name).join(', ')}`,
    d.tagline && `Tagline: ${d.tagline}`,
    keywords.length && `Keywords: ${keywords.join(', ')}`,
    d.overview && `Overview: ${String(d.overview).replace(/[\n\r]+/g, ' ').slice(0, 700)}`,
  ].filter(Boolean).join('\n');
}

// The model's beats → an arc FFBot.watch can follow, [share, reaction, moment],
// or null: known reactions only, in order, from [0, 'watch'], none closer than
// RX_GAP, a repeat merged into the beat before it, and enough of them that it's
// a real arc. The moment is only kept to show why (the API sends [share, reaction]).
function rxArc(beats) {
  if (!Array.isArray(beats)) return null;
  const ok = beats.filter(b => b && RX_NAMES.includes(b.rx) && Number.isFinite(b.at));
  const scale = ok.some(b => b.at > 1.5) ? 100 : 1;   // shares given as percentages
  const arc = [[0, 'watch', 'logos']];
  ok.map(b => [Math.round(Math.min(Math.max(b.at / scale, 0), 0.95) * 1000) / 1000, b.rx, String(b.moment || '').slice(0, 80)])
    .sort((a, b) => a[0] - b[0])
    .forEach(beat => {
      const last = arc[arc.length - 1];
      if (beat[1] !== last[1] && beat[0] - last[0] >= RX_GAP) arc.push(beat);
    });
  const kinds = new Set(arc.map(b => b[1]).filter(rx => rx !== 'watch'));
  return arc.length >= 5 && kinds.size >= 2 ? arc : null;
}

async function rxFor(type, id, env) {
  const d = await fetchJSON(tmdbUrl(env, `/${type}/${id}`, { language: 'en-US', append_to_response: 'keywords' }));
  if (!d) return null;
  const out = await env.AI.run(RX_MODEL, {
    messages: [
      { role: 'system', content: rxPrompt(type) },
      { role: 'user',   content: rxFacts(type, d) },
    ],
    response_format: { type: 'json_schema', json_schema: RX_SCHEMA },
    max_tokens:  700,
    temperature: 0.6,
  });
  // JSON mode puts an object in `response`, or at times answers in OpenAI's
  // chat shape (choices[0].message.content); some answers still arrive as text.
  const r = out?.response ?? out?.choices?.[0]?.message?.content ?? out;
  const m = r && typeof r === 'object' ? r : JSON.parse(String(r || '').match(/\{[\s\S]*\}/)?.[0] || 'null');
  return rxArc(m?.beats);
}

// RX_LISTS' titles: type:id → [type, id], each title once.
async function listedTitles(env) {
  const titles = new Map();
  for (const [type, path, params] of RX_LISTS) {
    const page = await fetchJSON(tmdbUrl(env, path, { ...params, page: 1 }));
    for (const t of page?.results || []) titles.set(`${type}:${t.id}`, [type, t.id]);
  }
  return titles;
}

async function syncTrailerArcs(env) {
  console.log('[rx] Starting at', new Date().toISOString());
  const titles = await listedTitles(env);
  const todo = [];
  for (const [key, title] of titles) {
    if (!(await env.MOVIES_CACHE.get(`rx:v1:${key}`))) todo.push(title);
  }
  const stats = { listed: titles.size, had: titles.size - todo.length, made: 0, failed: 0, left: Math.max(todo.length - RX_MAX_RUN, 0) };

  const run = todo.slice(0, RX_MAX_RUN);
  for (let i = 0; i < run.length; i += BATCH_SIZE) {
    await Promise.all(run.slice(i, i + BATCH_SIZE).map(async ([type, id]) => {
      try {
        const arc = await rxFor(type, id, env);
        if (!arc) throw new Error('no usable arc');
        await env.MOVIES_CACHE.put(`rx:v1:${type}:${id}`, JSON.stringify({ arc, at: isoDate(new Date()) }), { expirationTtl: RX_TTL_SEC });
        stats.made++;
      } catch (err) {
        stats.failed++;
        console.error(`[rx] ${type}:${id} ${err.message}`);
      }
    }));
    if (i + BATCH_SIZE < run.length) await sleep(BATCH_DELAY_MS);
  }

  await writeMeta(env, { rx: stats });
  console.log('[rx] Done —', JSON.stringify(stats));
  return stats;
}

/* ─── Preview cards: a shared title's link-preview image, drawn ahead ─────── */
// Runs at 00:40 UTC. A shared title's preview image, /og/v2/<type>/<id>.jpg
// (functions/og/[[path]].js on the Pages site), is drawn on its first request
// in about 3–4 s, then kept in KV for a week (ogimg:v2:<type>:<id>). The titles
// people share most are the ones on the site's lists, so this requests each
// listed title's card that isn't in KV: when a link is unfurled, it's served
// in ~20 ms. A card that has expired is drawn again, with that week's scores.
// Budget: 4 list pages + 1 request per card drawn.

async function syncPreviewCards(env) {
  console.log('[cards] Starting at', new Date().toISOString());
  const titles = await listedTitles(env);
  // Which cards exist: one KV list of the prefix (keys only), not a get per
  // title, which would read each ~70 KB JPEG.
  const have = new Set();
  let cursor;
  do {
    const page = await env.MOVIES_CACHE.list({ prefix: `${CARD_KV}:`, cursor });
    page.keys.forEach(k => have.add(k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  const todo = [...titles].filter(([key]) => !have.has(`${CARD_KV}:${key}`)).map(([, title]) => title);
  const stats = { listed: titles.size, had: titles.size - todo.length, drawn: 0, failed: 0 };
  await pool(todo, CARD_POOL, async ([type, id]) => {
    try {
      // A card that can't be drawn answers 302 (to the default image): not followed.
      const res = await fetch(`${CARD_URL}/${type}/${id}.jpg`, { redirect: 'manual' });
      await res.arrayBuffer();
      if (res.status !== 200 || !(res.headers.get('Content-Type') || '').startsWith('image/')) throw new Error(`HTTP ${res.status}`);
      stats.drawn++;
    } catch (err) {
      stats.failed++;
      console.error(`[cards] ${type}:${id} ${err.message}`);
    }
  });

  await writeMeta(env, { cards: stats });
  console.log('[cards] Done —', JSON.stringify(stats));
  return stats;
}

/* ─── Vibe index: new releases into vibe search ──────────────── */
// The vibe-search index (Vectorize findfilm-films, read by /api/vibe-search)
// was filled once with the 50K most-voted films (tools/vibe/ingest.mjs: 31
// votes or more), so a film out this week was never in it, though it is what
// the Shorts promote. Each night syncVibeIndex() adds the new releases people
// are likely to look for and keeps the recent ones' votes current. The lists,
// in priority order:
//   shorts    released in the last 3 days, most popular first: the pool the
//             Shorts bot picks from (findfilm-tiktok-bot, fetchRecentContent)
//   trending  this week's trending films
//   recent    released in the last VIBE_RECENT_DAYS, most popular first
// A film needs an overview, a poster and a release date no later than today.
// Each is looked up in the index by id:
//   missing, or there without vibe tags → TMDB details, vibe tags (the 70B,
//     10 films a call), embedded and upserted with the bulk ingest's text and
//     metadata (tools/vibe/film-doc.mjs). If the 70B misses a film, it goes in
//     untagged (its overview still finds it) and is tagged on a later night.
//   there, but its title, overview, genres or year changed → details again
//     and re-embedded, keeping its tags.
//   there, with new votes, a new rating or new images → new metadata on the
//     same vector.
// TMDB's /movie/changes was the first plan, but it lists ~7,300 edits a day
// with no votes, so finding the new films in it would cost a details call each.
// Budget (Workers Paid: 10,000 subrequests): ~18 list pages, a getByIds per 20
// films, a details call per film added or re-embedded, one tag call per 10 new
// films (≤ VIBE_MAX_TAG a run), an embed call per 50, an upsert per 500.
const VIBE_RECENT_DAYS  = 120;
const VIBE_RECENT_PAGES = 15;    // the 300 most popular of them
const VIBE_SHORTS_PAGES = 2;     // the bot walks page 1
const VIBE_MAX_TAG      = 200;   // films tagged per run; the rest wait for the next
const VIBE_TAG_BATCH    = 10;
const VIBE_TAG_CONC     = 4;
const VIBE_GET_BATCH    = 20;
const VIBE_EMBED_BATCH  = 50;
const VIBE_UPSERT_BATCH = 500;
// Metadata fields that change the embedded text, and those that don't.
const VIBE_TEXT_KEYS = ['t', 'o', 'g', 'year'];
const VIBE_META_KEYS = ['votes', 'rating', 'p', 'b', 'd', 'ot', 'lang'];

function vibeLists(today) {
  const ago  = n => isoDate(new Date(Date.now() - n * 86400000));
  const disc = { include_adult: 'false', include_video: 'false', language: 'en-US',
                 sort_by: 'popularity.desc', 'primary_release_date.lte': today };
  return [
    ['shorts',   '/discover/movie',      { ...disc, 'primary_release_date.gte': ago(3) },                VIBE_SHORTS_PAGES],
    ['trending', '/trending/movie/week', { language: 'en-US' },                                          1],
    ['recent',   '/discover/movie',      { ...disc, 'primary_release_date.gte': ago(VIBE_RECENT_DAYS) }, VIBE_RECENT_PAGES],
  ];
}

const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, k) => a.slice(k * n, k * n + n));

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

async function syncVibeIndex(env, { dry = false, maxTag = VIBE_MAX_TAG } = {}) {
  const t0 = Date.now();
  const today = isoDate(new Date());
  console.log('[vibe] Starting at', new Date().toISOString(), dry ? '(dry run)' : '');

  // 1. The candidates, the Shorts' pool first.
  const films = new Map();   // id → TMDB row
  const lists = {};
  for (const [name, path, params, pages] of vibeLists(today)) {
    lists[name] = 0;
    for (let page = 1; page <= pages; page++) {
      const d = await fetchJSON(tmdbUrl(env, path, { ...params, page }));
      for (const m of d?.results || []) {
        if (m.adult || !m.overview || !m.poster_path || !m.release_date || m.release_date > today || films.has(m.id)) continue;
        films.set(m.id, m);
        lists[name]++;
      }
      if (!d || page >= (d.total_pages || 0)) break;
    }
  }

  // 2. Which of them the index has.
  const have = new Map();    // id → {id, values, metadata}
  for (const ids of chunks([...films.keys()], VIBE_GET_BATCH)) {
    for (const v of (await env.VECTORIZE.getByIds(ids.map(vectorId))) || []) have.set(Number(String(v.id).slice(1)), v);
  }

  // 3. What each needs.
  const add = [], reembed = [], refresh = [];
  for (const [id, row] of films) {
    const v = have.get(id), m = v?.metadata;
    if (!m || !m.vt) { add.push({ row }); continue; }
    const tag = { tags: String(m.vt).split('|').filter(Boolean), feel: m.f || '' };
    const det = { runtime: m.runtime || 0, kw: String(m.kw || '').split('|').filter(Boolean), dir: m.dir || '',
                  cast: String(m.cast || '').split('|').filter(Boolean) };
    const fresh = metadata({ ...row, det, tag });   // equals m except where TMDB changed
    const changed = keys => keys.some(k => (fresh[k] ?? '') !== (m[k] ?? ''));
    if (changed(VIBE_TEXT_KEYS) || (changed(VIBE_META_KEYS) && !v.values?.length)) reembed.push({ row, tag });
    else if (changed(VIBE_META_KEYS)) refresh.push({ id: v.id, values: v.values, metadata: fresh });
  }
  const tagNow = add.slice(0, maxTag);
  const stats = {
    listed: films.size, lists, inIndex: have.size,
    added: 0, retagged: 0, reembedded: 0, refreshed: 0, untagged: 0, failed: 0, left: add.length - tagNow.length,
  };
  if (dry) {
    console.log('[vibe] Dry run —', JSON.stringify(stats));
    return { ...stats, dry: true, toAdd: add.length, toReembed: reembed.length, toRefresh: refresh.length,
             adding: tagNow.slice(0, 60).map(({ row }) => `${row.id} ${row.title} (${row.release_date}, ${row.vote_count} votes)`) };
  }

  // 4. TMDB details for each film to embed; vibe tags for those without.
  const work = [...tagNow, ...reembed];
  await pool(work, BATCH_SIZE * 2, async w => {
    const d = await fetchJSON(tmdbUrl(env, `/movie/${w.row.id}`, { language: 'en-US', append_to_response: 'keywords,credits' }));
    if (d) w.det = detailsRow(w.row.id, d);
  });
  const ready = work.filter(w => w.det);
  stats.failed += work.length - ready.length;
  for (let pass = 1; pass <= 2; pass++) {    // the 70B misses JSON now and then: a 2nd pass for those
    await pool(chunks(ready.filter(w => !w.tag), VIBE_TAG_BATCH), VIBE_TAG_CONC, async group => {
      try {
        const got = await tagFilms(env.AI, group.map(w => tagInput({ ...w.row, det: w.det })));
        for (const w of group) if (got[w.row.id]?.tags?.length) w.tag = got[w.row.id];
      } catch (err) {
        console.error(`[vibe] tags (pass ${pass}): ${err.message}`);
      }
    });
  }

  // 5. Embed, then write the new vectors and the refreshed metadata.
  const rows = [];
  for (const group of chunks(ready, VIBE_EMBED_BATCH)) {
    const fs = group.map(w => ({ ...w.row, det: w.det, tag: w.tag || {} }));
    try {
      const vecs = await embed(env.AI, fs.map(docText));
      fs.forEach((f, k) => rows.push({ id: vectorId(f.id), values: vecs[k], metadata: metadata(f) }));
      for (const w of group) {
        if (!w.tag) stats.untagged++;
        if (reembed.includes(w)) stats.reembedded++;
        else if (have.has(w.row.id)) stats.retagged++;
        else stats.added++;
      }
    } catch (err) {
      stats.failed += group.length;
      console.error(`[vibe] embed: ${err.message}`);
    }
  }
  rows.push(...refresh);
  stats.refreshed = refresh.length;
  try {
    for (const group of chunks(rows, VIBE_UPSERT_BATCH)) await env.VECTORIZE.upsert(group);
  } catch (err) {
    stats.error = `upsert: ${err.message}`;
    console.error(`[vibe] ${stats.error}`);
  }

  stats.ms = Date.now() - t0;
  await writeMeta(env, { vibe: { ...stats, at: new Date().toISOString() } });
  console.log('[vibe] Done —', JSON.stringify(stats));
  return stats;
}

/* ─── TMDB fetcher ────────────────────────────────────────── */

// Generic multi-page discover fetcher (no enrichment — discover data only)
async function fetchDiscoverPages(env, params, maxPages) {
  const results = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = tmdbUrl(env, '/discover/movie', { ...params, page: String(page) });
    const res = await fetchJSON(url);
    if (!res?.results?.length) break;
    results.push(...res.results);
    if (results.length >= maxPages * 20) break;
    if (page >= (res.total_pages || 1)) break;
  }
  // Deduplicate by id
  const seen = new Set();
  return results.filter(m => seen.has(m.id) ? false : (seen.add(m.id), true));
}

async function fetchNewReleasesPool(env) {
  const today  = isoDate(new Date());
  const cutoff = isoDate(new Date(Date.now() - NR_DAYS * 86400_000));
  const results = [];

  for (let page = 1; page <= NR_PAGES; page++) {
    const url = tmdbUrl(env, '/discover/movie', {
      sort_by:                    'release_date.desc',
      'primary_release_date.gte': cutoff,
      'primary_release_date.lte': today,
      'vote_count.gte':           '5',
      include_adult:              'false',
      language:                   'en-US',
      page:                       String(page),
    });
    const res = await fetchJSON(url);
    if (!res?.results?.length) break;
    results.push(...res.results);
    if (results.length >= NEW_RELEASES_COUNT) break;
    if (page >= (res.total_pages || 1)) break;
  }

  // Deduplicate
  const seen = new Set();
  return results
    .filter(m => seen.has(m.id) ? false : (seen.add(m.id), true))
    .slice(0, NEW_RELEASES_COUNT);
}

/* ─── Enrichment ──────────────────────────────────────────── */

async function enrichBatch(movies, env) {
  const results = [];
  for (let i = 0; i < movies.length; i += BATCH_SIZE) {
    const batch = movies.slice(i, i + BATCH_SIZE);
    const done  = await Promise.all(batch.map(m => enrichOne(m, env)));
    results.push(...done.filter(Boolean));
    if (i + BATCH_SIZE < movies.length) await sleep(BATCH_DELAY_MS);
  }
  return results;
}

async function enrichOne(raw, env) {
  try {
    const detail = await fetchJSON(
      tmdbUrl(env, `/movie/${raw.id}`, {
        append_to_response: 'credits,external_ids,videos,watch/providers,reviews',
        language: 'en-US',
      })
    );
    if (!detail?.id) return basicMovie(raw);

    const imdbId      = detail.external_ids?.imdb_id || null;
    const director    = (detail.credits?.crew || []).find(c => c.job === 'Director')?.name || null;
    const actors      = (detail.credits?.cast || []).slice(0, 5).map(c => c.name);
    // Keep in sync with CAST_LIMIT in index.html — the modal's Starring row shows
    // this many. When this cap is lower, the client has to re-fetch credits for
    // every cached movie just to fill the row out, so widening it here removes
    // that whole round trip as KV re-syncs.
    const castPhotos  = (detail.credits?.cast || [])
      .filter(c => c && c.name)
      .slice(0, 5)
      .map(c => ({
        id:    c.id ?? null,
        name:  c.name,
        photo: c.profile_path ? `https://image.tmdb.org/t/p/w45${c.profile_path}` : null,
      }));
    const trailerKey  = (detail.videos?.results || [])
                          .find(v => v.type === 'Trailer' && v.site === 'YouTube')?.key || null;
    const trailer     = trailerKey ? `https://www.youtube.com/embed/${trailerKey}` : null;
    const usProviders = detail['watch/providers']?.results?.US || {};
    const genres      = (detail.genres || []).map(g => g.name);
    const reviews     = pickReviews(detail.reviews?.results);

    return {
      id:        detail.id,
      title:     detail.title || '',
      titleOrig: detail.original_title || '',
      year:      (detail.release_date || '').slice(0, 4) || null,
      genres,
      genreIds:  (detail.genres || []).map(g => g.id),
      genre:     genres[0] || '',
      country:   (detail.production_countries || [])[0]?.iso_3166_1 || null,
      director,
      actors,
      castPhotos,
      desc:      detail.overview || '',
      trailer,
      poster:    detail.poster_path   || null,
      backdrop:  detail.backdrop_path || null,
      imdbId,
      // Ratings (TMDB only — OMDb skipped to stay within free-tier subrequest budget)
      imdb:       null,
      imdbV:      0,
      rt:         null,
      mc:         null,
      awards:     [],
      tmdbScore:  detail.vote_average ? +detail.vote_average.toFixed(1) : null,
      tmdbVotes:  detail.vote_count   || 0,
      // Watch providers — US only, pre-baked at sync time. Non-US visitors get
      // this backfilled live client-side (see the regional watch-providers
      // backfill in openMovieModal() in index.html), which is why wpCountry
      // is set explicitly here rather than left undefined — that backfill
      // compares against it to know whether a refresh is needed.
      watchProviders: {
        free:     providerObjs(usProviders.free,     4),
        flatrate: providerObjs(usProviders.flatrate, 4),
        rent:     providerObjs(usProviders.rent,     3),
        buy:      providerObjs(usProviders.buy,      3),
      },
      wpLink:    usProviders.link || null,
      wpCountry: 'US',
      reviews,
      enriched:  true,
      isTV:      false,
    };
  } catch (err) {
    console.error(`[enrich] ${raw.id} failed: ${err.message}`);
    return basicMovie(raw);
  }
}

/* ─── Helpers ─────────────────────────────────────────────── */

function basicMovie(m) {
  return {
    id:        m.id,
    title:     m.title || '',
    titleOrig: m.original_title || '',
    year:      (m.release_date || '').slice(0, 4) || null,
    genreIds:  m.genre_ids || [],
    poster:    m.poster_path   || null,
    backdrop:  m.backdrop_path || null,
    tmdbScore: m.vote_average ? +m.vote_average.toFixed(1) : null,
    tmdbVotes: m.vote_count   || 0,
    castPhotos: [],
    enriched:  false,
    isTV:      false,
  };
}

function providerObjs(arr, limit = 4) {
  return (arr || []).slice(0, limit).map(p => ({
    provider_id:   p.provider_id,
    provider_name: p.provider_name,
    logo_path:     p.logo_path || null,
  }));
}

// TMDB reviews sometimes carry raw HTML (reviewers can use basic markup) and
// literal \r\n — strip/collapse both. Mirrors _cleanReviewText/_pickReviews
// in index.html (same shape, same filtering logic) but this is a separate
// file/runtime so it can't share the function directly.
function cleanReviewText(text) {
  return (text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickReviews(rawResults) {
  return (rawResults || [])
    .map(r => ({
      author:  r.author_details?.name || r.author || '',
      rating:  typeof r.author_details?.rating === 'number' ? r.author_details.rating : null,
      // Cap stored length well above the ~120 chars ever displayed (the
      // client truncates at render time) — no reason to bake essay-length
      // reviews into KV when only a one-line snippet is ever shown.
      content: cleanReviewText(r.content).slice(0, 300),
      url:     r.url || null,
    }))
    .filter(r => r.author && r.content.length >= 15)
    .sort((a, b) => (b.rating != null ? 1 : 0) - (a.rating != null ? 1 : 0) || b.content.length - a.content.length)
    .slice(0, 5);
}

function tmdbUrl(env, path, params = {}) {
  const u = new URL(TMDB_BASE + path);
  u.searchParams.set('api_key', env.TMDB_KEY);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

// Fetch JSON with retry on 429 / 5xx
async function fetchJSON(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'FindFilm.ai-Sync/1.0' } });
      if (r.ok) return r.json();
      if (attempt === 0) console.error(`[fetch] HTTP ${r.status}`);
      const retryable = r.status === 429 || r.status >= 500;
      if (!retryable) return null;
      const after = parseInt(r.headers.get('Retry-After') || '0', 10);
      await sleep(after > 0 ? after * 1000 : RETRY_DELAY_MS * (attempt + 1));
    } catch (err) {
      if (attempt === 0) console.error(`[fetch] ${err.message}`);
      if (attempt < retries - 1) await sleep(RETRY_DELAY_MS);
    }
  }
  return null;
}

async function writeMeta(env, extra = {}) {
  const existing = JSON.parse(await env.MOVIES_CACHE.get('last-sync').catch(() => 'null') || 'null') || {};
  await env.MOVIES_CACHE.put('last-sync', JSON.stringify({
    ...existing,
    ...extra,
    updatedAt: new Date().toISOString(),
  }), { expirationTtl: KV_TTL_SEC });
}

function isoDate(d) { return d.toISOString().split('T')[0]; }
function sleep(ms)   { return new Promise(r => setTimeout(r, ms)); }
