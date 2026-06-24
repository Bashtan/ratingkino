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
 *   /api/search        → two-step: TMDB /search/movie (title-first) + AI semantic fallback
 *   /api/ai-search     → Cloudflare AI semantic search over KV catalog (Enter-key mode)
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

  /* ── /api/search ── two-step: TMDB title search + AI semantic fallback ── */
  if (path === '/search') {
    return handleSearch(request, env, cors);
  }

  /* ── /api/ai-search ── semantic movie search via Cloudflare AI ── */
  if (path === '/ai-search') {
    return handleAISearch(request, env, cors);
  }

  /* ── /api/geo-lang ── detect language from visitor country ── */
  if (path === '/geo-lang') {
    const country = request.cf?.country || '';
    const ES_COUNTRIES = ['ES','MX','AR','CO','CL','PE','VE','EC','BO','PY','UY','CR','PA','DO','HN','SV','GT','NI','CU','PR'];
    const FR_COUNTRIES = ['FR','BE','CH','LU','MC','SN','CI','ML','BF','NE','TD','CM','MG','RW','BJ','TG','GA','CD','CG','CF','GN','MR','DJ','KM','VU','SC','MU','HT','GF','GP','MQ','NC','PF','RE'];
    const ZH_COUNTRIES = ['CN','TW','HK','MO','SG'];
    const AR_COUNTRIES = ['SA','AE','EG','IQ','SY','JO','LB','KW','QA','BH','OM','YE','LY','TN','DZ','MA','SD','SO','PS','MR','DJ','KM'];
    let lang = 'en';
    if (country === 'UA')                      lang = 'uk';
    else if (ZH_COUNTRIES.includes(country))   lang = 'zh';
    else if (AR_COUNTRIES.includes(country))   lang = 'ar';
    else if (FR_COUNTRIES.includes(country))   lang = 'fr';
    else if (ES_COUNTRIES.includes(country))   lang = 'es';
    return new Response(JSON.stringify({ lang, country }), {
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  /* ── /api/translate ── AI description translation via m2m100 ── */
  if (path === '/translate') {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { 'Content-Type': 'application/json', ...cors } });
    }
    let text, targetLang;
    try {
      ({ text, targetLang } = await request.json());
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors } });
    }
    if (!text || !targetLang || targetLang === 'en') {
      return new Response(JSON.stringify({ translated: text || '' }), { headers: { 'Content-Type': 'application/json', ...cors } });
    }
    // m2m100-1.2b language code map (ISO 639-1 codes supported by model)
    const LANG_CODES = { es: 'es', fr: 'fr', zh: 'zh', ar: 'ar', uk: 'uk' };
    const tgtCode = LANG_CODES[targetLang];
    if (!tgtCode) {
      return new Response(JSON.stringify({ translated: text }), { headers: { 'Content-Type': 'application/json', ...cors } });
    }
    if (!env.AI) {
      return new Response(JSON.stringify({ translated: text, error: 'AI binding not available' }), { headers: { 'Content-Type': 'application/json', ...cors } });
    }
    try {
      // Truncate long descriptions to avoid hitting token limits
      const input = text.slice(0, 1000);
      const result = await env.AI.run('@cf/meta/m2m100-1.2b', {
        text: input,
        source_lang: 'en',
        target_lang: tgtCode,
      });
      const translated = result?.translated_text || text;
      return new Response(JSON.stringify({ translated }), {
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    } catch (e) {
      // Fallback: return original text so the UI stays functional
      return new Response(JSON.stringify({ translated: text, error: e.message }), {
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
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
    headers: { 'User-Agent': 'FindFilm.ai/1.0' },
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

/* ─── 3-Tier waterfall search ──────────────────────────────── */
/*
 * Strict rendering order returned to the client:
 *
 *   Tier 1 — Title match
 *     query (lowercased) is a substring of title OR original_title.
 *     Within Tier 1 a fine-grained score sub-sorts: exact > prefix >
 *     all-words > any-word, so "Batman" ranks above "Batman v Superman"
 *     for query "batman".
 *
 *   Tier 2 — Overview/description match
 *     query is a substring of the TMDB overview field.
 *     e.g. query "batman" → overview "...the caped crusader Batman fights..."
 *
 *   Tier 2b — TMDB other matches (cast, crew, keywords)
 *     TMDB searched and returned these but neither title nor overview
 *     contains the query string.  Kept between T2 and AI to preserve
 *     TMDB relevance without burying it.
 *
 *   Tier 3 — AI KV semantic
 *     Llama 3.3-70B thematic matches from the 119-movie KV catalog.
 *     Only appended on page 1 when Tier 1 is thin (< 3 hits), meaning
 *     the query is probably descriptive rather than a title.
 *     Non-English queries are translated to English first (m2m100-1.2b)
 *     because the KV catalog and model are English-centric.
 *
 * TMDB and the AI semantic search run concurrently via Promise.all.
 * lang param flows through to TMDB so responses come back localised.
 * Response shape is TMDB-compatible — loadMovies() needs no changes.
 */

const _TITLE_MATCH_THRESHOLD = 3;  // below this T1 count, append T3 semantic
const _SEMANTIC_WORD_MIN     = 3;  // query must have ≥ this many words for T3

// Validated BCP-47 language codes accepted from the client
const _VALID_LANGS = new Set([
  'en-US','es-ES','fr-FR','zh-CN','ar-SA','uk-UA',
  'de-DE','it-IT','pt-BR','ja-JP','ko-KR','ru-RU','pl-PL','nl-NL',
]);
// m2m100 source codes for the site's non-English languages
const _M2M_LANG = { uk:'uk', es:'es', fr:'fr', zh:'zh', ar:'ar' };

/* Fine-grained title score used for within-Tier-1 sub-sorting only.
 * 8 = exact title, 7 = prefix, 6 = all words in title, 5 = all in either,
 * 4 = any word in either. 0 = no title match. */
function _serverTitleScore(movie, q, words) {
  const t1 = (movie.title          || '').toLowerCase();
  const t2 = (movie.original_title || '').toLowerCase();
  if (t1 === q || t2 === q)                                return 8;
  if (t1.startsWith(q) || t2.startsWith(q))               return 7;
  if (words.every(w => t1.includes(w)))                    return 6;
  if (words.every(w => t1.includes(w) || t2.includes(w))) return 5;
  if (words.some(w  => t1.includes(w) || t2.includes(w))) return 4;
  return 0;
}

async function handleSearch(request, env, cors) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });

  const url     = new URL(request.url);
  const query   = (url.searchParams.get('q') || '').trim().slice(0, 200);
  const page    = Math.max(1, Math.min(500, parseInt(url.searchParams.get('page') || '1', 10)));
  const type    = url.searchParams.get('type') === 'tv' ? 'tv' : 'movie';
  const rawLang = (url.searchParams.get('lang') || 'en-US').trim();
  const lang    = _VALID_LANGS.has(rawLang) ? rawLang : 'en-US';

  if (!query) return json({ results: [], total_results: 0, total_pages: 0, page });

  const q        = query.toLowerCase();
  const words    = q.split(/\s+/).filter(Boolean);
  const langCode = lang.split('-')[0]; // 'uk-UA' → 'uk'

  // Long queries (≥ 3 words) are potentially descriptive — enable semantic fallback.
  const isLongQuery     = words.length >= _SEMANTIC_WORD_MIN;
  const mayNeedSemantic =
    page === 1 && type === 'movie' && isLongQuery && !!env.AI && !!env.MOVIES_CACHE;

  // ── Fire TMDB fetch immediately (don't wait for translation) ──────────
  const tmdbUrl = new URL(`https://api.themoviedb.org/3/search/${type}`);
  tmdbUrl.searchParams.set('api_key',       env.TMDB_KEY);
  tmdbUrl.searchParams.set('query',         query);
  tmdbUrl.searchParams.set('page',          String(page));
  tmdbUrl.searchParams.set('language',      lang);    // localised response titles/overviews
  tmdbUrl.searchParams.set('include_adult', 'false');
  const tmdbPromise = fetch(tmdbUrl.toString(), { headers: { 'User-Agent': 'FindFilm.ai/1.0' } })
    .then(r => { if (!r.ok) throw new Error(`TMDB ${r.status}`); return r.json(); });

  // ── Translate query to English for semantic step (runs while TMDB is in flight) ──
  // m2m100 is fast (~200 ms); by the time it finishes TMDB may still be pending.
  const needsTranslation = langCode !== 'en' && !!_M2M_LANG[langCode] && !!env.AI;
  let englishQuery = query;
  if (mayNeedSemantic && needsTranslation) {
    englishQuery = await _translateToEnglish(query, _M2M_LANG[langCode], env);
    console.log(`[search:translate] "${query.slice(0, 60)}" → "${englishQuery.slice(0, 60)}" (${langCode}→en)`);
  }

  // ── Start KV semantic search (still overlaps with TMDB network time) ────
  // Dedup against TMDB results happens after Promise.all — excludeIds not yet known.
  const semanticPromise = mayNeedSemantic
    ? runKVSemanticSearch(englishQuery, env, new Set())
    : Promise.resolve([]);

  // ── Await both concurrently ───────────────────────────────────────────
  let searchData, semanticRaw;
  try {
    [searchData, semanticRaw] = await Promise.all([tmdbPromise, semanticPromise]);
  } catch (e) {
    console.error(`[search:error] q="${query.slice(0, 80)}" ${e.message}`);
    return json({ error: 'Search failed', detail: e.message }, 502);
  }

  // ── 3-Tier bucketing ─────────────────────────────────────────────────
  //
  // seenIds is built incrementally as each movie is placed into a tier.
  // This guarantees strict dedup: a movie placed in Tier 1 is added to seenIds
  // immediately and cannot appear in Tier 2, Tier 2b, or Tier 3.
  // TMDB occasionally returns the same id twice on adjacent pages — the
  // seenIds.has() guard at the top of the loop drops those silently.
  //
  // Tier 1:  query ⊂ title or original_title (case-insensitive substring).
  //          Sub-sorted by _serverTitleScore: exact > prefix > all-words > any-word.
  //
  // Tier 2:  query ⊂ overview/description field.
  //
  // Tier 2b: TMDB cast/crew/keyword match — no text hit in title or overview.
  //          Kept here (not discarded) — TMDB's relevance signal is still useful.
  //
  // Tier 3:  AI KV semantic extras. Only appended on page 1 when Tier 1 is thin
  //          (< _TITLE_MATCH_THRESHOLD), indicating a descriptive rather than
  //          title-based query. Strictly deduplicated against seenIds.

  const rawResults = searchData.results || [];
  const seenIds    = new Set();   // grows as we assign movies to tiers
  const tier1 = [], tier2 = [], tier2b = [];

  for (const m of rawResults) {
    // Drop duplicates — TMDB can return the same id on adjacent result pages.
    if (seenIds.has(m.id)) continue;
    seenIds.add(m.id);

    const t1 = (m.title          || '').toLowerCase();
    const t2 = (m.original_title || '').toLowerCase();
    const ov = (m.overview       || '').toLowerCase();

    if (t1.includes(q) || t2.includes(q)) {
      tier1.push(m);
    } else if (ov.includes(q)) {
      tier2.push(m);
    } else {
      tier2b.push(m);
    }
  }

  // Sub-sort Tier 1 by match specificity (exact > prefix > all-words > any-word).
  // Ties preserve TMDB's original (popularity-weighted) order via a stable sort.
  tier1.sort((a, b) => _serverTitleScore(b, q, words) - _serverTitleScore(a, q, words));

  // ── Tier 3: semantic fallback ─────────────────────────────────────────
  // Only attach when Tier 1 is thin — that signals a descriptive/vibe query.
  // If the query is short (<3 words), semanticRaw is [] so tier3 stays empty.
  // Guard with || [] so a null/undefined semanticRaw never throws.
  const useSemantic = tier1.length < _TITLE_MATCH_THRESHOLD;
  const tier3 = useSemantic
    ? (semanticRaw || []).filter(m => !seenIds.has(m.id))
    : [];

  // ── Production log — visible in: wrangler pages deployment tail ──────
  console.log(
    `[search] q="${query.slice(0, 80)}" lang=${lang} page=${page} type=${type}` +
    ` | T1:${tier1.length} T2:${tier2.length} T2b:${tier2b.length} T3:${tier3.length}` +
    ` | semantic=${useSemantic} words=${words.length}` +
    ` | total=${tier1.length + tier2.length + tier2b.length + tier3.length}`
  );

  return json({
    results:       [...tier1, ...tier2, ...tier2b, ...tier3],
    total_results: searchData.total_results || rawResults.length,
    total_pages:   searchData.total_pages   || 1,
    page,
    // Debug fields — visible in network tab and wrangler tail logs
    _tiers: { t1: tier1.length, t2: tier2.length, t2b: tier2b.length, t3: tier3.length },
  });
}

/* Translate a short query to English using m2m100 (same model as desc translation).
 * Returns the original string on any failure — never breaks the search. */
async function _translateToEnglish(text, sourceLang, env) {
  try {
    const result = await env.AI.run('@cf/meta/m2m100-1.2b', {
      text:        text.slice(0, 200),
      source_lang: sourceLang,
      target_lang: 'en',
    });
    return (result?.translated_text || text).trim() || text;
  } catch {
    return text;
  }
}

/* Run a quick LLM search over the KV movie catalog for thematic matches.
 * Returns movies in TMDB-compatible shape so the client can process them
 * without any special casing. */
async function runKVSemanticSearch(query, env, excludeIds) {
  try {
    const cached = await env.MOVIES_CACHE.get('new-releases');
    if (!cached) {
      console.log('[semantic] KV new-releases empty — returning []');
      return [];
    }

    const movies     = JSON.parse(cached);
    const candidates = movies.filter(m => !excludeIds.has(m.id));
    if (!candidates.length) {
      console.log('[semantic] all candidates excluded — returning []');
      return [];
    }
    console.log(`[semantic] q="${query.slice(0, 60)}" catalog=${candidates.length} movies`);

    const catalog = candidates.map(m => {
      const genres    = (m.genres || []).join(', ');
      const desc      = (m.desc   || '').slice(0, 120).replace(/[|\n]/g, ' ');
      const dir       = m.director ? `Dir: ${m.director}. ` : '';
      const titlePart = (m.titleOrig && m.titleOrig !== m.title)
        ? `${m.title} / ${m.titleOrig}` : m.title;
      return `${m.id}|${titlePart} (${m.year || '?'})|${genres}|${dir}${desc}`;
    }).join('\n');

    const aiResp = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        {
          role:    'system',
          content: 'You are a movie recommendation engine. Respond with valid JSON only, no markdown.',
        },
        {
          role:    'user',
          content:
            `Query: "${query}"\n\n` +
            `Find up to 5 movies from this catalog that thematically match the query. ` +
            `Do NOT include movies just because their title contains the query words.\n\n` +
            `Catalog (id|title (year)|genres|description):\n${catalog}\n\n` +
            `Return JSON: {"ids": [integer IDs, best match first]}\n` +
            `If none match well, return {"ids": []}`,
        },
      ],
      max_tokens:  120,
      temperature: 0.1,
      stream:      false,
    });

    let text = '';
    if (aiResp?.choices?.[0]?.message?.content) text = aiResp.choices[0].message.content;
    else if (typeof aiResp?.response === 'string') text = aiResp.response;

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];

    const { ids } = JSON.parse(match[0]);
    const validIds = new Set(movies.map(m => m.id));
    const filtered = (ids || [])
      .map(Number)
      .filter(id => Number.isInteger(id) && validIds.has(id) && !excludeIds.has(id))
      .slice(0, 5);

    // Convert KV movie shape → TMDB-compatible shape
    console.log(`[semantic] LLM returned ${filtered.length} ids: [${filtered.join(', ')}]`);
    const byId = new Map(movies.map(m => [m.id, m]));
    return filtered.map(id => {
      const m = byId.get(id);
      return {
        id,
        title:          m.title,
        original_title: m.titleOrig || m.title,
        release_date:   m.year ? `${m.year}-01-01` : '',
        poster_path:    m.poster
          ? m.poster.replace(/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+/, '')
          : null,
        backdrop_path:  m.backdrop
          ? m.backdrop.replace(/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+/, '')
          : null,
        vote_average:   m.tmdbScore  || 0,
        vote_count:     m.tmdbVotes  || 0,
        overview:       m.desc       || '',
        genre_ids:      m.genreIds   || [],
        _semantic:      true,   // marker — not used by client but useful for debugging
      };
    });

  } catch (e) {
    console.error('[semantic-fallback]', e.message);
    return [];   // never break the main search on semantic failure
  }
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
  // Format: id|title/orig (year)|genres|Dir: name. description
  const catalog = movies.map(m => {
    const genres    = (m.genres || []).join(', ');
    const desc      = (m.desc || '').slice(0, 140).replace(/[|\n]/g, ' ');
    const dir       = m.director ? `Dir: ${m.director}. ` : '';
    // Include original title when it differs (helps with non-English title matches)
    const titlePart = m.titleOrig && m.titleOrig !== m.title
      ? `${m.title} / ${m.titleOrig}`
      : m.title;
    return `${m.id}|${titlePart} (${m.year || '?'})|${genres}|${dir}${desc}`;
  }).join('\n');

  const systemPrompt =
    'You are a movie search engine. ' +
    'Respond with valid JSON only — no markdown fences, no extra text. ' +
    'Rank results by this strict priority: ' +
    '(1) movies whose TITLE contains the query words — rank these FIRST; ' +
    '(2) movies whose DESCRIPTION or TAGLINE matches — rank these SECOND; ' +
    '(3) thematic, genre, or mood similarity — rank these LAST.';

  const userPrompt =
    `User query: "${query}"\n\n` +
    `MANDATORY ranking order:\n` +
    `  Tier 1 — title match: if any movie title contains the query words, it MUST appear before all others.\n` +
    `  Tier 2 — description match: query words found in the description/overview.\n` +
    `  Tier 3 — thematic/genre match: general similarity in mood, genre, or story.\n\n` +
    `Catalog (format: id|title/orig (year)|genres|description):\n\n` +
    `${catalog}\n\n` +
    `Return JSON:\n` +
    `{\n` +
    `  "ids": [integer movie IDs ordered best-match first, max 20],\n` +
    `  "message": null\n` +
    `}\n` +
    `If no movie is a close match, return the 3 nearest IDs and set "message" to a ` +
    `short friendly note (e.g. "These are the closest recent releases to your request."). ` +
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
