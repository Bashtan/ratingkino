/**
 * Cloudflare Pages Function — API proxy
 * Routes:
 *   /api/tmdb/*   → api.themoviedb.org/3/*   (injects TMDB_KEY secret)
 *   /api/omdb     → www.omdbapi.com           (injects OMDB_KEY secret)
 *
 * Keys are stored as Cloudflare Pages secrets — never exposed in HTML source.
 */
export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const path = '/' + (params.path || []).join('/');

  // CORS headers for same-origin Pages deployment
  const cors = {
    'Access-Control-Allow-Origin': 'https://ratingkino.com',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  let upstreamUrl;

  if (path.startsWith('/tmdb/')) {
    const tmdbPath = path.replace('/tmdb', '');
    const upstream = new URL('https://api.themoviedb.org/3' + tmdbPath);
    // Copy all query params from client request
    url.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));
    // Inject secret key
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
