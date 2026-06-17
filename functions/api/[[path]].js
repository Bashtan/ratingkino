/**
 * Cloudflare Pages Function — API proxy + cache reader + AI search
 *
 * Routes:
 *   /api/tmdb/*        → api.themoviedb.org/3/*   (injects TMDB_KEY secret)
 *   /api/omdb          → www.omdbapi.com           (injects OMDB_KEY secret)
 *   /api/cache/popular      → KV: pre-enriched popular movies (100)
 *   /api/cache/new-releases → KV: movies released in the last 30 days
 *   /api/cache/random-pool  → KV: 500 lightweight movies for roulette
 *   /api/cache/status       → KV: last sync timestamp + stats
 *   /api/ai-search     → Cloudflare AI semantic search over KV catalog
 *
 * API keys and KV are stored as Cloudflare Pages secrets/bindings —
 * never exposed in HTML source.
 */
export async function onRequest({ request, env, params }) {
  const url  = new URL(request.url);
  const path = '/' + (params.path || []).join('/');

  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  /* ── /api/cache/* ── serve pre-fetched data from KV ── */
  if (path.startsWith('/cache/')) {
    return handleCache(path.slice('/cache/'.length), env, cors);
  }

  /* ── /api/ai-search ── semantic movie search via Cloudflare AI ── */
  if (path === '/ai-search') {
    return handleAISearch(request, env, cors);
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

/* ─── AI semantic search handler ───────────────────────────── */

async function handleAISearch(request, env, cors) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let query;
  try {
    const body = await request.json();
    query = (body.query || '').trim().slice(0, 300); // cap query length
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!query) return json({ error: 'Missing query' }, 400);

  if (!env.MOVIES_CACHE) {
    return json({ error: 'Cache not available', hint: 'Run sync-worker first' }, 503);
  }

  const cached = await env.MOVIES_CACHE.get('new-releases');
  if (!cached) {
    return json({ error: 'Movie cache empty', hint: 'Daily sync has not run yet' }, 404);
  }

  const movies = JSON.parse(cached);

  // Build a compact catalog string for the LLM
  const catalog = movies.map(m => {
    const genres = (m.genres || []).join(', ');
    const desc   = (m.desc || '').slice(0, 140).replace(/[|\n]/g, ' ');
    const dir    = m.director ? `Dir: ${m.director}. ` : '';
    return `${m.id}|${m.title} (${m.year || '?'})|${genres}|${dir}${desc}`;
  }).join('\n');

  const systemPrompt =
    'You are a movie recommendation assistant. ' +
    'Respond with valid JSON only — no markdown fences, no extra text.';

  const userPrompt =
    `User wants: "${query}"\n\n` +
    `Pick the best matching movies from this catalog ` +
    `(format: id|title (year)|genres|description):\n\n` +
    `${catalog}\n\n` +
    `Return JSON:\n` +
    `{\n` +
    `  "ids": [array of integer movie IDs, best match first, max 20],\n` +
    `  "message": null\n` +
    `}\n` +
    `If no movie is a strong match, still return the 3 closest IDs and set ` +
    `"message" to a short friendly explanation (e.g. "These recent releases are ` +
    `the closest to your request — our catalog is updated daily with new films."). ` +
    `Never return an empty ids array.`;

  if (!env.AI) {
    return json({ error: 'AI binding not configured — deploy to Cloudflare to enable' }, 503);
  }

  try {
    const aiResp = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      max_tokens:  400,
      temperature: 0.1,
      stream:      false,
    });

    // Normalize response — CF AI returns OpenAI-compatible format for this model
    let text = '';
    if (aiResp?.choices?.[0]?.message?.content) {
      // OpenAI-style: {choices:[{message:{content:"..."}}]}
      text = aiResp.choices[0].message.content;
    } else if (typeof aiResp?.response === 'string') {
      text = aiResp.response;
    } else if (typeof aiResp === 'string') {
      text = aiResp;
    } else {
      throw new Error(`Unexpected AI response: ${JSON.stringify(aiResp).slice(0, 200)}`);
    }
    text = text.trim();

    // Extract first JSON object from response (model sometimes adds preamble)
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in AI response');

    const result = JSON.parse(match[0]);

    // Validate: only return IDs that actually exist in our catalog
    const validIds = new Set(movies.map(m => m.id));
    const ids = (result.ids || [])
      .map(id => Number(id))
      .filter(id => Number.isInteger(id) && validIds.has(id))
      .slice(0, 20);

    return json({ ids, message: result.message || null });

  } catch (e) {
    console.error('[ai-search] error:', e.message);
    return json({ error: 'AI search failed', detail: e.message }, 500);
  }
}
