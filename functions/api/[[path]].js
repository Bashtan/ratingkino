/**
 * Cloudflare Pages Function — API proxy + cache reader
 *
 * Routes:
 *   /api/tmdb/*        → api.themoviedb.org/3/*   (injects TMDB_KEY secret)
 *   /api/omdb          → www.omdbapi.com           (injects OMDB_KEY secret)
 *   /api/cache/popular      → KV: pre-enriched popular movies (100)
 *   /api/cache/new-releases → KV: movies released in the last 30 days
 *   /api/cache/random-pool  → KV: 500 lightweight movies for roulette
 *   /api/cache/status       → KV: last sync timestamp + stats
 *
 * API keys and KV are stored as Cloudflare Pages secrets/bindings —
 * never exposed in HTML source.
 */
export async function onRequest({ request, env, params }) {
  const url  = new URL(request.url);
  const path = '/' + (params.path || []).join('/');

  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  /* ── /api/cache/* ── serve pre-fetched data from KV ── */
  if (path.startsWith('/cache/')) {
    return handleCache(path.slice('/cache/'.length), env, cors);
  }

  /* ── /api/tmdb/* ── proxy to TMDB ── */
  let upstreamUrl;

  if (path.startsWith('/tmdb/')) {
    const tmdbPath = path.replace('/tmdb', '');
    const upstream = new URL('https://api.themoviedb.org/3' + tmdbPath);
    url.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));
    upstream.searchParams.set('api_key', env.TMDB_KEY);
    upstreamUrl = upstream.toString();

  } else if (path === '/omdb') {
    const upstream = new URL('https://www.omdbapi.com/');
    url.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));
    upstream.searchParams.set('apikey', env.OMDB_KEY);
    upstreamUrl = upstream.toString();

  } else {
    return new Response('Not found', { status: 404, headers: cors });
  }

  const upstream = await fetch(upstreamUrl, {
    headers: { 'User-Agent': 'RatingKino/1.0' },
  });

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      ...cors,
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/* ─── KV cache handler ─────────────────────────────────────── */

const CACHE_KEYS = {
  popular:       'popular',
  'new-releases':'new-releases',
  'random-pool': 'random-pool',
  status:        'last-sync',
};

async function handleCache(key, env, cors) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });

  const kvKey = CACHE_KEYS[key];
  if (!kvKey) return json({ error: 'Unknown cache key' }, 404);

  // KV binding not configured (e.g. first deploy before wrangler.toml applies)
  if (!env.MOVIES_CACHE) {
    return json({ error: 'Cache not available yet', hint: 'Run sync-worker to populate' }, 503);
  }

  const cached = await env.MOVIES_CACHE.get(kvKey);
  if (!cached) {
    return json({
      error: 'Cache empty',
      hint:  'The daily sync has not run yet. Data will appear after 00:00 UTC.',
    }, 404);
  }

  return new Response(cached, {
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=1800', // 30-min browser cache
      ...cors,
    },
  });
}
