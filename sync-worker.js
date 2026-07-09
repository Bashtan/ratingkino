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
 *
 * NOTE: OMDb ratings are skipped because:
 *   a) each OMDb call consumes a subrequest (counts against the 50 limit)
 *   b) the OMDb free key allows 1000 req/day — easily exceeded with 119 movies
 *   c) brand-new 2026 releases often don't have OMDb entries yet
 *   To re-enable: upgrade to Cloudflare Workers Standard ($5/mo, 1000 subreqs)
 *   then restore the OMDb block in enrichOne().
 */

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

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    if      (cron === '55 23 * * *') ctx.waitUntil(syncPhase0(env));
    else if (cron === '0 0 * * *')   ctx.waitUntil(syncPhase1(env));
    else if (cron === '5 0 * * *')   ctx.waitUntil(syncPhase2(env));
    else if (cron === '10 0 * * *')  ctx.waitUntil(syncPhase3(env));
  },

  // Manual trigger: GET /sync-now?phase=popular|0|1|2
  // Each phase returns immediately; poll /api/cache/status to track progress.
  async fetch(request, env, ctx) {
    const url   = new URL(request.url);
    const phase = url.searchParams.get('phase') ?? '0';
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
        append_to_response: 'credits,external_ids,videos,watch/providers',
        language: 'en-US',
      })
    );
    if (!detail?.id) return basicMovie(raw);

    const imdbId      = detail.external_ids?.imdb_id || null;
    const director    = (detail.credits?.crew || []).find(c => c.job === 'Director')?.name || null;
    const actors      = (detail.credits?.cast || []).slice(0, 5).map(c => c.name);
    const castPhotos  = (detail.credits?.cast || []).slice(0, 2).map(c => ({
      name:  c.name,
      photo: c.profile_path ? `https://image.tmdb.org/t/p/w45${c.profile_path}` : null,
    }));
    const trailerKey  = (detail.videos?.results || [])
                          .find(v => v.type === 'Trailer' && v.site === 'YouTube')?.key || null;
    const trailer     = trailerKey ? `https://www.youtube.com/embed/${trailerKey}` : null;
    const usProviders = detail['watch/providers']?.results?.US || {};
    const genres      = (detail.genres || []).map(g => g.name);

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
      // Watch providers (US)
      watchProviders: {
        free:     providerObjs(usProviders.free,     4),
        flatrate: providerObjs(usProviders.flatrate, 4),
        rent:     providerObjs(usProviders.rent,     3),
      },
      wpLink:   usProviders.link || null,
      enriched: true,
      isTV:     false,
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
