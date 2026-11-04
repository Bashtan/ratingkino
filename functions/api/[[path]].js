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
 *   /api/watchmode/sources → api.watchmode.com/v1/title/{type}-{tmdb_id}/sources/
 *                            (injects WATCHMODE_API_KEY secret; region-resolved server-side)
 *   /api/reddit/reviews   → oauth.reddit.com/search, official OAuth2 client_credentials
 *                           (injects REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET; KV-cached 36h/movie)
 *   /api/rx/<movie|tv>/<id> → KV: FF Bot's arc for the title's trailer (sync-worker.js, nightly)
 *
 * API keys and KV are stored as Cloudflare Pages secrets/bindings —
 * never exposed in HTML source.
 */

// Shared by the /tmdb/* proxy and /watchmode/sources — resolves the visitor's
// region with the same priority everywhere: Cloudflare's edge geo-IP
// (request.cf.country — authoritative, can't be spoofed by client JS) → the
// client's own best-guess hint (`client_region`, derived client-side from UI
// language / browser locale — see tmdbGet() in index.html) → US.
function _resolveRegion(request, url) {
  return request.cf?.country || url.searchParams.get('client_region') || 'US';
}
export async function onRequest({ request, env, params, waitUntil }) {
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

  /* ── /api/watchmode/sources ── Watchmode streaming sources, merged with
     TMDB client-side (see index.html) for max provider coverage ── */
  if (path === '/watchmode/sources') {
    return handleWatchmodeSources(request, url, env, cors);
  }

  /* ── /api/reddit/reviews ── official Reddit API, OAuth2 client_credentials ── */
  if (path === '/reddit/reviews') {
    return handleRedditReviews(request, url, env, cors, waitUntil);
  }

  /* ── /api/search ── two-step: TMDB title search + AI semantic fallback ── */
  if (path === '/search') {
    return handleSearch(request, env, cors, waitUntil);
  }

  /* ── /api/title-search ── Cinematic's exact title search, AI fixes typos and languages ── */
  if (path === '/title-search') {
    return handleTitleSearch(url, env, cors, waitUntil);
  }

  /* ── /api/ai-search ── semantic movie search via Cloudflare AI ── */
  if (path === '/ai-search') {
    return handleAISearch(request, env, cors, waitUntil);
  }

  /* ── /api/vibe-search ── semantic search over our own Vectorize catalog
     (the AI panel uses it only behind its ?vibe=1 flag; see handleVibeSearch) ── */
  if (path === '/vibe-search') {
    return handleVibeSearch(request, url, env, cors, waitUntil);
  }

  /* ── /api/vibe-check ── photo/music → vibe translation → movie curation ── */
  if (path === '/vibe-check') {
    return handleVibeCheck(request, env, cors, waitUntil);
  }

  /* ── /api/taste-dna ── aggregated ratings → cinematic personality JSON ── */
  if (path === '/taste-dna') {
    return handleTasteDna(request, env, cors);
  }

  /* ── /api/group-picker ── taste-overlap picks for a group via Cloudflare AI ── */
  if (path === '/group-picker') {
    return handleGroupPicker(request, env, cors, waitUntil);
  }

  /* ── /api/rx/<movie|tv>/<id> ── FF Bot's arc for a title's trailer ── */
  const rx = path.match(/^\/rx\/(movie|tv)\/(\d{1,9})$/);
  if (rx) {
    return handleRx(rx[1], rx[2], env, cors);
  }

  /* ── /api/fit-summary ── spoiler-free "who's it for" summary (KV-cached) ── */
  if (path === '/fit-summary') {
    return handleFitSummary(request, env, cors, waitUntil);
  }

  /* ── /api/pitch ── "Movie Pitch": shared voting + comments (D1-backed) ── */
  if (path === '/pitch' && request.method === 'POST') {
    return handlePitchCreate(request, env, cors);
  }
  if (path.startsWith('/pitch/')) {
    return handlePitchSub(path.slice('/pitch/'.length), request, env, cors);
  }

  /* ── /api/geo-lang ── detect language from visitor country ── */
  if (path === '/geo-lang') {
    const country = request.cf?.country || '';
    const ES_COUNTRIES = ['ES','MX','AR','CO','CL','PE','VE','EC','BO','PY','UY','CR','PA','DO','HN','SV','GT','NI','CU','PR'];
    const FR_COUNTRIES = ['FR','BE','LU','MC','SN','CI','ML','BF','NE','TD','CM','MG','RW','BJ','TG','GA','CD','CG','CF','GN','MR','DJ','KM','VU','SC','MU','HT','GF','GP','MQ','NC','PF','RE'];
    const ZH_COUNTRIES = ['CN','TW','HK','MO','SG'];
    const AR_COUNTRIES = ['SA','AE','EG','IQ','SY','JO','LB','KW','QA','BH','OM','YE','LY','TN','DZ','MA','SD','SO','PS','MR','DJ','KM'];
    const DE_COUNTRIES = ['DE','AT','CH','LI'];
    const NO_COUNTRIES = ['NO'];
    const SV_COUNTRIES = ['SE'];
    let lang = 'en';
    if (country === 'UA')                      lang = 'uk';
    else if (DE_COUNTRIES.includes(country))   lang = 'de';
    else if (NO_COUNTRIES.includes(country))   lang = 'no';
    else if (SV_COUNTRIES.includes(country))   lang = 'sv';
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

    // ── Dynamic watch_region ──────────────────────────────────────────
    // An explicit `watch_region` already set by the caller always wins (none
    // of our own client code sets one directly — it only ever sends the
    // `client_region` hint below — so this only matters for direct/manual
    // API callers).
    //
    // Note: TMDB's watch/providers sub-resource (via append_to_response or
    // the dedicated /movie/{id}/watch/providers endpoint) ignores watch_region
    // and always returns every country's data in one response regardless —
    // the actual per-visitor region selection happens client-side (see
    // mergeMovieData() / _pickWatchProviders() in index.html), which is what
    // this value is really for on endpoints that DO honor it, e.g. /discover.
    if (!upstream.searchParams.has('watch_region')) {
      upstream.searchParams.set('watch_region', _resolveRegion(request, url));
    }
    upstream.searchParams.delete('client_region'); // internal hint, not a real TMDB param

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
 *     query (lowercased) is a substring of title OR original_title
 *     (TV shows: name OR original_name).
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
const _INTENT_WORD_MIN       = 4;  // invoke LLM intent only for ≥ 4-word queries
const _INTENT_MODEL          = '@cf/meta/llama-3.2-1b-instruct'; // 1B model — fast, valid CF AI ID, sufficient for structured JSON extraction

// TMDB genre name → numeric ID (for /discover/movie via LLM keyword hints)
const _GENRE_MAP = {
  action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80,
  documentary: 99, drama: 18, family: 10751, fantasy: 14, history: 36,
  horror: 27, music: 10402, mystery: 9648, romance: 10749,
  'science fiction': 878, 'sci-fi': 878, scifi: 878, thriller: 53,
  war: 10752, western: 37,
};

/**
 * Strip conversational filler phrases from voice-dictated or typed queries.
 *
 * Patterns are applied in a loop until stable — this handles chained fillers:
 *   "Umm, can you find me a movie about..." → "..."
 *   "Знайди мені фільм про..." (UK) → "..."
 *   "Busca una película sobre..." (ES) → "..."
 *   "Cherche un film avec..." (FR) → "..."
 *
 * Returns the trimmed result, or the original query if stripping would leave
 * fewer than 2 characters (safety: never produce an empty search).
 *
 * Zero latency — pure regex, no network call.
 */
function _stripFillers(raw) {
  const PATTERNS = [
    // ── English: hesitation sounds ─────────────────────────────────────
    /^(umm*|uhh*|er+|hmm+)[,\s]+/i,
    /^(ok|okay|alright|right|so|like|well|hey|yo)[,\s]+/i,
    // ── English: polite openers ────────────────────────────────────────
    /^(please\s+|can\s+you\s+|could\s+you\s+)/i,
    // ── English: action verbs + article ───────────────────────────────
    /^(find|show|search(\s+for)?|look\s+up|get|give\s+me|bring\s+up|pull\s+up)\s+(me\s+)?(a\s+|an\s+|the\s+|some\s+|that\s+)?/i,
    // ── English: "I am looking/searching for..." ───────────────────────
    /^i('m|\s+am)\s+(looking|searching)\s+for\s+(a\s+|an\s+|the\s+|that\s+)?/i,
    // ── English: "I want to watch/see/find..." ─────────────────────────
    /^i\s+(want|wanna|would\s+like)\s+(to\s+)?(watch|see|find)\s+(a\s+|an\s+|the\s+|that\s+)?/i,
    // ── English: "that movie/film/show where/about/with..." ────────────
    /^(that|the|a|an)\s+(movie|film|show|series|documentary)\s+(where|about|with|starring|called|named|that|when)\s+/i,
    // ── English: "movie where..." without article ──────────────────────
    /^(movie|film|show|series)\s+(where|about|with|starring|called|named)\s+/i,
    // ── Ukrainian ──────────────────────────────────────────────────────
    /^(знайди|покажи|відкрий|пошукай|запусти)\s+(мені\s+)?(фільм|серіал|кіно|шоу)\s*(про|де|з|який|яка|що|де\s+)?\s*/i,
    /^(я\s+шукаю|я\s+хочу\s+(подивитися|побачити|знайти))\s+(фільм|серіал|кіно)?\s*(про|де|з)?\s*/i,
    /^(можеш?\s+знайти|допоможи\s+знайти)\s+(мені\s+)?(фільм|серіал)?\s*/i,
    // ── Spanish ────────────────────────────────────────────────────────
    /^(busca|encuentra|muéstrame|dame|pon|ponme)\s+(me\s+)?(un[ao]?\s+|la\s+|el\s+)?(película|pelicula|serie|film)\s*(sobre|con|donde|que)?\s*/i,
    /^(estoy\s+buscando|quiero\s+(ver|encontrar|buscar))\s+(un[ao]?\s+|la\s+|el\s+)?(película|pelicula|serie)?\s*(sobre|con|donde)?\s*/i,
    // ── French ─────────────────────────────────────────────────────────
    /^(cherche|trouve|montre[- ]moi|affiche|mets)\s+(moi\s+)?(un[e]?\s+|le\s+|la\s+|les\s+)?(film|série|documentaire)\s*(sur|avec|où|qui)?\s*/i,
    /^(je\s+cherche|je\s+veux\s+(voir|trouver))\s+(un[e]?\s+|le\s+|la\s+)?(film|série)?\s*(sur|avec|où)?\s*/i,
  ];

  let q = raw.trim();
  let changed = true;
  // Loop so chained fillers ("Umm, can you find me a film about...") all get stripped.
  while (changed) {
    changed = false;
    for (const p of PATTERNS) {
      const next = q.replace(p, '').trim();
      if (next !== q && next.length >= 2) {
        q = next;
        changed = true;
        break; // restart from first pattern after each successful strip
      }
    }
  }
  return q;
}

/**
 * Call the 8B LLM to extract structured intent from the user's query.
 *
 * Returns a structured object or null on any failure.
 * Callers MUST treat null as "no intent data" and fall back to raw behaviour.
 *
 * The model is asked to return ONLY a JSON object — no markdown, no explanation.
 * If it hallucinates wrapping prose, the regex extracts the first {...} block.
 *
 * Runs concurrently with the initial TMDB fetch so it adds zero latency to
 * the hot path. Only invoked for queries with ≥ _INTENT_WORD_MIN words.
 */
async function _parseIntent(query, env) {
  try {
    const system =
      'You are a search-query intent parser for a movie discovery engine. Input may be typed or a ' +
      'raw voice-dictation transcript — voice input is often RAMBLING and UNSTRUCTURED: filler words ' +
      '("umm", "so", "like"), false starts, mid-sentence self-corrections, and long thinking pauses that ' +
      'produce run-on, repetitive phrasing. Look past the rambling and extract the underlying intent: the ' +
      'core narrative trope or premise, specific settings (era, location, world), unique or unusual plot ' +
      'devices (time loop, body swap, unreliable narrator, twist reveal, etc.), and character archetypes ' +
      'or relationships (rival siblings, disgraced detective, chosen one, found family). ' +
      'Return ONLY a valid JSON object — no markdown, no extra text. Fields: ' +
      '"clean_title_guess": if the user is searching for a specific movie title (with possible typos or ' +
      'in another language), normalise it to English; otherwise empty string. ' +
      '"english_keywords": the extracted narrative tropes, setting, plot devices, and character ' +
      'archetypes as a dense, comma-separated list of concrete English search terms (5-12 words total, ' +
      'e.g. "time loop, small town, disgraced detective, body swap, revenge plot"), not a restatement of ' +
      'the rambling sentence. ' +
      '"english_query": a CLEAN, well-formed English rewrite of the full request — strip filler, false ' +
      'starts and repetition, but preserve every plot detail, mood, and constraint the user actually ' +
      'described, reorganised into one or two coherent sentences. ALWAYS rewrite/clean this field, even ' +
      'when the input is already in English — never just repeat the raw rambling transcript verbatim. ' +
      '"intent": "title_search" if they want a specific movie, "vibe_search" if describing a theme, mood, ' +
      'or plot, "actor_search" if the query is specifically about movies featuring a particular real ' +
      'actor/actress. ' +
      '"actor_name": the actor/actress\'s name in English if intent is actor_search; otherwise empty string. ' +
      '"user_language": ISO 639-1 code of the input language.';

    const aiResp = await env.AI.run(_INTENT_MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: `Query: "${query.slice(0, 1000)}"` },
      ],
      max_tokens:  350,
      temperature: 0.1,
      stream:      false,
    });

    let text = '';
    if (aiResp?.choices?.[0]?.message?.content) text = aiResp.choices[0].message.content;
    else if (typeof aiResp?.response === 'string') text = aiResp.response;

    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);
    const intent =
      parsed.intent === 'vibe_search'  ? 'vibe_search'  :
      parsed.intent === 'actor_search' ? 'actor_search' : 'title_search';
    return {
      clean_title_guess: String(parsed.clean_title_guess || '').trim(),
      english_keywords:  String(parsed.english_keywords  || '').trim(),
      english_query:     String(parsed.english_query     || '').trim().slice(0, 600),
      intent,
      actor_name:        String(parsed.actor_name || '').trim(),
      user_language:     String(parsed.user_language     || 'en').trim().slice(0, 10),
    };
  } catch (e) {
    // Never break the search — null signals callers to use raw fallback.
    console.error(`[intent:parse] failed: ${e.message}`);
    return null;
  }
}

/**
 * Map a free-text keyword string to TMDB genre IDs using _GENRE_MAP.
 * e.g. "action thriller space" → [28, 53]
 * Returns an empty array if no genre matches — callers skip /discover in that case.
 */
function _keywordsToGenreIds(keywords) {
  if (!keywords) return [];
  const lower = keywords.toLowerCase();
  return [...new Set(
    Object.entries(_GENRE_MAP)
      .filter(([name]) => lower.includes(name))
      .map(([, id]) => id)
  )];
}

/**
 * Resolve a free-text actor name to their top movie credits via TMDB.
 * 2 TMDB calls total: /search/person then /person/{id}/movie_credits —
 * both already carry title/poster/overview/vote_average/release_date/genre_ids
 * so no per-movie detail fetch is needed.
 * Returns null if no matching person is found.
 */
async function _actorMovies(actorName, env) {
  const searchUrl = new URL('https://api.themoviedb.org/3/search/person');
  searchUrl.searchParams.set('api_key', env.TMDB_KEY);
  searchUrl.searchParams.set('query', actorName);
  const sr = await fetch(searchUrl.toString(), { headers: { 'User-Agent': 'FindFilm.ai/1.0' } });
  const sData = sr.ok ? await sr.json() : { results: [] };
  const person = (sData.results || [])[0];
  if (!person) return null;

  const creditsUrl = new URL(`https://api.themoviedb.org/3/person/${person.id}/movie_credits`);
  creditsUrl.searchParams.set('api_key', env.TMDB_KEY);
  const cr = await fetch(creditsUrl.toString(), { headers: { 'User-Agent': 'FindFilm.ai/1.0' } });
  const cData = cr.ok ? await cr.json() : { cast: [] };

  const movies = (cData.cast || [])
    .filter(m => m.poster_path && m.vote_count >= 20)
    .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
    .slice(0, 12);

  return { personId: person.id, personName: person.name, movies };
}

// Validated BCP-47 language codes accepted from the client
const _VALID_LANGS = new Set([
  'en-US','es-ES','fr-FR','zh-CN','ar-SA','uk-UA',
  'de-DE','it-IT','pt-BR','ja-JP','ko-KR','ru-RU','pl-PL','nl-NL',
]);
// m2m100 source codes for the site's non-English languages
const _M2M_LANG = { uk:'uk', es:'es', fr:'fr', zh:'zh', ar:'ar' };

/* Lower-cased [title, original title] of a TMDB search result. Movies carry
 * title / original_title; TV shows (/search/tv) carry name / original_name. */
function _resultTitles(m) {
  return [
    (m.title          || m.name          || '').toLowerCase(),
    (m.original_title || m.original_name || '').toLowerCase(),
  ];
}

/* Fine-grained title score used for within-Tier-1 sub-sorting only.
 * 8 = exact title, 7 = prefix, 6 = all words in title, 5 = all in either,
 * 4 = any word in either. 0 = no title match. */
function _serverTitleScore(movie, q, words) {
  const [t1, t2] = _resultTitles(movie);
  if (t1 === q || t2 === q)                                return 8;
  if (t1.startsWith(q) || t2.startsWith(q))               return 7;
  if (words.every(w => t1.includes(w)))                    return 6;
  if (words.every(w => t1.includes(w) || t2.includes(w))) return 5;
  if (words.some(w  => t1.includes(w) || t2.includes(w))) return 4;
  return 0;
}

async function handleSearch(request, env, cors, waitUntil) {
  const t0 = performance.now();
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

  // ── Step 1 (~0ms): Regex filler stripping ────────────────────────────
  // "Umm, find me a movie about..." → "..."
  // Handles English, Ukrainian, Spanish, French. Pure regex — zero latency.
  const effectiveQuery = _stripFillers(query);
  if (effectiveQuery !== query) {
    console.log(`[search:strip] "${query.slice(0, 80)}" → "${effectiveQuery.slice(0, 80)}"`);
  }

  const q        = effectiveQuery.toLowerCase();
  const words    = q.split(/\s+/).filter(Boolean);
  const langCode = lang.split('-')[0]; // 'uk-UA' → 'uk'

  // ── Step 2: TMDB /search/movie — fast, always fires ──────────────────
  // TMDB's multilingual index searches all title translations regardless
  // of the language param; language only controls the response locale.
  const tmdbSearchUrl = new URL(`https://api.themoviedb.org/3/search/${type}`);
  tmdbSearchUrl.searchParams.set('api_key',       env.TMDB_KEY);
  tmdbSearchUrl.searchParams.set('query',         effectiveQuery);
  tmdbSearchUrl.searchParams.set('page',          String(page));
  tmdbSearchUrl.searchParams.set('language',      lang);
  tmdbSearchUrl.searchParams.set('include_adult', 'false');

  let searchData;
  try {
    const r = await fetch(tmdbSearchUrl.toString(), { headers: { 'User-Agent': 'FindFilm.ai/1.0' } });
    if (!r.ok) throw new Error(`TMDB ${r.status}`);
    searchData = await r.json();
  } catch (e) {
    console.error(`[search:error] TMDB failed q="${query.slice(0, 80)}" ${e.message}`);
    return json({ error: 'Search failed', detail: e.message }, 502);
  }

  // ── Step 3: Bucket T1 / T2 / T2b ─────────────────────────────────────
  //
  // seenIds grows as each movie is placed — strict dedup across all tiers.
  //
  // Tier 1:  effectiveQuery ⊂ title or original_title (case-insensitive);
  //          TV results use name / original_name (see _resultTitles).
  //          Sub-sorted by _serverTitleScore: exact > prefix > all-words > any-word.
  // Tier 2:  effectiveQuery ⊂ overview/description.
  // Tier 2b: TMDB cast/crew/keyword match — no text hit in title or overview.

  const rawResults = searchData.results || [];
  const seenIds    = new Set();
  const tier1 = [], tier2 = [], tier2b = [];

  for (const m of rawResults) {
    if (seenIds.has(m.id)) continue;
    seenIds.add(m.id);

    const [t1, t2] = _resultTitles(m);
    const ov = (m.overview || '').toLowerCase();

    if (t1.includes(q) || t2.includes(q)) {
      tier1.push(m);
    } else if (ov.includes(q)) {
      tier2.push(m);
    } else {
      tier2b.push(m);
    }
  }

  tier1.sort((a, b) => _serverTitleScore(b, q, words) - _serverTitleScore(a, q, words));

  // ── Step 4: Conditional Tier 3 — only when T1 is thin ────────────────
  //
  // LLM is NEVER invoked for rich-T1 queries (e.g. "batman", "inception").
  // Two conditions must BOTH be true:
  //   A) T1 < _TITLE_MATCH_THRESHOLD  →  TMDB found no clear title match
  //   B) words >= _SEMANTIC_WORD_MIN  →  query is long enough to be descriptive
  //
  // When both are true, Tier 3 runs two sub-steps concurrently:
  //   3a. KV + Llama 70B semantic search over 119 curated movies (thematic)
  //   3b. LLM intent parse (8B) → genre IDs → TMDB /discover/movie (broad fallback)
  //       Only fires if _INTENT_WORD_MIN (≥ 5 words) — very long/complex queries.

  const useSemantic   = tier1.length < _TITLE_MATCH_THRESHOLD;
  const isLongQuery   = words.length >= _SEMANTIC_WORD_MIN;   // ≥ 3 words
  const isComplexQuery= words.length >= _INTENT_WORD_MIN;     // ≥ 5 words
  const tier3         = [];
  let   llmTriggered  = false;

  if (useSemantic && isLongQuery && page === 1 && type === 'movie') {
    // ── 3a: KV semantic ──────────────────────────────────────────────
    // Translate non-English queries to English first (m2m100).
    let englishQuery = effectiveQuery;
    if (env.AI && _M2M_LANG[langCode]) {
      const needsTranslation = langCode !== 'en';
      if (needsTranslation) {
        englishQuery = await _translateToEnglish(effectiveQuery, _M2M_LANG[langCode], env);
        console.log(`[search:translate] "${effectiveQuery.slice(0, 60)}" → "${englishQuery.slice(0, 60)}" (${langCode}→en)`);
      }
    }

    // ── 3b: LLM intent (concurrent with KV) ──────────────────────────
    // Only for complex queries (≥ 5 words) to extract genre hints for /discover.
    const kvPromise     = (env.AI && env.MOVIES_CACHE)
      ? runKVSemanticSearch(englishQuery, env, seenIds)
      : Promise.resolve([]);
    llmTriggered = isComplexQuery && !!env.AI;
    const intentPromise = llmTriggered
      ? _parseIntent(effectiveQuery, env)
      : Promise.resolve(null);

    const [kvHits, intent] = await Promise.all([kvPromise, intentPromise]);

    if (intent) {
      console.log(
        `[intent] intent=${intent.intent}` +
        ` clean="${intent.clean_title_guess.slice(0, 40)}"` +
        ` kw="${intent.english_keywords.slice(0, 60)}"`
      );
    }

    // Add KV semantic hits (strictly deduplicated against T1/T2/T2b)
    (kvHits || []).filter(m => !seenIds.has(m.id)).forEach(m => {
      seenIds.add(m.id);
      tier3.push(m);
    });

    // ── /discover/movie via genre IDs ────────────────────────────────
    // Source of genre keywords (priority order):
    //   1. LLM english_keywords (most accurate)
    //   2. Raw effectiveQuery words (fallback if LLM failed or not triggered)
    // Only fires when KV semantic returned < 3 results — broadest last-resort fallback.
    if (tier3.length < 3) {
      const keywordSource = intent?.english_keywords || effectiveQuery;
      const genreIds = _keywordsToGenreIds(keywordSource);
      if (genreIds.length > 0) {
        try {
          const discoverUrl = new URL('https://api.themoviedb.org/3/discover/movie');
          discoverUrl.searchParams.set('api_key',       env.TMDB_KEY);
          discoverUrl.searchParams.set('with_genres',   genreIds.join(','));
          discoverUrl.searchParams.set('sort_by',       'popularity.desc');
          discoverUrl.searchParams.set('language',      lang);
          discoverUrl.searchParams.set('include_adult', 'false');
          discoverUrl.searchParams.set('page',          '1');
          const discR = await fetch(discoverUrl.toString(), { headers: { 'User-Agent': 'FindFilm.ai/1.0' } });
          const discData = discR.ok ? await discR.json() : { results: [] };
          const discHits = (discData.results || []).filter(m => !seenIds.has(m.id)).slice(0, 5);
          discHits.forEach(m => { seenIds.add(m.id); tier3.push(m); });
          console.log(`[intent] discover genres=[${genreIds}] src="${keywordSource.slice(0, 40)}" → +${discHits.length}`);
        } catch (e) {
          // Non-fatal — KV semantic results still returned above.
          console.error(`[intent] discover failed: ${e.message}`);
        }
      }
    }
  }

  const totalResults = tier1.length + tier2.length + tier2b.length + tier3.length;
  const tierResolved = tier1.length  > 0 ? 'T1'
                     : tier2.length  > 0 ? 'T2'
                     : tier2b.length > 0 ? 'T2b'
                     : tier3.length  > 0 ? 'T3'
                     : 'none';

  // ── Production log — visible in: wrangler pages deployment tail ──────
  console.log(
    `[search] q="${effectiveQuery.slice(0, 80)}"${effectiveQuery !== query ? ` (was "${query.slice(0, 40)}")` : ''}` +
    ` lang=${lang} page=${page} type=${type}` +
    ` | T1:${tier1.length} T2:${tier2.length} T2b:${tier2b.length} T3:${tier3.length}` +
    ` | semantic=${useSemantic} words=${words.length} llm=${llmTriggered}` +
    ` | total=${totalResults} tier=${tierResolved}`
  );

  // ── Axiom non-blocking log ────────────────────────────────────────────
  // Fires AFTER the response is returned — zero latency impact on the user.
  // Guarded: silently skipped if AXIOM_API_TOKEN secret is not configured.
  if (waitUntil && env.AXIOM_API_TOKEN) {
    const logPayload = {
      event:             'search_executed',
      raw_query:         query,
      detected_language: langCode,
      tier_resolved:     tierResolved,
      results_count:     totalResults,
      execution_time_ms: Math.round(performance.now() - t0),
      llm_triggered:     llmTriggered,
    };
    waitUntil(
      fetch('https://api.axiom.co/v1/datasets/findfilm-logs/ingest', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${env.AXIOM_API_TOKEN}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify([logPayload]),
      })
        .then(res => {
          console.log(`[axiom] status=${res.status}`);
          if (!res.ok) return res.text().then(t => console.error(`[axiom] error: ${t}`));
        })
        .catch(e => console.error(`[axiom] fetch failed: ${e.message}`))
    );
  }

  return json({
    results:       [...tier1, ...tier2, ...tier2b, ...tier3],
    total_results: searchData.total_results || rawResults.length,
    total_pages:   searchData.total_pages   || 1,
    page,
    _tiers: { t1: tier1.length, t2: tier2.length, t2b: tier2b.length, t3: tier3.length },
    _query: effectiveQuery !== query ? { raw: query, effective: effectiveQuery } : undefined,
  });
}

/* ─── /api/title-search — Cinematic's search box: exact titles, AI-assisted ───
 * GET ?q=&type=movie|tv&lang=<TMDB locale>
 * 1. TMDB /search/{type} on the title as typed, plus the same title narrowed to a
 *    trailing year ("Dune 1984"). TMDB matches original, translated and alternative
 *    titles, so "Le Parrain" or "千と千尋の神隠し" are found here already. Ranked
 *    exact > prefix > all words > TMDB's own (a title in another language).
 * 2. No title with every word, or only obscure ones → the AI names the official title(s) the text means
 *    (typos, missing words, a transliteration, a title in another language). Those
 *    are searched and go first. `corrected` carries the top one's title in the page's
 *    language, for the "matched by AI" note, unless the text was part of that title. The AI's answer is cached for a
 *    week: tsr:v1:<sha-256 of type + normalised query>.
 *    Before the AI, a cheap exact check: well-known films TMDB matched only by another
 *    language's title whose translated title is exactly the text (_titleTranslated).
 * Response: { results (TMDB objects), corrected, via: 'ai' | 'translation' | null }. ?debug=1&fx=8b|70b skips the cache.
 */
const TITLE_FIX_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const _TITLE_FIX_SCHEMA = {
  type: 'object',
  properties: {
    titles: {
      type: 'array', maxItems: 3,
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, original: { type: 'string' }, year: { type: 'integer' } },
        required: ['title'],
      },
    },
  },
  required: ['titles'],
};
const _titleFixPrompt = type => {
  const what = type === 'tv' ? 'TV series' : 'film';
  return `You fix title searches on a ${what} site. The user typed the title of a real ${what}, often badly: ` +
    'typos (swapped, missing or doubled letters), missing words, a number for a sequel ("godfahter 2"), a ' +
    'transliteration, or a title in another language. A translated title is often not a literal translation: ' +
    'name the work released under that title in that language. ' +
    `Return the official title(s) it most likely means, best first, at most 3: "title" = the English title as listed ` +
    `on TMDB, "original" = the original-language title, "year" = the ${type === 'tv' ? 'first air' : 'release'} year. ` +
    `Only real ${what === 'film' ? 'films' : 'TV series'}. Return an empty list only when the text is clearly not a ` +
    'title: random letters, or just a person\'s name.';
};

// "Amélie", "AMELIE" and "amélie!" are one title; any script (accents and marks dropped).
function _titleKey(t) {
  return String(t || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
// A leading article doesn't make a different title: "Godfather" is "The Godfather". Only
// unambiguous ones: German "die" or Swedish "en" would make "Die Hard" the same as "Hard".
const _titleBare = k => k.replace(/^(the|a|an|le|la|les|l|el|los|las) /, '');

// 4 exact (articles aside) · 3 prefix · 2 every word · 1 TMDB's match (a title in another language).
function _titleScore(r, key) {
  if (!key) return 0;
  const names = [r.title || r.name, r.original_title || r.original_name].map(_titleKey).filter(Boolean);
  const bare = _titleBare(key);
  if (names.some(n => n === key || _titleBare(n) === bare)) return 4;
  if (names.some(n => n.startsWith(key + ' ') || _titleBare(n).startsWith(bare + ' ') || (key.length >= 4 && n.startsWith(key)))) return 3;
  const words = bare.split(' ');
  if (names.some(n => { const have = new Set(n.split(' ')); return words.every(w => have.has(w)); })) return 2;
  return 1;
}

async function _tmdbTitleSearch(type, query, year, lang, env) {
  const u = new URL(`https://api.themoviedb.org/3/search/${type}`);
  u.searchParams.set('api_key', env.TMDB_KEY);
  u.searchParams.set('query', query);
  u.searchParams.set('language', lang);
  u.searchParams.set('include_adult', 'false');
  if (year) u.searchParams.set(type === 'tv' ? 'first_air_date_year' : 'primary_release_year', String(year));
  const r = await fetch(u.toString(), { headers: { 'User-Agent': 'FindFilm.ai/1.0' } });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return (await r.json()).results || [];
}

// The best-first list for one wanted title: score, then the better-known film among equals.
function _titleRank(results, key, year) {
  const yearOf = r => parseInt((r.release_date || r.first_air_date || '').slice(0, 4), 10) || 0;
  return results
    .map((r, i) => ({ r, i, s: _titleScore(r, key) + (year && yearOf(r) === year ? 0.5 : 0) }))
    .sort((a, b) => b.s - a.s || (a.s >= 3 ? (b.r.vote_count || 0) - (a.r.vote_count || 0) : a.i - b.i));
}

// Well-known films TMDB found only by a title in another language ("Початок" → Inception, whose
// Ukrainian title it is, below "The Beginning"): the ones whose translated title is exactly the text.
async function _titleTranslated(type, ranked, key, env) {
  const bare = _titleBare(key);
  const pool = ranked.filter(x => x.s < 2 && (x.r.vote_count || 0) >= (type === 'tv' ? 100 : 300)).slice(0, 4);
  const hits = await Promise.all(pool.map(async ({ r }) => {
    try {
      const res = await fetch(`https://api.themoviedb.org/3/${type}/${r.id}/translations?api_key=${env.TMDB_KEY}`, { headers: { 'User-Agent': 'FindFilm.ai/1.0' } });
      const d = res.ok ? await res.json() : null;
      return (d?.translations || []).some(tr => {
        const k = _titleKey(tr.data?.title || tr.data?.name);
        return k && (k === key || _titleBare(k) === bare);
      }) ? r : null;
    } catch { return null; }
  }));
  return hits.filter(Boolean).sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
}

// The AI's reading of a title TMDB couldn't place: [{title, original, year}], [] for "not a title",
// null when the AI failed. Cached for a week (tsr:v1:<sha-256 of type + normalised text>).
async function _titleFixes(type, raw, key, { env, debug, waitUntil, model }) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${type}|${key}`)));
  const cacheKey = 'tsr:v1:' + [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
  if (!debug && env.MOVIES_CACHE) {
    const hit = await env.MOVIES_CACHE.get(cacheKey, 'json').catch(() => null);
    if (hit) return hit;
  }
  const out = await Promise.race([
    env.AI.run(model || TITLE_FIX_MODEL, {
      messages: [{ role: 'system', content: _titleFixPrompt(type) }, { role: 'user', content: raw }],
      response_format: { type: 'json_schema', json_schema: _TITLE_FIX_SCHEMA },
      max_tokens: 300,
      temperature: 0,
    }).then(_vibeJSON),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
  ]).catch(e => { console.error('[title-search] AI failed:', e.message); return null; });
  if (!out || !Array.isArray(out.titles)) return null;
  const fixes = out.titles
    .filter(f => f && typeof f.title === 'string' && f.title.trim())
    .slice(0, 3)
    .map(f => ({ title: f.title.trim().slice(0, 120), original: String(f.original || '').trim().slice(0, 120), year: Number.isInteger(f.year) ? f.year : null }));
  if (!debug && env.MOVIES_CACHE) {
    const w = env.MOVIES_CACHE.put(cacheKey, JSON.stringify(fixes), { expirationTtl: 7 * 86400 }).catch(() => {});
    if (waitUntil) waitUntil(w);
  }
  return fixes;
}

// Each title the AI named → its exact (else prefix) TMDB matches, in the AI's order.
async function _titleFixHits(type, fixes, lang, env) {
  const yearOf = r => parseInt((r.release_date || r.first_air_date || '').slice(0, 4), 10) || 0;
  const found = await Promise.all(fixes.map(async f => {
    const keys = [_titleKey(f.title), _titleKey(f.original)].filter(Boolean);
    const tries = [[f.title, f.year], [f.title, null]];
    if (f.original && keys[1] !== keys[0]) tries.push([f.original, null]);
    for (const [q, y] of tries) {
      const res = await _tmdbTitleSearch(type, q, y, lang, env).catch(() => []);
      const hits = res
        .map(r => ({ r, s: Math.max(...keys.map(k => _titleScore(r, k))) + (f.year && yearOf(r) === f.year ? 0.5 : 0) }))
        .filter(x => x.s >= 3)
        .sort((a, b) => b.s - a.s || (b.r.vote_count || 0) - (a.r.vote_count || 0));
      if (hits.length) return hits[0].s >= 4 ? hits.filter(x => x.s >= 4).slice(0, 3) : hits.slice(0, 3);
    }
    return [];
  }));
  const seen = new Set();
  return found.flat().map(x => x.r).filter(r => !seen.has(r.id) && seen.add(r.id));
}

async function handleTitleSearch(url, env, cors, waitUntil) {
  const t0 = Date.now();
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
  // Taken as typed: no filler stripping here, a title can start with "Get", "Like" or "Please".
  const raw = (url.searchParams.get('q') || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  const type = url.searchParams.get('type') === 'tv' ? 'tv' : 'movie';
  const rawLang = (url.searchParams.get('lang') || 'en-US').trim();
  const lang = /^[a-z]{2}(-[A-Z]{2})?$/.test(rawLang) ? rawLang : 'en-US';
  const debug = url.searchParams.get('debug') === '1';
  if (!raw) return json({ results: [], corrected: null, ai: false });

  const key = _titleKey(raw);
  // "Dune 1984" / "Dune (1984)": also the title alone, in that year. "Blade Runner 2049" stays whole.
  const ym = raw.match(/^(.+?)[\s(]+((?:18|19|20)\d\d)\)?$/);
  const yr = ym && Number(ym[2]) <= new Date().getUTCFullYear() + 3 ? Number(ym[2]) : null;
  const base = yr ? ym[1].trim() : null;

  let ranked;
  try {
    const [whole, inYear] = await Promise.all([
      _tmdbTitleSearch(type, raw, null, lang, env),
      base ? _tmdbTitleSearch(type, base, yr, lang, env).catch(() => []) : [],
    ]);
    const best = new Map();                      // id → {r, s}: the better reading of each result
    for (const x of [..._titleRank(whole, key, null), ..._titleRank(inYear, _titleKey(base), yr)]) {
      if (!best.has(x.r.id) || best.get(x.r.id).s < x.s) best.set(x.r.id, x);
    }
    ranked = [...best.values()].sort((a, b) => b.s - a.s || (a.s >= 3 ? (b.r.vote_count || 0) - (a.r.vote_count || 0) : 0));
  } catch (e) {
    console.error(`[title-search] TMDB failed q="${raw.slice(0, 80)}" ${e.message}`);
    return json({ error: 'Search failed', detail: e.message }, 502);
  }

  // A title with every word in it is the answer, unless it's a film hardly anyone has rated:
  // then the text may be a famous film's title in another language ("El Padrino" is also a
  // 2004 film, "Le Parrain" a film with no votes), so the AI is asked too. Its pick goes first.
  const top = ranked[0];
  const strong = top && top.s >= 2 && (top.r.vote_count || 0) >= (type === 'tv' ? 30 : 100);
  let fixes = null, corrected = null, fixed = [], via = null;
  if (!strong) {
    const aiP = env.AI ? _titleFixes(type, raw, key, { env, debug, waitUntil, model: debug && VIBE_ALT_MODELS[url.searchParams.get('fx')] }) : Promise.resolve(null);
    const translated = await _titleTranslated(type, ranked, key, env);
    if (translated.length) {
      fixed = translated;                        // certain: its own title in some language, exactly
      via = 'translation';
      if (waitUntil) waitUntil(aiP);             // the AI's answer is still cached for next time
    } else {
      fixes = await aiP;
      fixed = await _titleFixHits(type, fixes || [], lang, env);
      if (fixed.length) via = 'ai';
    }
    // A note only when the text wasn't simply part of that title ("lord of rings" is).
    if (fixed.length && _titleScore(fixed[0], key) < 2) corrected = fixed[0].title || fixed[0].name;
  }

  const ids = new Set(fixed.map(r => r.id));
  const results = [...fixed, ...ranked.map(x => x.r).filter(r => !ids.has(r.id))];
  console.log(`[title-search] "${raw.slice(0, 80)}" ${type} ${lang} | best=${ranked[0]?.s ?? 0} tmdb=${ranked.length}` +
    `${via === 'translation' ? ` translated → ${fixed.length}` : ''}${fixes ? ` ai=[${fixes.map(f => f.title).join(' | ')}] → ${fixed.length}` : ''} | ${Date.now() - t0}ms`);
  return json({ results, corrected, via, ...(debug ? { debug: { fixes, best: ranked.slice(0, 5).map(x => [x.r.title || x.r.name, x.s]) } } : {}) });
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

/* ── /api/watchmode/sources ─────────────────────────────────────────
   Thin, region-resolved proxy to Watchmode's per-title sources endpoint.
   Kept deliberately minimal — it does NOT also re-fetch or merge TMDB data
   (the client already has that from the movie-detail call); merging,
   deduping, Amazon-first sort, and affiliate-link preservation all happen
   client-side in index.html (see _mergeWatchmodeSources()), where the TMDB
   tier data is already in memory. This just keeps WATCHMODE_API_KEY off
   the client.

   Graceful by design: no key configured, a bad key, a rate limit, or the
   requested region not being enabled on the plan should never break the
   page — every failure path below still returns 200 with `sources: []`
   rather than an error, so the frontend just falls back to TMDB-only data.
─────────────────────────────────────────────────────────────────── */
async function handleWatchmodeSources(request, url, env, cors) {
  const json = body =>
    new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', ...cors },
    });

  const tmdbId = url.searchParams.get('tmdb_id');
  const type   = url.searchParams.get('type') === 'tv' ? 'tv' : 'movie';
  // debug_region: manual-testing-only override (real user traffic never sends
  // this — the frontend only ever sends client_region). Needed because
  // request.cf.country reflects the real caller's location and can't be
  // spoofed from outside, which otherwise makes it impossible to verify a
  // specific market's data without physically being there. 2-letter format
  // validated here; Watchmode itself rejects anything it doesn't recognize.
  const debugRegion = url.searchParams.get('debug_region');
  const region = (debugRegion && /^[A-Za-z]{2}$/.test(debugRegion))
    ? debugRegion.toUpperCase()
    : _resolveRegion(request, url);

  if (!tmdbId || !/^\d+$/.test(tmdbId)) {
    return json({ configured: !!env.WATCHMODE_API_KEY, region, sources: [], error: 'tmdb_id required' });
  }
  if (!env.WATCHMODE_API_KEY) {
    // Not set up yet — expected state until a key is added. Not an error.
    return json({ configured: false, region, sources: [] });
  }

  try {
    // Watchmode accepts TMDB-format IDs directly in the title_id path param
    // (`movie-550`, `tv-1396`) — no separate ID-lookup call needed. Costs 2
    // credits instead of 1 for a native Watchmode ID, but avoids an extra
    // round trip and a whole failure mode (lookup miss).
    const wmUrl = new URL(`https://api.watchmode.com/v1/title/${type}-${tmdbId}/sources/`);
    wmUrl.searchParams.set('regions', region);
    const r = await fetch(wmUrl.toString(), {
      headers: { 'X-API-Key': env.WATCHMODE_API_KEY, 'User-Agent': 'FindFilm.ai/1.0' },
    });
    if (!r.ok) {
      // Bad key, rate-limited, or `region` not enabled on the current plan —
      // all non-fatal from the page's perspective. Surface Watchmode's own
      // error message (truncated) rather than just the status code — a bare
      // "Watchmode 400" doesn't say WHY, and the two most likely causes
      // (bad key vs. region not on the plan) need different fixes.
      const body = await r.text().catch(() => '');
      return json({ configured: true, region, sources: [], error: `Watchmode ${r.status}: ${body.slice(0, 200)}` });
    }
    const raw = await r.json();
    if (!Array.isArray(raw)) return json({ configured: true, region, sources: [] });

    const AMAZON_RE = /\bamazon\b|\bprime\s*video\b/i;
    const sources = raw
      .filter(s => s && s.region === region && ['sub', 'rent', 'buy', 'free'].includes(s.type))
      .map(s => ({
        name:     s.name || '',
        type:     s.type,                       // 'sub' | 'rent' | 'buy' | 'free'
        webUrl:   s.web_url || null,
        isAmazon: AMAZON_RE.test(s.name || ''),
      }));

    return json({ configured: true, region, sources });
  } catch (e) {
    return json({ configured: true, region, sources: [], error: e.message });
  }
}

/* ── /api/reddit/reviews ──────────────────────────────────────────────
   Official Reddit API only — OAuth2 client_credentials (app-only token,
   no user login, no scopes). Genuine public discussion posts, fetched
   and identified honestly per Reddit's own API rules (see
   REDDIT_USER_AGENT below) — no IP-block evasion, no spoofed browser
   User-Agent, no third-party proxy in the loop.

   Two-tier KV cache keeps Reddit call volume low (well under the 60
   req/min OAuth2 rate limit) and avoids re-authenticating every request:
     reddit:token              — app-only bearer token, ~55min TTL
                                  (Reddit tokens last 60min; refreshed
                                  5min early so a request never lands on
                                  one that just expired mid-flight)
     reddit:reviews:v1:{tmdbId} — processed review list per movie, 36h
                                  TTL (inside the requested 24-48h
                                  window) — cached whether reviews were
                                  found or not, so a movie with zero
                                  Reddit discussion doesn't get re-
                                  searched on every view either.
   Graceful by construction, same contract as /watchmode/sources: missing
   secrets, a Reddit outage, or zero results all return 200 with an empty
   `reviews` array — never breaks the page. An error response is
   deliberately NOT cached (unlike a real empty result) — same-movie
   requests are infrequent enough in practice that this doesn't risk
   hammering Reddit, and it means a transient outage self-heals on the
   very next view instead of being locked "off" for a day and a half.
─────────────────────────────────────────────────────────────────────── */
const REDDIT_USER_AGENT   = 'web:findfilm.ai-reviews:1.0.0 (by /u/findfilmai)';
const REDDIT_REVIEW_SUBS  = ['movies', 'flicks', 'MovieReviews', 'TrueFilm', 'boxoffice'];
const REDDIT_REVIEWS_TTL  = 129600; // 36h

async function _redditToken(env) {
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) return null;

  if (env.MOVIES_CACHE) {
    try {
      const cached = await env.MOVIES_CACHE.get('reddit:token');
      if (cached) return cached;
    } catch {}
  }

  const basic = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type':  'application/x-www-form-urlencoded',
      'User-Agent':    REDDIT_USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Reddit auth ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('Reddit auth: no access_token in response');

  if (env.MOVIES_CACHE) {
    const ttl = Math.max(60, (data.expires_in || 3600) - 300);
    env.MOVIES_CACHE.put('reddit:token', data.access_token, { expirationTtl: ttl }).catch(() => {});
  }
  return data.access_token;
}

async function handleRedditReviews(request, url, env, cors, waitUntil) {
  const json = body =>
    new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', ...cors },
    });

  const configured = !!(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET);
  const tmdbId = url.searchParams.get('tmdb_id');
  const title  = (url.searchParams.get('title') || '').trim();

  if (!tmdbId || !/^\d+$/.test(tmdbId) || !title) {
    return json({ configured, reviews: [], error: 'tmdb_id and title required' });
  }
  if (!configured) {
    // Not set up yet — expected state until REDDIT_CLIENT_ID/SECRET are
    // added. Not an error.
    return json({ configured: false, reviews: [] });
  }

  const cacheKey = `reddit:reviews:v1:${tmdbId}`;
  if (env.MOVIES_CACHE) {
    try {
      const hit = await env.MOVIES_CACHE.get(cacheKey);
      if (hit != null) return json({ configured: true, reviews: JSON.parse(hit), cached: true });
    } catch {}
  }

  try {
    const token = await _redditToken(env);
    if (!token) return json({ configured: false, reviews: [] });

    // Scope the search to review/discussion-oriented subreddits and the
    // exact title — a bare keyword search across all of Reddit returns too
    // much noise (anything that happens to share a word with the title).
    const subredditClause = REDDIT_REVIEW_SUBS.map(s => `subreddit:${s}`).join(' OR ');
    const q = `title:"${title}" (${subredditClause})`;
    const searchUrl = new URL('https://oauth.reddit.com/search');
    searchUrl.searchParams.set('q', q);
    searchUrl.searchParams.set('sort', 'relevance');
    searchUrl.searchParams.set('limit', '25');
    searchUrl.searchParams.set('type', 'link');

    const r = await fetch(searchUrl.toString(), {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': REDDIT_USER_AGENT },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return json({ configured: true, reviews: [], error: `Reddit ${r.status}: ${body.slice(0, 200)}` });
    }
    const data  = await r.json();
    const posts = (data?.data?.children || []).map(c => c.data).filter(Boolean);

    // Self-posts only (selftext present) — link posts ("official trailer",
    // news articles) aren't reviews. Drop NSFW/removed/deleted-author posts.
    const reviews = posts
      .filter(p => p && !p.over_18 && !p.stickied && p.selftext && p.selftext.length >= 40)
      .map(p => ({
        author:    (p.author && p.author !== '[deleted]') ? p.author : null,
        subreddit: p.subreddit_name_prefixed || (p.subreddit ? `r/${p.subreddit}` : null),
        score:     typeof p.score === 'number' ? p.score : null,
        content:   p.selftext,
        url:       p.permalink ? `https://www.reddit.com${p.permalink}` : null,
      }))
      .filter(rv => rv.author && rv.subreddit)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 5);

    if (env.MOVIES_CACHE) {
      const w = env.MOVIES_CACHE.put(cacheKey, JSON.stringify(reviews), { expirationTtl: REDDIT_REVIEWS_TTL }).catch(() => {});
      if (waitUntil) waitUntil(w);
    }

    return json({ configured: true, reviews });
  } catch (e) {
    return json({ configured: true, reviews: [], error: e.message });
  }
}

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

/* ════════════════════════════════════════════════════════════════════
   LLM-FIRST "By Plot" CURATION — open-world, agentic two-step retrieval.

   The old flow was closed-world: it handed the LLM a fixed KV catalog of
   recent releases and asked it to rank WITHIN that list, so anything not in
   the cache could never surface. This flips it:

   Phase 1 (LLM brain): the user's raw vibe/plot/trope query goes straight to
   a 70B film-curator model. It draws on its OWN deep cinema knowledge —
   subtext, tone, visual style, character arcs, specific scenes — to name the
   5-7 best-fitting REAL films, each with a bespoke "ai_verdict". Not limited
   to any catalog.

   Phase 2 (data hydration): every {title, year} the model returns is looked
   up on TMDB to attach real metadata (id, poster, genres, TMDB score) so the
   frontend renders standard Movie Cards. Unified IMDb/RT/Metacritic ratings
   are filled in afterwards by the client's existing per-card enrichment.

   Falls back to the closed-world KV search if the curator errors or too few
   picks resolve to real TMDB movies.
════════════════════════════════════════════════════════════════════ */

const _CURATOR_SYSTEM_PROMPT =
  'You are a DEEP EMOTIONAL film curator with encyclopaedic knowledge of world cinema — ' +
  'arthouse, blockbusters, cult classics, festival winners and hidden gems across every era, ' +
  'country and language. The user tells you how they want to FEEL, or describes a vibe, mood, ' +
  'plot, trope, or a specific kind of scene. Read the request for its EMOTIONAL intent, then ' +
  'analyse each candidate film on four axes: (1) VIBE & emotional resonance — the feeling it ' +
  'leaves you with; (2) PACING — slow-burn, meditative, breakneck, rollercoaster; ' +
  '(3) COLOUR PALETTE & visual mood — neon, washed-out, warm, monochrome, saturated; ' +
  '(4) TONE & subtext. Match on how the film FEELS, not merely what its plot is about. ' +
  'Recommend 5 to 7 real films, best emotional match first. It is good to mix a well-known pick ' +
  'with a deeper cut, but every film must genuinely deliver the requested feeling and must actually exist. ' +
  'ALWAYS return at least 4 films (ideally 5-6). If no film is an exact match for the plot or request, ' +
  'you MUST STILL fall back to the closest thematic/tonal matches — similar vibes, the same director or ' +
  'genre, or the most iconic titles in that category — and never return fewer than 4 films, never an empty list. ' +
  'MULTILINGUAL: the user may write in ANY language. Silently detect it and interpret the request by MEANING, ' +
  'treating a query in any language EXACTLY like its English equivalent ' +
  '(e.g. Ukrainian "фільм про космос" ≡ "movie about space"; Spanish "algo aterrador" ≡ "something scary"). ' +
  'Language must never change which films you pick. Always write ALL output — every "title", "ai_verdict", ' +
  '"vibe_tag", "tags" and "suggestedRefinements" — in ENGLISH, regardless of the query\'s language. ' +
  'Do NOT translate any output back into the user\'s language; the app UI stays English. ' +
  'Respond with STRICT JSON only — no markdown, no code fences, no prose outside the JSON. Schema:\n' +
  '{\n' +
  '  "picks": [\n' +
  '    { "title": "Exact English film title", "year": 1999, ' +
  '"vibe_tag": "punchy 1-2 word mood label capturing the feeling (e.g. \\"Neon Noir\\", \\"Pure Chaos\\", \\"Slow-burn\\", \\"Cosy Warmth\\", \\"Gut-punch\\")", ' +
  '"ai_verdict": "one punchy sentence on WHY this film delivers the exact feeling/vibe the user asked for — name the mood, pacing, palette or a specific scene, never a plot recap", ' +
  '"tags": ["1-3 word trait", "..."] }\n' +
  '  ],\n' +
  '  "suggestedRefinements": ["1-3 word next tweak", "...", "..."],\n' +
  '  "message": null\n' +
  '}\n' +
  'Rules: "year" is the 4-digit theatrical release year as an integer. ' +
  '"vibe_tag" is a punchy 1-2 word mood label in Title Case with no trailing punctuation. ' +
  'Each "ai_verdict" is at most 22 words, centred on the FEELING/vibe match, and specific to THIS query. ' +
  'Each pick has 2 to 3 short "tags". ' +
  '"suggestedRefinements" is 3 to 4 short (1-3 word) follow-up tweaks. ' +
  'Never invent films. Never output anything except the JSON object.';

/* Phase 1 — ask the curator model for real films matching the query.
 * Returns { picks:[{title,year,vibe_tag,ai_verdict,tags}], suggestedRefinements, message }.
 * Throws on hard failure so the caller can fall back to the KV catalog. */
async function _llmFirstCuration(query, exclude, env) {
  const exclusionBlock = exclude.length
    ? `\n\nHARD EXCLUSIONS — never recommend films matching these themes/tones/content:\n` +
      exclude.map(x => `  - ${x}`).join('\n')
    : '';

  const aiResp = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [
      { role: 'system', content: _CURATOR_SYSTEM_PROMPT },
      { role: 'user',   content: `Request: "${query}"${exclusionBlock}\n\nReturn the JSON now.` },
    ],
    max_tokens:  900,
    temperature: 0.4,   // a little warmth for richer, less generic curation
    stream:      false,
  });

  let text = '';
  if (aiResp?.choices?.[0]?.message?.content) text = aiResp.choices[0].message.content;
  else if (typeof aiResp?.response === 'string')  text = aiResp.response;
  else if (typeof aiResp === 'string')            text = aiResp;
  text = (text || '').trim();

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('curator returned no JSON');
  const parsed = JSON.parse(match[0]);

  const picks = (Array.isArray(parsed.picks) ? parsed.picks : [])
    .map(p => ({
      title:      String(p?.title || '').trim().slice(0, 120),
      year:       Number.parseInt(p?.year, 10) || null,
      vibe_tag:   String(p?.vibe_tag || '').trim().replace(/[\n\r|]+/g, ' ').slice(0, 24),
      ai_verdict: String(p?.ai_verdict || '').trim().replace(/[\n\r]+/g, ' ').slice(0, 160),
      tags: Array.isArray(p?.tags)
        ? p.tags.filter(t => typeof t === 'string')
                .map(t => t.trim().replace(/[\n\r]+/g, ' ').slice(0, 26))
                .filter(Boolean).slice(0, 3)
        : [],
    }))
    .filter(p => p.title)
    .slice(0, 7);

  const seen = new Set();
  const suggestedRefinements = [];
  for (const raw of (Array.isArray(parsed.suggestedRefinements) ? parsed.suggestedRefinements : [])) {
    if (typeof raw !== 'string') continue;
    const clean = raw.trim().replace(/[\n\r]+/g, ' ').slice(0, 30);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    suggestedRefinements.push(clean);
    if (suggestedRefinements.length >= 4) break;
  }

  return {
    picks,
    suggestedRefinements,
    message: typeof parsed.message === 'string' ? parsed.message : null,
  };
}

/* Phase 2 — resolve one curated {title, year} to a real TMDB movie object.
 * Prefers exact title + year matches with a poster; retries without the year
 * filter if needed. Returns the TMDB raw object or null. */
async function _tmdbFindMovie(title, year, env) {
  const searchOnce = async (withYear) => {
    const u = new URL('https://api.themoviedb.org/3/search/movie');
    u.searchParams.set('api_key', env.TMDB_KEY);
    u.searchParams.set('query', title);
    u.searchParams.set('include_adult', 'false');
    if (withYear && year) u.searchParams.set('primary_release_year', String(year));
    try {
      const r = await fetch(u.toString(), { headers: { 'User-Agent': 'FindFilm.ai/1.0' } });
      const d = r.ok ? await r.json() : null;
      return d?.results || [];
    } catch { return []; }
  };

  let results = await searchOnce(true);
  if (!results.length && year) results = await searchOnce(false); // widen if the year zeroed it out
  if (!results.length) return null;

  const want = title.toLowerCase();
  const scored = results
    .filter(m => m.poster_path)                 // skip poster-less entries → clean cards
    .map(m => {
      const t  = (m.title || m.original_title || '').toLowerCase();
      const ry = parseInt((m.release_date || '').slice(0, 4)) || 0;
      let s = 0;
      if (t === want)                                    s += 4;
      else if (t.startsWith(want) || want.startsWith(t)) s += 2;
      if (year && ry === year)                           s += 3;
      else if (year && Math.abs(ry - year) <= 1)         s += 1;
      s += Math.min((m.vote_count || 0) / 5000, 1);      // gentle popularity tiebreak
      return { m, s };
    })
    .sort((a, b) => b.s - a.s);

  return scored.length ? scored[0].m : null;
}

/* Guaranteed fallback — iconic / crowd-pleasing real films so AI search is
 * NEVER empty. Returns raw TMDB movie objects (same shape as _tmdbFindMovie),
 * poster-guaranteed, excluding any ids already chosen. Used to top a thin
 * result set up to the 4-6 floor, and as a last resort when every other path
 * fails, so the user never sees a "zero results" screen. */
async function _tmdbPopularFallback(env, need, excludeIds = []) {
  if (!env.TMDB_KEY || need <= 0) return [];
  const exclude = new Set((excludeIds || []).map(Number));
  const pull = async (path, extra = {}) => {
    const u = new URL(`https://api.themoviedb.org/3${path}`);
    u.searchParams.set('api_key', env.TMDB_KEY);
    u.searchParams.set('include_adult', 'false');
    u.searchParams.set('language', 'en-US');
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, String(v));
    try {
      const r = await fetch(u.toString(), { headers: { 'User-Agent': 'FindFilm.ai/1.0' } });
      const d = r.ok ? await r.json() : null;
      return d?.results || [];
    } catch { return []; }
  };
  // Prefer highly-voted crowd-pleasers, then fall back to top-rated classics.
  const pools = await Promise.all([
    pull('/discover/movie', { sort_by: 'popularity.desc', 'vote_count.gte': 2000 }),
    pull('/movie/top_rated', { page: 1 }),
  ]);
  const out = [];
  const seen = new Set();
  for (const list of pools) {
    for (const m of list) {
      if (!m || !m.poster_path) continue;
      const id = Number(m.id);
      if (exclude.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(m);
      if (out.length >= need) return out;
    }
  }
  return out;
}

/* ─── Vibe Check handler ─────────────────────────────────────
 * Two entry points, one destination:
 *   • Photo  (multipart/form-data, field "image") → Cloudflare LLaVA vision
 *     model reads the mood/colour/setting → a natural-language "vibe" string.
 *   • Music  (JSON {url}) → fetch the link's OpenGraph title/description
 *     (Spotify/YouTube expose the track/video name there) → a "vibe" string.
 * The vibe string is then handed to the SAME open-world curation path used by
 * /api/ai-search (_llmFirstCuration → _tmdbFindMovie), so the response shape is
 * identical to the aiCurated branch and the frontend renders it with the
 * existing grid logic. */
async function handleVibeCheck(request, env, cors, waitUntil) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });

  if (request.method !== 'POST')        return json({ error: 'Method not allowed' }, 405);
  if (!env.AI || !env.TMDB_KEY)         return json({ error: 'Vibe engine not configured' }, 503);

  const ctype = request.headers.get('Content-Type') || '';
  let mode = 'photo';
  let vibeQuery = '';
  let vibeSource = '';

  try {
    if (ctype.includes('multipart/form-data')) {
      /* ── Photo vibe: vision model reads the image ── */
      mode = 'photo';
      const form = await request.formData();
      const file = form.get('image');
      if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'No image provided' }, 400);

      const buf = await file.arrayBuffer();
      if (buf.byteLength > 6 * 1024 * 1024) return json({ error: 'Image too large (max 6MB)' }, 413);

      let description = '';
      try {
        const vResp = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
          image:  [...new Uint8Array(buf)],
          prompt: 'Analyze the mood, colors, and setting of this image. Suggest 3 movie genres or specific cinematic themes that perfectly match this vibe. Be concise.',
          max_tokens: 384,
        });
        description = (vResp?.description || vResp?.response || '').toString().trim();
      } catch (e) {
        console.error('[vibe-check:vision] failed:', e.message);
        return json({ error: 'Vision analysis failed' }, 502);
      }
      if (!description) return json({ error: 'Could not read the image vibe' }, 502);

      vibeSource = description.replace(/\s+/g, ' ').slice(0, 140);
      vibeQuery  = `A film matching this mood, colour palette and atmosphere: ${description}`;
    } else {
      /* ── Music vibe: read the link's OpenGraph metadata ── */
      mode = 'music';
      const body = await request.json();
      const link = (body.url || '').toString().trim().slice(0, 500);
      if (!link || !/^https?:\/\//i.test(link)) return json({ error: 'No valid link provided' }, 400);

      const meta = await _musicMeta(link);
      vibeSource = meta || link;
      vibeQuery  = `A film that matches the mood, energy and emotional tone of this music: "${meta || link}"`;
    }
  } catch (e) {
    console.error('[vibe-check] bad request:', e.message);
    return json({ error: 'Invalid request body' }, 400);
  }

  /* ── Hand off the vibe string to the existing curator → TMDB path ── */
  try {
    const { picks, suggestedRefinements, message } = await _llmFirstCuration(vibeQuery, [], env);
    if (picks.length) {
      const hydrated = await Promise.all(picks.map(async p => {
        const raw = await _tmdbFindMovie(p.title, p.year, env);
        return raw ? { raw, pick: p } : null;
      }));

      const movies = [], reasons = {}, tags = {}, vibeTags = {}, seenIds = new Set();
      for (const h of hydrated) {
        if (!h || seenIds.has(h.raw.id)) continue;
        seenIds.add(h.raw.id);
        movies.push(h.raw);
        if (h.pick.ai_verdict)  reasons[h.raw.id]  = h.pick.ai_verdict;
        if (h.pick.tags.length) tags[h.raw.id]     = h.pick.tags;
        if (h.pick.vibe_tag)    vibeTags[h.raw.id] = h.pick.vibe_tag;
      }

      if (movies.length >= 3) {
        return json({
          aiCurated: true,
          vibeCheck: true,
          vibeMode:  mode,
          vibeSource,
          movies,
          reasons,
          tags,
          vibeTags,
          suggestedRefinements,
          message: message || null,
        });
      }
    }
    return json({ error: 'No vibe matches found', hint: 'try another photo or track' }, 404);
  } catch (e) {
    console.error('[vibe-check] curation failed:', e.message);
    return json({ error: 'Vibe curation failed' }, 502);
  }
}

/* Fetch a music link's OpenGraph title/description (Spotify & YouTube expose the
 * track/video name there) → a compact "Artist — Song" label. Best-effort: any
 * failure returns '' so the caller falls back to the raw URL. */
async function _musicMeta(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FindFilm.ai/1.0; +https://findfilm.ai)' },
      redirect: 'follow',
    });
    if (!r.ok) return '';
    const html = (await r.text()).slice(0, 200000);
    const pick = (prop) => {
      const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
             || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
      return m ? m[1].trim() : '';
    };
    const title = pick('og:title');
    const desc  = pick('og:description');
    let out = title;
    if (desc && desc.length <= 120) out = title ? `${title} — ${desc}` : desc;
    return (out || '').replace(/\s+/g, ' ').replace(/&amp;/g, '&').slice(0, 200);
  } catch {
    return '';
  }
}

/* ─── Taste DNA ─────────────────────────────────────────────
 * Takes the films a user rated highly (title/year/rating/genres/director,
 * derived on the frontend from rk_taste_v1 + rk_rated_films) and asks the
 * curator model for a shareable "cinematic personality": an archetype, three
 * aesthetic vibe tags, a second-person summary, a 3-colour palette and a
 * spirit film. Reuses env.AI (llama-3.3-70b) and the same strict-JSON parse
 * pattern as _llmFirstCuration, so no new binding or model is introduced. */
const _TASTE_DNA_PROMPT =
  'You are a cinematic personality analyst. You receive a list of films a user ' +
  'rated highly, with genres, directors and years. Infer the through-line in their ' +
  'taste across four axes: (1) AESTHETICS — visual palette, lighting, era; ' +
  '(2) PACING — slow-burn, meditative, breakneck; (3) THEMES & TROPES — the recurring ' +
  'emotional/narrative obsessions; (4) TONE. Do not just list genres back; name the ' +
  'FEELING that connects their picks. Write for a premium, shareable profile card.\n' +
  'Respond with STRICT JSON only — no markdown, no code fences, no prose outside the JSON. Schema:\n' +
  '{\n' +
  '  "archetype": "2-4 word evocative title in Title Case (e.g. \\"Neon Melancholic\\", \\"Chaos Romantic\\")",\n' +
  '  "vibeTags": ["exactly 3 punchy 1-3 word aesthetic tags"],\n' +
  '  "summary": "2-3 sentence second-person summary of their taste — specific, flattering, quotable",\n' +
  '  "palette": ["3 hex colours that visually represent this taste, e.g. \\"#6C1FE0\\""],\n' +
  '  "spiritFilm": "one real film that most epitomises their taste"\n' +
  '}\n' +
  'Rules: exactly 3 vibeTags. summary is at most 45 words, second person ("You gravitate toward…"). ' +
  'palette is 3 valid 6-digit hex strings. Never invent films for spiritFilm. Output only the JSON object.';

async function handleTasteDna(request, env, cors) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.AI)                    return json({ error: 'Taste engine not configured' }, 503);

  let films;
  try {
    const body = await request.json();
    films = Array.isArray(body.films) ? body.films.slice(0, 40) : [];
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (films.length < 10) return json({ error: 'need_more', min: 10, have: films.length }, 422);

  /* Compact each film to one signal-dense line so the model sees taste, not noise. */
  const filmLines = films.map(f => {
    const title  = String(f?.title || '').replace(/[\n\r]+/g, ' ').slice(0, 80);
    const year   = Number.parseInt(f?.year, 10) || '?';
    const rating = Number.parseFloat(f?.rating);
    const dir    = String(f?.director || '').replace(/[\n\r]+/g, ' ').slice(0, 40);
    const genres = Array.isArray(f?.genres)
      ? f.genres.filter(g => typeof g === 'string').slice(0, 3).join(', ')
      : '';
    return `- ${title} (${year})` +
           (rating ? ` ★${rating}` : '') +
           (dir    ? ` · dir ${dir}` : '') +
           (genres ? ` · ${genres}` : '');
  }).filter(Boolean).join('\n');

  let aiResp;
  try {
    aiResp = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: _TASTE_DNA_PROMPT },
        { role: 'user',   content: `The user's top-rated films:\n${filmLines}\n\nReturn the JSON now.` },
      ],
      max_tokens:  500,
      temperature: 0.6,   // a little warmth for a distinctive, human read
      stream:      false,
    });
  } catch (e) {
    console.error('[taste-dna] ai failed:', e.message);
    return json({ error: 'ai_failed' }, 502);
  }

  let text = '';
  if (aiResp?.choices?.[0]?.message?.content) text = aiResp.choices[0].message.content;
  else if (typeof aiResp?.response === 'string') text = aiResp.response;
  else if (typeof aiResp === 'string')           text = aiResp;

  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return json({ error: 'parse_failed' }, 502);

  let parsed;
  try { parsed = JSON.parse(match[0]); } catch { return json({ error: 'parse_failed' }, 502); }

  const dna = {
    archetype: String(parsed?.archetype || 'Cinephile').replace(/[\n\r]+/g, ' ').trim().slice(0, 40),
    vibeTags: (Array.isArray(parsed?.vibeTags) ? parsed.vibeTags : [])
                .filter(s => typeof s === 'string')
                .map(s => s.replace(/[\n\r|]+/g, ' ').trim().slice(0, 24))
                .filter(Boolean).slice(0, 3),
    summary: String(parsed?.summary || '').replace(/[\n\r]+/g, ' ').trim().slice(0, 320),
    palette: (Array.isArray(parsed?.palette) ? parsed.palette : [])
                .filter(h => typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h.trim()))
                .map(h => h.trim().toUpperCase()).slice(0, 3),
    spiritFilm: String(parsed?.spiritFilm || '').replace(/[\n\r]+/g, ' ').trim().slice(0, 80),
  };

  /* Defensive fallbacks so the card always renders cleanly. */
  if (dna.palette.length < 3) dna.palette = ['#6C1FE0', '#0EA5E9', '#F59E0B'];
  while (dna.vibeTags.length < 3) dna.vibeTags.push('Cinephile');

  return json({ ok: true, dna });
}

/* ─── AI semantic search handler ───────────────────────────── */

async function handleAISearch(request, env, cors, waitUntil) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let query;
  let exclude = [];
  try {
    const body = await request.json();
    query = (body.query || '').trim().slice(0, 1000); // cap query length — generous enough for a full rambling voice-dictated plot description
    // Natural negative filters: themes/traits the user wants to avoid.
    // Parsed on the frontend (parseVibeQuery) from phrases like "no gore, not sad".
    // NOTE: numeric/duration excludes (e.g. "under 100 min") are only soft hints —
    // the closed-world KV catalog has no runtime field, so they can't be enforced.
    exclude = Array.isArray(body.exclude)
      ? body.exclude
          .filter(x => typeof x === 'string')
          .map(x => x.trim().replace(/[|\n\r]+/g, ' ').slice(0, 40))
          .filter(Boolean)
          .slice(0, 8)
      : [];
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!query) return json({ error: 'Missing query' }, 400);

  // ── KV response cache ──────────────────────────────────────────────
  // Deterministic queries (esp. the "Pick for tonight" wizard, which builds a
  // fixed "A {mood} movie, {time}, good for {company}" string) repeat constantly.
  // A hit here skips BOTH the intent-parse LLM call and the main generation call,
  // turning a multi-second wait into an instant response. Keyed on the normalized
  // query + hard exclusions; 6-hour TTL keeps it fresh against the daily catalog.
  const _norm   = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const _exKey  = exclude.length ? '|x:' + exclude.map(x => x.toLowerCase()).sort().join(',') : '';
  const cacheKey = `ais:v2:${_norm}${_exKey}`.slice(0, 480);
  const cacheWrite = (payload) => {
    if (!env.MOVIES_CACHE) return;
    const w = env.MOVIES_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 21600 }).catch(() => {});
    if (waitUntil) waitUntil(w);
  };
  if (env.MOVIES_CACHE) {
    try {
      const hit = await env.MOVIES_CACHE.get(cacheKey);
      if (hit) return json({ ...JSON.parse(hit), cached: true });
    } catch {}
  }

  // ── EXPLICIT INPUT TRANSLATION + DE-RAMBLING (multilingual/voice → English) ──
  // Root fix for non-English search: instead of relying on the downstream
  // curator/ranker to translate internally (inconsistent — non-English queries
  // often fell through to the tiny KV catalog and returned poor results), we
  // translate the query to English HERE, once, BEFORE any curation, ranking, or
  // TMDB lookup runs. `_parseIntent` is parsed a single time and reused by the
  // actor + LLM-first + KV paths.
  // ALWAYS prefer the LLM's cleaned rewrite (not just for non-English input) —
  // it also strips voice-dictation rambling (filler, false starts, repetition)
  // from English queries, while preserving every plot detail/mood/constraint the
  // user actually described. Raw `query` is only kept as a fallback if parsing fails.
  let intent = null;
  let searchQuery = query;                      // English query fed to EVERY search path
  if (env.AI) {
    intent = await _parseIntent(query, env);
    if (intent) {
      const cleanedQuery =
        (intent.english_query || intent.clean_title_guess || intent.english_keywords || '').trim();
      if (cleanedQuery) searchQuery = cleanedQuery;
    }
    console.log(
      '[ai-search] Raw query:', JSON.stringify(query),
      '-> Translated query:', JSON.stringify(searchQuery),
      `(lang: ${intent?.user_language || '?'})`
    );
  }

  const _userLang = intent?.user_language || 'en';

  // ── ZERO-EMPTY-STATE GUARANTEE ─────────────────────────────────────────
  // A last-resort payload of iconic/popular real films. Every failure path
  // (cache empty, model error, thin hydration) routes through this instead of
  // returning an error/empty set, so the user is NEVER shown a blank results
  // screen. Shaped exactly like the open-world `aiCurated` branch.
  const _guaranteePayload = async (note) => {
    const movies = await _tmdbPopularFallback(env, 6, []);
    if (!movies.length) return null;
    const reasons = {};
    for (const m of movies) reasons[m.id] = 'A crowd-favorite pick to get you started.';
    return {
      aiCurated: true,
      movies,
      reasons,
      tags: {},
      vibeTags: {},
      suggestedRefinements: [],
      message: note || 'Here are some popular films to explore.',
      translatedQuery: searchQuery,
      userLanguage: _userLang,
      fallback: true,
    };
  };

  // Actor-focused queries ("Best movies with Leonardo DiCaprio") bypass the
  // closed-world KV catalog entirely — they return real TMDB filmography data.
  // Any failure here (actor not found, TMDB error) falls through unchanged to
  // the existing catalog-embedding flow below. Reuses the intent parsed above.
  if (env.AI && env.TMDB_KEY && intent) {
    try {
      if (intent.intent === 'actor_search' && intent.actor_name) {
        const actorResult = await _actorMovies(intent.actor_name, env);
        if (actorResult && actorResult.movies.length) {
          const { personName, movies: actorMovies } = actorResult;
          const miniCatalog = actorMovies.map(m =>
            `${m.id}|${m.title} (${(m.release_date || '').slice(0, 4)})|${(m.overview || '').slice(0, 100)}`
          ).join('\n');

          const actorSystemPrompt =
            'You are a movie recommendation engine focused on a specific actor. ' +
            'Respond with valid JSON only — no markdown fences, no extra text. ' +
            `For every movie, write a short, punchy "reason" (max 10-15 words) explaining why it's a great ${personName} performance or movie. ` +
            'For every movie, ALSO provide "tags": 2-3 very short labels (1-3 words each) describing standout traits. ' +
            'Always write ALL output — "reason", "tags" and "suggestedRefinements" — in ENGLISH, regardless of the query\'s language. ' +
            'Finally, suggest 3-4 short (1-3 word) follow-up refinements relevant to this actor\'s filmography.';

          const actorUserPrompt =
            `Actor: ${personName}\n\n` +
            `Movies (format: id|title (year)|description):\n\n${miniCatalog}\n\n` +
            `Return JSON:\n` +
            `{\n` +
            `  "results": [ { "id": integer, "reason": "short punchy reason, max 10-15 words", "tags": ["1-3 word trait", "..."] }, ... ],\n` +
            `  "suggestedRefinements": ["1-3 word refinement", "...", "...", "..."]\n` +
            `}\n` +
            `results ordered best-match first, include ALL provided movies.`;

          let reasons = {};
          let tags = {};
          let suggestedRefinements = [];
          try {
            const aiResp = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
              messages: [
                { role: 'system', content: actorSystemPrompt },
                { role: 'user',   content: actorUserPrompt   },
              ],
              max_tokens:  800,
              temperature: 0.1,
              stream:      false,
            });

            let text = '';
            if (aiResp?.choices?.[0]?.message?.content) text = aiResp.choices[0].message.content;
            else if (typeof aiResp?.response === 'string') text = aiResp.response;
            else if (typeof aiResp === 'string') text = aiResp;
            text = text.trim();

            const match  = text.match(/\{[\s\S]*\}/);
            const result = match ? JSON.parse(match[0]) : {};

            const validIds = new Set(actorMovies.map(m => m.id));
            for (const r of (Array.isArray(result.results) ? result.results : [])) {
              const id = Number(r?.id);
              if (!Number.isInteger(id) || !validIds.has(id)) continue;
              if (typeof r.reason === 'string' && r.reason.trim()) {
                reasons[id] = r.reason.trim().replace(/[\n\r]+/g, ' ').slice(0, 140);
              }
              if (Array.isArray(r.tags)) {
                const clean = r.tags
                  .filter(t => typeof t === 'string')
                  .map(t => t.trim().replace(/[\n\r]+/g, ' ').slice(0, 26))
                  .filter(Boolean)
                  .slice(0, 3);
                if (clean.length) tags[id] = clean;
              }
            }

            const seenRefinements = new Set();
            for (const raw of (Array.isArray(result.suggestedRefinements) ? result.suggestedRefinements : [])) {
              if (typeof raw !== 'string') continue;
              const clean = raw.trim().replace(/[\n\r]+/g, ' ').slice(0, 30);
              const key = clean.toLowerCase();
              if (!clean || seenRefinements.has(key)) continue;
              seenRefinements.add(key);
              suggestedRefinements.push(clean);
              if (suggestedRefinements.length >= 4) break;
            }
          } catch (e) {
            // Reason-generation failed — still return the actor's movies, just without reasons.
            console.error('[ai-search:actor] reason-gen failed:', e.message);
          }

          const actorPayload = {
            actorQuery: true,
            personName,
            movies: actorMovies,
            reasons,
            tags,
            suggestedRefinements,
            message: null,
            translatedQuery: searchQuery,
            userLanguage: _userLang,
          };
          cacheWrite(actorPayload);
          return json(actorPayload);
        }
        // actor not found in TMDB — fall through to the existing catalog-based flow
      }
    } catch (e) {
      console.error('[ai-search:actor] intent parse failed:', e.message);
      // fall through to existing flow
    }
  }

  // ── LLM-FIRST "By Plot" curation (open-world, agentic) ─────────────────
  // Phase 1: the curator model names 5-7 real films from its own deep film
  //   knowledge (open-world — not restricted to our KV catalog).
  // Phase 2: hydrate each {title, year} against TMDB in parallel for posters,
  //   genres and TMDB scores → real Movie-Card-shaped objects.
  // Only returns when >=3 films hydrate cleanly; otherwise falls through to
  // the closed-world KV catalog flow below so search never comes back empty.
  if (env.AI && env.TMDB_KEY) {
    try {
      const { picks, suggestedRefinements, message } = await _llmFirstCuration(searchQuery, exclude, env);
      if (picks.length) {
        const hydrated = await Promise.all(picks.map(async p => {
          const raw = await _tmdbFindMovie(p.title, p.year, env);
          return raw ? { raw, pick: p } : null;
        }));

        const movies = [], reasons = {}, tags = {}, vibeTags = {}, seenIds = new Set();
        for (const h of hydrated) {
          if (!h || seenIds.has(h.raw.id)) continue;
          seenIds.add(h.raw.id);
          movies.push(h.raw);
          if (h.pick.ai_verdict)  reasons[h.raw.id]  = h.pick.ai_verdict;
          if (h.pick.tags.length) tags[h.raw.id]     = h.pick.tags;
          if (h.pick.vibe_tag)    vibeTags[h.raw.id] = h.pick.vibe_tag;
        }

        // Zero-empty-state floor: if the curator/hydration produced at least one
        // real film but fewer than 5, top up with iconic crowd-pleasers so the
        // user always gets a full 4-6 result set (never a thin/empty screen).
        const MIN_RESULTS = 5;
        if (movies.length && movies.length < MIN_RESULTS) {
          const extra = await _tmdbPopularFallback(env, MIN_RESULTS - movies.length, [...seenIds]);
          for (const raw of extra) {
            if (seenIds.has(raw.id)) continue;
            seenIds.add(raw.id);
            movies.push(raw);
            reasons[raw.id] = 'A crowd-favorite in a similar vein.';
          }
        }

        if (movies.length >= 4) {
          const payload = {
            aiCurated: true,
            movies,
            reasons,
            tags,
            vibeTags,
            suggestedRefinements,
            message: message || null,
            translatedQuery: searchQuery,
            userLanguage: _userLang,
          };
          cacheWrite(payload);
          return json(payload);
        }
        console.log(`[ai-search:llm-first] only ${movies.length} films hydrated — falling back to KV catalog`);
      }
    } catch (e) {
      console.error('[ai-search:llm-first] failed, falling back to KV:', e.message);
    }
  }

  if (!env.MOVIES_CACHE) {
    return json({ error: 'Cache not available', hint: 'Run sync-worker first' }, 503);
  }

  const cached = await env.MOVIES_CACHE.get('new-releases');
  if (!cached) {
    const gp = await _guaranteePayload('Here are some popular films while our catalog warms up.');
    if (gp) return json(gp);
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
    'MULTILINGUAL: the user may write in ANY language. Silently detect it and interpret the query by MEANING, ' +
    'translating it to English internally to match this English-language catalog, and treat a query in any ' +
    'language EXACTLY like its English equivalent (e.g. Ukrainian "фільм про космос" ≡ "movie about space"). ' +
    'Language must never change which movies match. Always write ALL output — the "reason", "vibe_tag" and "tags" ' +
    '— in ENGLISH, regardless of the query\'s language. Do NOT translate output back into the user\'s language. ' +
    'Rank results by this strict priority: ' +
    '(1) movies whose TITLE contains the query words — rank these FIRST; ' +
    '(2) movies whose DESCRIPTION or TAGLINE matches — rank these SECOND; ' +
    '(3) thematic, genre, or mood similarity — rank these LAST. ' +
    'For every result, also write a short, punchy, conversational "reason" ' +
    '(max 10-15 words) explaining specifically why THAT movie matches the ' +
    'user\'s exact query — a personalized match explanation, not a generic plot summary. ' +
    'For every result, ALSO provide "tags": an array of 2-3 very short labels (1-3 words each) ' +
    'capturing that movie\'s standout traits relevant to the query ' +
    '(e.g. "Slow-burn mystery", "Strong female lead", "Twist ending", "Feel-good"). ' +
    'For every result, ALSO provide "vibe_tag": a punchy 1-2 word mood label (Title Case, no ' +
    'trailing punctuation) capturing how the movie FEELS — its emotional vibe/pacing/palette ' +
    '(e.g. "Neon Noir", "Pure Chaos", "Slow-burn", "Cosy Warmth", "Gut-punch"). ' +
    (exclude.length
      ? 'The user listed HARD EXCLUSIONS — themes, tones, or content they do NOT want. ' +
        'Never recommend a movie whose tone or content matches any hard exclusion; ' +
        'prefer omitting a borderline title over including it. '
      : '') +
    'Finally, based on the user\'s query and the movies you picked, suggest 3-4 short ' +
    'follow-up refinements the user might want next (e.g. "Darker tone", "More recent", ' +
    '"Based on true story", "Faster pace") — each MUST be 1-3 words, conversational, ' +
    'and a logical next tweak to the current search.';

  const exclusionBlock = exclude.length
    ? `HARD EXCLUSIONS (never recommend movies matching these themes/tones/content):\n` +
      exclude.map(x => `  - ${x}`).join('\n') + `\n\n`
    : '';

  const userPrompt =
    `User query: "${searchQuery}"\n\n` +
    exclusionBlock +
    `MANDATORY ranking order:\n` +
    `  Tier 1 — title match: if any movie title contains the query words, it MUST appear before all others.\n` +
    `  Tier 2 — description match: query words found in the description/overview.\n` +
    `  Tier 3 — thematic/genre match: general similarity in mood, genre, or story.\n\n` +
    `Catalog (format: id|title/orig (year)|genres|description):\n\n` +
    `${catalog}\n\n` +
    `Return JSON:\n` +
    `{\n` +
    `  "results": [\n` +
    `    { "id": integer, "vibe_tag": "1-2 word mood label", "reason": "short punchy match reason, max 10-15 words", "tags": ["1-3 word trait", "..."] },\n` +
    `    ...\n` +
    `  ],\n` +
    `  "suggestedRefinements": ["1-3 word refinement", "...", "...", "..."],\n` +
    `  "message": null\n` +
    `}\n` +
    `Each result's "vibe_tag" MUST be a punchy 1-2 word mood label (e.g. "Neon Noir", "Pure Chaos", "Slow-burn").\n` +
    `Each result's "tags" MUST be 2-3 short labels (1-3 words each) describing that movie's standout traits.\n` +
    `results ordered best-match first — return between 4 and 20 entries (aim for 6-12), NEVER fewer than 4.\n` +
    `Example reason for query "crime movie like Zodiac but faster": ` +
    `"Maintains the dark, gritty tone of Zodiac but with a much faster, action-packed pace."\n` +
    `suggestedRefinements must be 3-4 short (1-3 word) follow-up tweaks relevant to this ` +
    `exact query and result set, e.g. ["Darker tone", "More recent", "Based on true story", "Faster pace"].\n` +
    `If no movie is a close match, you MUST STILL return at least 4-6 of the nearest IDs ` +
    `(fall back to closest thematic/tonal matches, same director or genre, or the most iconic ` +
    `titles in that category) — each with a "reason" explaining the closest connection you found — ` +
    `and set "message" to a short friendly note ` +
    `(e.g. "These are the closest recent releases to your request."). ` +
    `NEVER return fewer than 4 results. NEVER return an empty results array.`;

  if (!env.AI) {
    return json({ error: 'AI binding not configured — deploy to Cloudflare to enable' }, 503);
  }

  try {
    const aiResp = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      max_tokens:  1600,
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

    // Validate: only keep IDs that actually exist in our catalog, dedupe, cap at 20.
    // Support both the new { results:[{id,reason}] } shape and a legacy { ids:[...] }
    // fallback in case the model ever drops the reason field.
    const validIds  = new Set(movies.map(m => m.id));
    const rawResults = Array.isArray(result.results)
      ? result.results
      : (result.ids || []).map(id => ({ id }));

    const seen     = new Set();
    const ids      = [];
    const reasons  = {};
    const tags     = {};
    const vibeTags = {};
    for (const r of rawResults) {
      const id = Number(r?.id);
      if (!Number.isInteger(id) || !validIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (typeof r.reason === 'string' && r.reason.trim()) {
        reasons[id] = r.reason.trim().replace(/[\n\r]+/g, ' ').slice(0, 140);
      }
      if (typeof r.vibe_tag === 'string' && r.vibe_tag.trim()) {
        vibeTags[id] = r.vibe_tag.trim().replace(/[\n\r|]+/g, ' ').slice(0, 24);
      }
      if (Array.isArray(r.tags)) {
        const clean = r.tags
          .filter(t => typeof t === 'string')
          .map(t => t.trim().replace(/[\n\r]+/g, ' ').slice(0, 26))
          .filter(Boolean)
          .slice(0, 3);
        if (clean.length) tags[id] = clean;
      }
      if (ids.length >= 20) break;
    }

    // Sanitize suggestedRefinements: strings only, trimmed, short (max 30 chars
    // as a hard cap beyond the "1-3 words" prompt instruction), deduped, max 4.
    const seenRefinements = new Set();
    const suggestedRefinements = [];
    for (const raw of (Array.isArray(result.suggestedRefinements) ? result.suggestedRefinements : [])) {
      if (typeof raw !== 'string') continue;
      const clean = raw.trim().replace(/[\n\r]+/g, ' ').slice(0, 30);
      const key = clean.toLowerCase();
      if (!clean || seenRefinements.has(key)) continue;
      seenRefinements.add(key);
      suggestedRefinements.push(clean);
      if (suggestedRefinements.length >= 4) break;
    }

    // ── NEVER-EMPTY GUARANTEE: top up to at least 4 IDs from the catalog ──
    // If the model returned too few, backfill with the most popular catalog
    // entries (by vote/rating order they were synced in) so the user always
    // sees a full shelf instead of a bare/empty result screen.
    if (ids.length < 4) {
      for (const m of movies) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        ids.push(m.id);
        if (!reasons[m.id]) reasons[m.id] = 'A close pick in a similar vein to your search.';
        if (ids.length >= 4) break;
      }
    }

    // As a last resort (empty catalog / all filtered) fall back to TMDB popular.
    if (ids.length < 4) {
      const gp = await _guaranteePayload(result.message || null);
      if (gp) { cacheWrite(gp); return json(gp); }
    }

    const payload = {
      ids, reasons, tags, vibeTags, suggestedRefinements,
      message: result.message || null,
      translatedQuery: searchQuery,
      userLanguage: _userLang,
    };
    cacheWrite(payload);
    return json(payload);

  } catch (e) {
    console.error('[ai-search] error:', e.message);
    const gp = await _guaranteePayload('Here are some popular films to explore while we retry.');
    if (gp) return json(gp);
    return json({ error: 'AI search failed', detail: e.message }, 500);
  }
}

/* ════════════════════════════════════════════════════════════════════
   VIBE SEARCH — /api/vibe-search (POST {query, exclude}).
   Semantic search over our own catalog, plus the 70B model's own picks:
     1. read    two calls at once, JSON mode. VIBE_READ_MODEL (8B, ~1s): route, an
                English rewrite, an imagined TMDB overview of the ideal film, year /
                runtime / language limits, genres to avoid; the search starts on it.
                VIBE_PICK_MODEL (70B, ~2-3s): kind (described / plenty / rare), the
                model's picks (the described film and up to 6 well-loved fits),
                "like X" titles never to return, and newest (they want what's just
                out). The picks carry what the 70B knows; the catalog keeps only
                real ones within the limits. A query the 8B calls a bare title is
                also looked up as one: that exact film goes first.
     2. embed   the raw query, the rewrite and the overview in one bge-m3 call
                (multilingual: the raw query lands next to English overviews too);
                the guesses are looked up by title on TMDB and fetched by id.
     3. search  VECTORIZE (findfilm-films: the ~50K most-voted TMDB films from
                tools/vibe/ingest.mjs, plus the new releases sync-worker.js's
                syncVibeIndex adds each night; both write tools/vibe/film-doc.mjs's
                text and metadata, which must match _vibeRow / _vibeDoc here) with
                each vector, top 50 with metadata, merged by weighted reciprocal rank.
                A recent-releases lane (the last two years only) counts for one
                described film or the newest: the 70B can't name a film out this week.
     4. rerank  the best 40 with bge-reranker-base (0..1 relevance) against the rewrite, then
                blend: reranker (only when it is sure), reciprocal rank, TMDB rating
                (by its votes, under 31), vote count, a bonus for a guess the catalog
                confirmed, and for the newest, recency and a title with the query's words.
     5. reply   VIBE_REPLY_MODEL (JSON mode) grades the top 10 (fit 0-3) with a
                pitch + tags each, FF Bot's line, and how good the match is. The
                blend keeps the order; fit 0-1 films drop out while 6 remain.
   Streaming: with Accept: text/event-stream, the stages go out as Server-Sent Events
   (parsed ~1s, results = the cards ~4s, reply = FF Bot's grades and words, done).
   Same payload as handleAISearch's aiCurated branch (TMDB rows rebuilt from
   the metadata) plus vibeSearch/match, so the AI panel renders it as is.
   Person queries and any failure go to handleAISearch. ?debug=1 adds the
   parse, the stage timings, the reply model's input and answer, and the scored
   list (and skips the cache). KV cache: vbs:v5:<sha-256 of query + exclusions>,
   6h when every stage worked, else 5 min.
════════════════════════════════════════════════════════════════════ */
// Two reads at once. The 8B (~1s) writes the rewrite, the imagined overview and the limits, so the
// vector search starts right away. The 70B names films (its picks are what the search leans on: the
// 8B's were clearly worse, Kiki's Delivery Service for a space-cat mafia) with a short answer, ~2-3s
// instead of the 4-6s of one 70B call doing everything. The 8B also grades and pitches, ~3-4s for
// all 10 (the 70B took 5-10s there, Llama 4 Scout ~13s). All-70B was 10-17s a search.
const VIBE_READ_MODEL   = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
const VIBE_PICK_MODEL   = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const VIBE_REPLY_MODEL  = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
const VIBE_EMBED_MODEL  = '@cf/baai/bge-m3';
// Alternatives, for comparing with ?debug=1&rd=<key> (read) / &pk=<key> (picks) / &rm=<key> (reply).
const VIBE_ALT_MODELS   = {
  '70b': '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '8b': '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  scout: '@cf/meta/llama-4-scout-17b-16e-instruct',
};
const VIBE_RERANK_MODEL = '@cf/baai/bge-reranker-base';
// How long the cards wait for the 70B's picks, from the start of the search. Past it the search goes on
// without them, and that weaker answer is cached for 5 minutes, not 6 hours (pickOk). At 5s about 1
// search in 10 lost its picks (2026-11-04); the AI panel waits 20s for the cards.
const VIBE_PICK_WAIT_MS = 8000;
// The reranker alone is sure of the film they describe (one plot the 70B can't name, e.g. a film out
// this week) when the first candidate scores at least RR_SURE and no other in the top 10 reaches RR_ALONE,
// unless the 70B calls the request a mood ("plenty"). Over 120 production searches (2026-11-04): 14 right,
// 0 wrong; 0.9 caught half of them, and on a mood 0.8 once picked McFarland, USA.
const VIBE_RR_SURE = 0.8, VIBE_RR_ALONE = 0.5;
// A TMDB rating counts fully from this many votes (the bulk ingest's floor, so the ~50K films it
// indexed score as before); below it, in proportion: the nightly ingest's films out this week have
// a handful of votes, and one 10/10 is not a 10.
const _VIBE_SURE_VOTES = 31;
const _GENRE_NAME = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary',
  18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller',
  10752: 'War', 37: 'Western',
};

const _VIBE_READ_SCHEMA = {
  type: 'object',
  properties: {
    route:       { type: 'string' },
    english:     { type: 'string' },
    synopsis:    { type: 'string' },
    yearMin:     { type: 'integer' },
    yearMax:     { type: 'integer' },
    runtimeMax:  { type: 'integer' },
    language:    { type: 'string' },
    avoidGenres: { type: 'array', items: { type: 'string' } },
    person:      { type: 'string' },
    userLanguage:{ type: 'string' },
  },
  required: ['route', 'english', 'synopsis', 'yearMin', 'yearMax', 'runtimeMax', 'language', 'avoidGenres', 'person', 'userLanguage'],
};

// The 70B writes the fields in this order, so it names the films before it judges the kind. With kind
// first (d8203ed, 2026-10-31) it settled on "rare" before recalling anything and then had to answer
// guesses: [] — Parasite from "a poor family takes over a rich family's house by posing as tutors",
// 0 of 3 times; films first, 48 of 48 known answers as the first guess (2026-11-04).
const _VIBE_PICK_SCHEMA = {
  type: 'object',
  properties: {
    guesses:    { type: 'array', items: { type: 'string' } },
    likeTitles: { type: 'array', items: { type: 'string' } },
    kind:       { type: 'string' },
    newest:     { type: 'boolean' },
  },
  required: ['guesses', 'likeTitles', 'kind', 'newest'],
};

// The 8B writes the fields in the order of `properties` (`required` doesn't set it): match and message
// first. Films first was tried on 2026-11-04 (320 replies on the same inputs): it then argued with its
// own grades on moods (hedged 15% against 5%) and ran past max_tokens 2.5% of the time (0 of 440 this
// way); the line it writes up front is what a cut-off reply still has (_vibeReplyJSON).
// Each film's pitch before its fit: named "reason" and listed after the fit, the 8B graded only 4-6 of
// the 10 in about half the searches and argued its grades ("not a time loop").
const _VIBE_REPLY_SCHEMA = {
  type: 'object',
  properties: {
    match:   { type: 'string' },
    message: { type: 'string' },
    films: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, pitch: { type: 'string' }, fit: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } },
        required: ['id', 'pitch', 'fit', 'tags'],
      },
    },
    refinements: { type: 'array', items: { type: 'string' } },
  },
  required: ['films', 'match', 'message', 'refinements'],
};

function _vibeReadPrompt(year) {
  return 'You turn a movie search request, in any language, into JSON for a semantic movie search engine.\n' +
    '- route: "person" only if the request is mainly "films with/by <a real actor or director>"; "title" if it is just a film\'s title; otherwise "vibe".\n' +
    '- english: the request as one clear English sentence, keeping every detail (plot points, mood, setting, era, audience, what to avoid).\n' +
    '- synopsis: 2-3 sentences written like a TMDB overview of a film that would match it perfectly. Plausible, specific, no real title.\n' +
    `- yearMin / yearMax: only if the request limits the release years ("90s" → 1990 / 1999, "recent" → ${year - 10} / ${year}, ` +
    `"new" or "this year" → ${year - 2} / ${year}); else 0.\n` +
    '- runtimeMax: minutes, only if they ask for something short ("under 90 minutes" → 90, "short" → 100, "nothing too long" → 120); else 0.\n' +
    '- language: ISO 639-1 code of the films\' ORIGINAL language, only if explicitly asked ("Korean movies" → "ko", "anime" → "ja"); else "".\n' +
    '- avoidGenres: TMDB genres the request says to avoid, from: ' + Object.values(_GENRE_NAME).join(', ') + '.\n' +
    '- person: the name when route is "person", else "".\n' +
    '- userLanguage: ISO 639-1 code of the language the request is written in.';
}

const _VIBE_PICK_PROMPT =
  'You are a film expert helping a movie search engine. For the request (any language), answer with JSON:\n' +
  '- kind: "described" if they describe one specific film; "plenty" if it is a mood, genre or theme with many real films; ' +
  '"rare" if it is a specific premise no real film quite has (e.g. a space cat running the mafia).\n' +
  '- guesses: if they describe one specific film, that film first; then up to 6 real, well-loved films ("Title (Year)", the ' +
  'English title as TMDB lists it, whatever language the request is in) that fit ' +
  'the request best and respect every limit in it (years, length, language, what to avoid). Only films you are sure exist. ' +
  '[] for an impossible premise only if nothing real is close.\n' +
  '- likeTitles: films the user names only as a reference ("like Amélie", "in the style of Drive"): their titles, never to be ' +
  'recommended back; else [].\n' +
  '- newest: true only if they ask for a film that is new or just out ("the new Godzilla movie", "the latest Pixar film", ' +
  '"a new horror movie in theaters"); false otherwise, including when "new" is part of a name, a place or a holiday ' +
  '("New York", "New Year\'s Eve", "New Orleans").';

// Tuned on 33 real searches (the bench queries and four more) with ?debug=1's replyInput. The 8B copies
// any example sentence into unrelated films and parrots instructions into the message, so there are
// none; only a search with no real film gets a Note line, and one the search is sure of a Found line.
const _VIBE_REPLY_PROMPT =
`You are FF Bot, the film-loving robot of FindFilm.ai: a warm, witty friend who has seen everything. A user told you what they want to watch; our search engine found the candidates below (n|title (year)|genres|vibe|overview), best first.

films: EVERY candidate, in order, each with:
- id: its n.
- pitch: one sentence of 10-18 words, the way a friend who loves the film would sell it to them: something concrete from its overview (a character by name, a place, a situation), then why that is exactly their kind of film. Mix how pitches open: a name, a place, a moment, sometimes "you". Never open with "Join", "Meet", "Experience", "Get ready", "Discover" or "Witness". No filler endings like "in this heartwarming tale". Use your own words, not the request's. Only claim what its genres, vibe and overview support. Say what the film has, never what it lacks or how it differs.
- fit, 0-3: 3 = exactly what they asked for, 2 = a good fit, 1 = loosely related, 0 = does not fit. Go by the genres, vibe and overview: a live-action film is not "animated". A film that only shares a word with the request (like "darker" in its title) is 0. The candidate a "Found" line names is 3.
- tags: 2-3 short tags (1-3 words) for what stands out about it.

match: "exact" if the film they describe, or films that are what they ask for, are in the list; "close" if they only come near; "none" if nothing fits.
message: one sentence of at most 25 words handing these over in FF Bot's voice: playful, specific, naming the one you'd watch first. Sound like a friend, not a search engine. Be upbeat, unless the request has a "Note" line: then follow it, in your own words. If it has a "Found" line, that candidate is the very film they described: hand it over by name, with confidence. Never start with "Get ready", "You're in luck", "These are" or "I've got", and never say "just the ticket", "matches", "found" or "your request".
refinements: 3-4 follow-ups of 1-3 words, specific to this request, each a different direction (a mood, an era, a place, a kind of story).
Write everything in English.`;

// A request that excludes something says so ("no horror", "without gore", "not too long", "nothing scary").
const _VIBE_NEGATION = /\b(no|not|non|without|avoid|avoiding|except|excluding|nothing|never|skip|minus|don'?t|doesn'?t|isn'?t|aren'?t|won'?t|free of|other than|instead of|rather than)\b|-free\b/i;

// FF Bot hedging about the list ("none that perfectly capture…", "not quite", "the closest I could find").
// It also matches praise ("Nothing says cozy quite like Paddington 2"), so it only counts when the 8B's
// own match is below "exact": all 78 hedges seen on 2026-11-04 came with "close" or "none".
const _VIBE_MESSAGE_DOUBT = /\b(none(?! other)|nothing(?! short)|no films?|no movies?)\b[^.!?]{0,40}\b(quite|exactly|perfectly|fully|an? (exact|perfect) (match|fit))\b|\b(aren['’]?t|isn['’]?t|doesn['’]?t|don['’]?t|not)(\s+[\w'’]+){0,2}\s+(quite|exactly|perfectly|an? (exact|perfect))\b|\bcouldn['’]?t find\b|\bclosest\b|\bno (perfect|exact)\b|\bcome[s]? close\b/i;

// A pitch that argues against its own film ("…but no mafia in sight") is a grade, not a pitch.
const _VIBE_PITCH_DOUBT = /\b(but (it'?s |it is )?not|but no|isn'?t|doesn'?t|not exactly|rather than|instead of|lacks?|minus the|more [\w -]{2,30} than)\b/i;

// TMDB's own codes where they differ from ISO 639-1: cn = Cantonese, sh = Serbo-Croatian.
const _TMDB_LANG = { zh: ['zh', 'cn'], cn: ['zh', 'cn'], sr: ['sr', 'sh'], hr: ['hr', 'sh'], bs: ['bs', 'sh'] };
const _VIBE_FILLER = new Set(['movie', 'movies', 'film', 'films', 'or', 'and', 'any', 'anything', 'stuff', 'too', 'very', 'please', 'genre']);

// An exclusion phrase → genre ids, only when it is nothing but genres and filler
// ("horror", "horror movies", "sci-fi or horror"). Anything else ("horror or gore",
// "family drama") is left to the models, which see the exclusions verbatim.
function _vibeExcludeGenres(phrase) {
  const words = String(phrase).toLowerCase().split(/[^a-z-]+/).filter(w => w && !_VIBE_FILLER.has(w));
  const ids = [];
  for (let i = 0; i < words.length; i++) {
    const pair = _GENRE_MAP[words[i] + ' ' + (words[i + 1] || '')];
    if (pair) { ids.push(pair); i++; continue; }
    if (!_GENRE_MAP[words[i]]) return [];
    ids.push(_GENRE_MAP[words[i]]);
  }
  // Two genres side by side are one idea ("family drama"): only "x or y" / "x, y" lists split.
  return ids.length > 1 && !/\b(or|and|nor)\b|[,&/]/.test(String(phrase).toLowerCase()) ? [] : ids;
}

// Is there a film person (actor, director…) of exactly this name on TMDB? Accents and case aside.
async function _vibeIsPerson(name, env) {
  try {
    const u = new URL('https://api.themoviedb.org/3/search/person');
    u.searchParams.set('api_key', env.TMDB_KEY);
    u.searchParams.set('query', name);
    const r = await fetch(u.toString(), { headers: { 'User-Agent': 'FindFilm.ai/1.0' } });
    const d = r.ok ? await r.json() : null;
    return (d?.results || []).slice(0, 3).some(p => _vibeTitleKey(p.name) === _vibeTitleKey(name));
  } catch { return true; }   // TMDB unreachable: trust the read, as before
}

// "WALL·E", "Wall-E" and "wall e" are one title.
function _vibeTitleKey(t) {
  return String(t || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function _vibeJSON(out) {
  // JSON mode puts an object in `response`, at times answers in OpenAI's chat shape
  // (choices[0].message.content, seen from the 70B on 2026-11-03), and some answers still arrive as text.
  const r = out?.response ?? out?.choices?.[0]?.message?.content ?? out;
  if (r && typeof r === 'object') return r;
  const m = String(r || '').match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// FF Bot's reply, also when it was cut off at max_tokens: now and then the 8B runs on (a film's pitch
// too long, or an endless run of whitespace in JSON mode). The match, the message and every film
// before the cut are kept: the text is closed after the last complete film.
function _vibeReplyJSON(out) {
  try {
    const whole = _vibeJSON(out);
    if (whole) return whole;
  } catch { /* cut off: salvage below */ }
  const text = String(out?.response ?? out?.choices?.[0]?.message?.content ?? '');
  const films = text.indexOf('"films"');
  if (films < 0) return null;
  for (let j = text.lastIndexOf('}'), tries = 0; j > films && tries < 40; j = text.lastIndexOf('}', j - 1), tries++) {
    try {
      const r = JSON.parse(text.slice(text.indexOf('{'), j + 1) + ']}');
      if (Array.isArray(r.films)) {
        console.log(`[vibe-search] reply cut off: kept ${r.films.length} films`);
        return Object.assign(r, { cut: true });
      }
    } catch { /* not a film's end: try the one before */ }
  }
  return null;
}

// A metadata record (see tools/vibe/ingest.mjs) → the TMDB row fromTMDb() expects.
function _vibeRow(id, m) {
  return {
    id,
    title: m.t, original_title: m.ot || m.t, overview: m.o || '', release_date: m.d || '',
    genre_ids: m.g ? String(m.g).split(',').map(Number).filter(Boolean) : [],
    vote_average: (m.rating || 0) / 10, vote_count: m.votes || 0, popularity: m.pop || 0,
    poster_path: m.p || null, backdrop_path: m.b || null, original_language: m.lang || '',
    adult: false, video: false,
  };
}

const _vibeGenres = m => (m.g ? String(m.g).split(',') : []).map(g => _GENRE_NAME[g]).filter(Boolean).join(', ');

// The short text the reranker reads for a candidate.
function _vibeDoc(m) {
  return `${m.t} (${m.year || '?'}). ${_vibeGenres(m)}. ${String(m.o || '').slice(0, 320)} Vibe: ${String(m.vt || '').split('|').join(', ')}.`;
}

async function handleVibeSearch(request, url, env, cors, waitUntil) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let query, exclude = [];
  try {
    const body = await request.json();
    query = String(body.query || '').trim().slice(0, 1000);
    exclude = Array.isArray(body.exclude)
      ? body.exclude.filter(x => typeof x === 'string').map(x => x.trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 8)
      : [];
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!query) return json({ error: 'Missing query' }, 400);

  // The old path, for person queries and as the safety net: same body, fresh Request.
  const legacy = () => handleAISearch(new Request(request.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, exclude }),
  }), env, cors, waitUntil);
  if (!env.VECTORIZE || !env.AI) return legacy();

  const debug = url.searchParams.get('debug') === '1';
  // A fixed-length key whatever the query's script (KV keys stop at 512 bytes).
  const keyText = query.toLowerCase().replace(/\s+/g, ' ') + (exclude.length ? '|x:' + [...exclude].sort().join(',') : '');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyText)));
  const cacheKey = 'vbs:v5:' + [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
  if (env.MOVIES_CACHE && !debug) {
    try {
      const hit = await env.MOVIES_CACHE.get(cacheKey);
      if (hit) {
        const c = JSON.parse(hit);
        if (c.delegate) return legacy();          // a person query: the old path (and its own cache) answers
        return json({ ...c, cached: true });       // plain JSON even to a streaming client: it is instant
      }
    } catch { /* cache miss */ }
  }
  // Six hours for a complete answer; five minutes when a stage failed; never from ?debug=1.
  const remember = (payload, ttl) => {
    if (!env.MOVIES_CACHE || debug) return;
    const w = env.MOVIES_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: ttl }).catch(() => {});
    if (waitUntil) waitUntil(w);
  };
  const pickModel = key => (debug && VIBE_ALT_MODELS[url.searchParams.get(key)]) || null;
  const ctx = {
    query, exclude, env, debug, remember,
    models: { read: pickModel('rd') || VIBE_READ_MODEL, pick: pickModel('pk') || VIBE_PICK_MODEL, reply: pickModel('rm') || VIBE_REPLY_MODEL },
  };

  // JSON (the benchmark, ?debug=1, any caller that doesn't ask for a stream).
  if (debug || !/text\/event-stream/.test(request.headers.get('Accept') || '')) {
    try {
      const out = await _vibeRun(ctx, () => {});
      return out.legacy ? legacy() : json(out.payload);
    } catch (e) {
      console.error('[vibe-search] failed, using /api/ai-search:', e.message);
      return legacy();
    }
  }

  // Streaming (the AI panel sends Accept: text/event-stream): the same run, its stages as Server-Sent
  // Events: parsed (~1s: what FF Bot understood), results (the cards, ~4s), reply (reasons, tags,
  // drops, FF Bot's line, refinements; the final list), done. A hand-off to /api/ai-search decided
  // after the stream opened (a person query, nothing found, an error) arrives as one `final` event.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter(), enc = new TextEncoder();
  let shown = false;
  const emit = (event, data) => {
    if (event === 'results') shown = true;
    return writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {});
  };
  const fallback = async () => {
    try { emit('final', await (await legacy()).json()); } catch { emit('error', { error: 'search failed' }); }
  };
  const run = (async () => {
    try {
      const out = await _vibeRun(ctx, emit);
      if (out.legacy) await fallback();
    } catch (e) {
      console.error('[vibe-search] failed mid-stream:', e.message);
      if (!shown) await fallback();               // cards already on screen stay; nothing replaces them
    }
    await emit('done', {});
    await writer.close().catch(() => {});
  })();
  if (waitUntil) waitUntil(run);
  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', ...cors },
  });
}

/* The vibe-search run (see the block above handleVibeSearch). emit(event, data) gets each stage
   as it is ready; it returns {payload} or {legacy: true} (hand the query to /api/ai-search). */
async function _vibeRun({ query, exclude, env, debug, remember, models }, emit) {
  const t0 = Date.now(), ms = {};
  const year = new Date().getUTCFullYear();
  const userMsg = exclude.length ? `${query}\nAvoid: ${exclude.join('; ')}` : query;
  const ask = (model, system, schema, maxTokens) => env.AI.run(model, {
    messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
    response_format: { type: 'json_schema', json_schema: schema },
    max_tokens: maxTokens,
    temperature: 0.2,
  }).then(_vibeJSON).catch(e => { console.error('[vibe-search] model call failed:', model, e.message); return null; });

  // 1. Two reads at once: the 8B's quick one starts the search; the 70B is still naming films.
  // Token limits leave room for JSON mode's pretty-printing: a reply cut off mid-array was the
  // usual "reply failed" (and a cut-off pick silently loses the 70B's picks).
  const pickP = ask(models.pick, _VIBE_PICK_PROMPT, _VIBE_PICK_SCHEMA, 500).then(r => { ms.pick = Date.now() - t0; return r || {}; });
  const read = (await ask(models.read, _vibeReadPrompt(year), _VIBE_READ_SCHEMA, 700)) || {};
  ms.read = Date.now() - t0;
  // Only a name that is really in the query (the 8B now and then calls a vibe query a "person" one):
  // one of its words, accents stripped ("Tarantino movies" → Quentin Tarantino, "Penelope Cruz" →
  // Penélope Cruz). A query in a non-Latin script can't be checked that way, so the route is trusted.
  // And TMDB must know a person by exactly that name (the 8B once made "New York" the person in
  // "a gritty 70s new york crime film").
  const person = String(read.person || '').trim();
  const qKey = _vibeTitleKey(query), qWordSet = new Set(qKey.split(' '));
  const named = person.length > 2 && (!qKey || _vibeTitleKey(person).split(' ').some(w => w.length >= 3 && qWordSet.has(w)));
  if (read.route === 'person' && named && await _vibeIsPerson(person, env)) {
    console.log(`[vibe-search] "${query.slice(0, 80)}" → the actor path for "${person}"`);
    remember({ delegate: 'person' }, 21600);
    return { legacy: true };
  }
  // A query that is just a film's title ("Godzilla Minus Zero"): looked up by that title, and a film
  // of exactly that name in the catalog goes first. The 70B can't name a film out this week, and the
  // 8B writes a made-up plot for its rewrite, so neither the picks nor the vectors find it otherwise.
  const titleIn = read.route === 'title' ? query.match(/^(.*?)\s*(?:\(?((?:19|20)\d{2})\)?)?\s*$/) : null;
  const titleP = titleIn && titleIn[1].length >= 2
    ? _tmdbFindMovie(titleIn[1], titleIn[2] ? Number(titleIn[2]) : null, env).then(r =>
        r && [r.title, r.original_title].some(t => _vibeTitleKey(t) === _vibeTitleKey(titleIn[1])) ? r : null).catch(() => null)
    : Promise.resolve(null);
  const readOk = !!read.english;
  const english  = String(read.english || query).slice(0, 600);
  const synopsis = String(read.synopsis || '').slice(0, 900);

  // Filters: only limits the query actually stated, sanity-checked.
  const yearMin = Number.isInteger(read.yearMin) && read.yearMin >= 1900 && read.yearMin <= year ? read.yearMin : 0;
  const yearMax = Number.isInteger(read.yearMax) && read.yearMax >= 1900 && read.yearMax <= year + 1 ? read.yearMax : 0;
  const runtimeMax = Number.isInteger(read.runtimeMax) && read.runtimeMax >= 40 && read.runtimeMax <= 300 ? read.runtimeMax : 0;
  const language = /^[a-z]{2}$/.test(String(read.language || '')) ? read.language : '';
  const filter = {};
  if (yearMin || yearMax) filter.year = { ...(yearMin ? { $gte: yearMin } : {}), ...(yearMax ? { $lte: yearMax } : {}) };
  if (runtimeMax) filter.runtime = { $gt: 0, $lte: runtimeMax };
  if (language) filter.lang = { $in: _TMDB_LANG[language] || [language] };
  // The 8B's genres to avoid count only when the request says to avoid something, and never as a near
  // blanket: for "a beautiful animated film that will make adults cry" it listed 12 to 18 of the 19
  // genres, Animation among them, and an empty pool sent the search to /api/ai-search (2026-11-04).
  const readAvoid = (Array.isArray(read.avoidGenres) ? read.avoidGenres : []).map(g => _GENRE_MAP[String(g).toLowerCase().trim()]).filter(Boolean);
  const saysAvoid = _VIBE_NEGATION.test(`${query} ${english}`);
  const avoid = new Set([
    ...(saysAvoid && new Set(readAvoid).size < 10 ? readAvoid : []),
    ...exclude.flatMap(_vibeExcludeGenres),
  ].filter(Boolean));
  // Other exclusions ("sad", "gore") drop a film only when one of its whole tags or keywords says so.
  const avoidRe = exclude.filter(w => !_vibeExcludeGenres(w).length)
    .map(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
  emit('parsed', { english, filters: { yearMin, yearMax, runtimeMax, language }, avoid: [...avoid].map(g => _GENRE_NAME[g]).filter(Boolean) });

  // 2. Embed the query, the rewrite and the imagined overview in one call; search with each.
  const texts = [query, english, synopsis].filter(Boolean);
  const emb = await env.AI.run(VIBE_EMBED_MODEL, { text: texts });
  const vecs = emb?.data || emb?.response?.data || emb?.response;
  if (!Array.isArray(vecs) || vecs.length !== texts.length) throw new Error('embedding failed');
  const weight = t => t === english || t === synopsis ? 1 : 0.7;
  const searches = vecs.map((v, k) => ({ v, w: weight(texts[k]), filter }));
  // The recent-releases lane: the nightly ingest (syncVibeIndex in sync-worker.js) adds the films out
  // this week. They have few votes yet and the 70B can't name them, so among ~50K films a loose
  // description of one seldom makes the top 50. The query and the rewrite are searched again among the
  // films of the last two calendar years only, unless the query's own years already say so (or
  // exclude them). Its results count only when the request is for one film or for the newest (see
  // below): on moods (benchmark, 2026-11-04) it put 2025-26 films in 8 of 84 top-6 places, some of
  // them misfits (Hamnet for "a beautiful animated film"), where the search had none before.
  const freshFrom = year - 1;
  if (!(yearMin >= freshFrom) && !(yearMax && yearMax < freshFrom)) {
    const freshFilter = { ...filter, year: { $gte: freshFrom, ...(yearMax ? { $lte: yearMax } : {}) } };
    for (const t of new Set([query, english])) searches.push({ v: vecs[texts.indexOf(t)], w: 0.7, filter: freshFilter, fresh: true });
  }
  const lists = await Promise.all(searches.map(s =>
    env.VECTORIZE.query(s.v, { topK: 50, returnMetadata: 'all', ...(Object.keys(s.filter).length ? { filter: s.filter } : {}) })));
  ms.search = Date.now() - t0;

  // 3. The 70B's picks. Each guess ("Up (2009)") is looked up by title on TMDB, then fetched from the
  // index by id: a bare title is a poor embedding ("Up (2009)" lands nearest "Up in the Air"), a title
  // search is exact. getByIds ignores filters, so the query's limits are applied below.
  // The cards wait for the 70B only so long (VIBE_PICK_WAIT_MS): it is usually back in 1-3s, and past
  // that the search goes on without its picks (such an answer is cached for minutes, not hours: see pickOk).
  const pick = await Promise.race([pickP, new Promise(r => setTimeout(() => r({}), Math.max(0, VIBE_PICK_WAIT_MS - (Date.now() - t0))))]);
  const kind = ['described', 'plenty', 'rare'].includes(pick.kind) ? pick.kind : 'plenty';
  // "The new Godzilla movie": the newest fits go first. The 70B's picks for it are as old as its
  // training (it named Godzilla vs. Kong), so then only a pick from the last two years gets its bonus.
  const newest = pick.newest === true || yearMin >= year - 2;
  const recency = m => {    // 1 for a film out in the last 120 days, down to 0 at two years
    const days = (Date.now() - Date.parse(m.d || '')) / 86400000;
    return days >= 0 ? Math.max(0, Math.min(1, (730 - days) / 610)) : 0;
  };
  const guesses = (Array.isArray(pick.guesses) ? pick.guesses : []).filter(g => typeof g === 'string' && g.trim()).slice(0, 7).map(g => g.slice(0, 120));
  const titled = await titleP;
  let firstGuessId = null;   // the film the 70B names first: for a described film, the one they describe
  const guessed = guesses.length || titled ? await Promise.all(guesses.map(g => {
    const t = g.match(/^(.*?)\s*\((\d{4})\)\s*$/);
    return _tmdbFindMovie(t ? t[1].trim() : g.trim(), t ? Number(t[2]) : null, env).catch(() => null);
  })).then(async raws => {
    firstGuessId = raws[0]?.id ?? null;
    const ids = [...new Set([titled, ...raws].filter(Boolean).map(r => 'm' + r.id))];
    return ids.length ? env.VECTORIZE.getByIds(ids) : [];
  }).catch(() => []) : [];
  ms.guesses = Date.now() - t0;

  const pool = new Map();
  const like = new Set((Array.isArray(pick.likeTitles) ? pick.likeTitles : []).filter(t => typeof t === 'string')
    .map(t => _vibeTitleKey(t.replace(/\s*\(\d{4}\)\s*$/, ''))).filter(Boolean));
  const admit = m => {
    if (!m || !m.t || !m.p) return false;
    if (like.size && (like.has(_vibeTitleKey(m.t)) || (m.ot && like.has(_vibeTitleKey(m.ot))))) return false;   // "like X" never returns X
    if (String(m.g || '').split(',').map(Number).some(g => avoid.has(g))) return false;
    if (avoidRe.length) {
      const labels = `${m.vt || ''}|${m.kw || ''}`.split('|').filter(Boolean);
      if (avoidRe.some(re => labels.some(l => re.test(l)))) return false;
    }
    return true;
  };
  lists.forEach((res, k) => {
    if (searches[k].fresh && kind !== 'described' && !newest) return;
    const w = searches[k].w;
    (res?.matches || []).forEach((mt, rank) => {
      const id = Number(String(mt.id).slice(1));
      const m = mt.metadata || {};
      if (!id || !admit(m)) return;
      const e = pool.get(id) || { id, m, rrf: 0, best: 0, guess: 0 };
      e.rrf += w / (60 + rank);
      e.best = Math.max(e.best, mt.score);
      pool.set(id, e);
    });
  });
  for (const v of guessed || []) {
    const id = Number(String(v.id).slice(1)), m = v.metadata || {};
    if (!id || !admit(m)) continue;
    if ((yearMin && m.year < yearMin) || (yearMax && m.year > yearMax)) continue;
    if (runtimeMax && (!m.runtime || m.runtime > runtimeMax)) continue;
    if (language && !(_TMDB_LANG[language] || [language]).includes(m.lang)) continue;
    const e = pool.get(id) || { id, m, rrf: 0, best: 0, guess: 0 };
    e.rrf += 1.3 / 60;                                // as if first in a list of its own
    if (titled && id === titled.id) e.named = 1;      // the title the user typed
    else e.guess = 1;                                 // the film the model named, confirmed in our catalog
    pool.set(id, e);
  }
  const ranked = [...pool.values()].sort((a, b) => b.rrf - a.rrf).slice(0, 40);
  if (!ranked.length) {
    console.log(`[vibe-search] nothing passed the limits, using /api/ai-search: "${query.slice(0, 80)}" ${JSON.stringify({ filter, avoid: [...avoid], lists: lists.map(l => l?.matches?.length || 0) })}`);
    return { legacy: true };
  }

  // 4. Rerank against the rewrite, then blend.
  let rerankOk = false;
  try {
    const rr = await env.AI.run(VIBE_RERANK_MODEL, { query: english, contexts: ranked.map(e => ({ text: _vibeDoc(e.m) })) });
    for (const r of rr?.response || []) {
      // Workers AI already returns a 0..1 relevance here (a 2nd sigmoid squashed it all to ~0.5);
      // raw logits, should they ever come back, still get mapped into 0..1.
      if (ranked[r.id]) { ranked[r.id].rr = r.score >= 0 && r.score <= 1 ? r.score : 1 / (1 + Math.exp(-r.score)); rerankOk = true; }
    }
  } catch (e) {
    console.error('[vibe-search] rerank failed:', e.message);
  }
  ms.rerank = Date.now() - t0;
  // The blend. The reranker counts only when it is sure of something (a described plot: one film near 1,
  // the rest near 0); on pure vibes it scores everything ~0 and stays out. Rating and votes keep obscure
  // near-duplicates of the words from beating the films people love; a film the model named outright
  // and our catalog confirmed gets a bonus.
  const maxRrf = ranked[0].rrf;
  const maxRr = Math.max(0, ...ranked.map(e => e.rr || 0));
  // A film nobody named that only shares a word of its title with the query ("Fifty Shades Darker"
  // for "Amélie but darker") is a lexical echo, not a fit.
  const STOP = new Set(['movie', 'movies', 'film', 'films', 'something', 'like', 'about', 'with', 'that', 'this', 'from', 'into', 'feel', 'feels', 'where', 'what', 'some', 'very', 'more', 'than', 'have', 'will']);
  const qWords = new Set(_vibeTitleKey(`${query} ${english}`).split(' ').filter(w => w.length >= 4 && !STOP.has(w)));
  // Asked for the newest ("the new Godzilla movie"), a film of the last two years whose title has one
  // of the query's words is what they mean, and it is no echo.
  const NEW_STOP = new Set(['newest', 'latest', 'looking', 'want', 'watch', 'recent', 'release', 'released', 'theaters',
    'theatres', 'cinema', 'cinemas', 'came', 'come', 'show', 'find', 'just', 'year', 'week', 'month']);
  const newHit = e => newest && recency(e.m) > 0 && _vibeTitleKey(e.m.t).split(' ').some(w => qWords.has(w) && !NEW_STOP.has(w));
  const echo = e => !e.guess && !e.named && !newHit(e) && _vibeTitleKey(e.m.t).split(' ').some(w => qWords.has(w));
  for (const e of ranked) {
    e.score = 0.35 * (maxRr >= 0.2 ? (e.rr || 0) / maxRr : 0) + 0.30 * (e.rrf / maxRrf)
      + 0.15 * ((e.m.rating || 0) / 100) * Math.min((e.m.votes || 0) / _VIBE_SURE_VOTES, 1)
      + 0.20 * Math.min(Math.log10((e.m.votes || 0) + 1) / 4.3, 1)
      + (kind === 'rare' ? 0.08 : 0.25) * e.guess    // for an impossible premise the model's picks are only loose neighbours
        * (newest && !recency(e.m) ? 0 : 1)
      + (newest ? 0.35 * recency(e.m) + (newHit(e) ? 0.25 : 0) : 0)
      + 0.6 * (e.named || 0)
      - (kind !== 'described' && echo(e) ? 0.15 : 0);
  }
  ranked.sort((a, b) => b.score - a.score);

  // Is #1 the film they describe, by the search's own evidence? The title they typed; the 70B's first
  // pick for a described film; the newest with their words in its title; or the reranker alone sure of
  // it (the 70B can't name a film out this week: it called the Becky plot "rare"). FF Bot is then told
  // so, and never hedges about it (a reply written before its grades once said "none quite capture" with
  // Parasite at #1).
  // A typed title is found only by its exact match (the 70B "corrected" Godzilla Minus Zero to Minus
  // One), and the newest never by a pick older than two years (it named the 2003 Cat in the Hat). Over
  // 120 production searches: 57 right, 0 on moods; the one wrong is the 70B sure of a film it knows
  // (The Bourne Identity for a 2026 plot), which is #1 on the cards anyway.
  const lead = ranked[0];
  const rrSure = kind !== 'plenty' && (lead.rr || 0) >= VIBE_RR_SURE && ranked.slice(1, 10).every(e => (e.rr || 0) < VIBE_RR_ALONE);
  const firstPick = kind === 'described' && lead.id === firstGuessId && read.route !== 'title' && !(newest && !recency(lead.m));
  // Never a film they excluded by name ("…not groundhog day"): forcing its fit would keep it on top.
  const excludedTitle = exclude.some(x => { const k = _vibeTitleKey(x); return k && _vibeTitleKey(lead.m.t).includes(k); });
  const found = !excludedTitle && !!(lead.named || firstPick || (kind === 'described' && newHit(lead)) || rrSure);

  // The cards, now: the top 8 in blend order, each with its "feel" line until FF Bot's reasons arrive.
  const vibeTagOf = e => String(e.m.vt || '').split('|').filter(Boolean)[0];
  const interimMessage = found ? 'I think I found it!'
    : kind === 'rare' ? 'No film is exactly like that, but these come closest.' : 'Here are some I think you\'ll love.';
  const userLanguage = /^[a-z]{2}$/.test(String(read.userLanguage || '')) ? read.userLanguage : 'en';
  const first = ranked.slice(0, 8);
  emit('results', {
    aiCurated: true, vibeSearch: true, interim: true,
    match: kind === 'rare' && !found ? 'close' : 'exact',
    movies: first.map(e => _vibeRow(e.id, e.m)),
    reasons: Object.fromEntries(first.filter(e => e.m.f).map(e => [e.id, e.m.f])),
    tags: {},
    vibeTags: Object.fromEntries(first.filter(vibeTagOf).map(e => [e.id, vibeTagOf(e)])),
    message: interimMessage, translatedQuery: english, userLanguage,
  });
  ms.results = Date.now() - t0;

  // 5. FF Bot grades and explains the top 10; the blend keeps the order (an 8B reorders badly).
  const top = ranked.slice(0, 10);
  const byId = new Map(top.map(e => [e.id, e]));
  let reply = null;
  const replyInput = `Request: ${query}\n${english !== query ? `In English: ${english}\n` : ''}` +
    (found ? 'Found: candidate 1 is the film they describe.\n'
      : kind === 'rare' ? 'Note: no real film is quite this; say so warmly and honestly, then point to the nearest.\n' : '') +
    (exclude.length ? `The user does NOT want: ${exclude.join('; ')}. Leave out any candidate that is.\n` : '') + '\nCandidates:\n' +
    top.map((e, i) => `${i + 1}|${e.m.t} (${e.m.year || '?'})|${_vibeGenres(e.m)}|${String(e.m.vt || '').split('|').join(', ')}|${String(e.m.o || '').slice(0, 220)}`).join('\n');
  try {
    const deadline = Math.max(3000, 17000 - (Date.now() - t0));   // the AI panel gives up at 20s
    reply = _vibeReplyJSON(await Promise.race([
      env.AI.run(models.reply, {
        messages: [
          { role: 'system', content: _VIBE_REPLY_PROMPT },
          { role: 'user', content: replyInput },
        ],
        response_format: { type: 'json_schema', json_schema: _VIBE_REPLY_SCHEMA },
        max_tokens: 1500,
        temperature: 0.4,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`no reply within ${deadline}ms`)), deadline)),
    ]));
  } catch (e) {
    console.error('[vibe-search] reply failed:', e.message);
  }
  ms.reply = Date.now() - t0;

  const reasons = {}, tags = {}, vibeTags = {}, fit = new Map();
  let fromReply = 0;
  for (const p of (Array.isArray(reply?.films) ? reply.films : [])) {
    const id = top[Number(p?.id) - 1]?.id;          // the reply numbers candidates 1..10
    if (!id || fit.has(id)) continue;
    fit.set(id, Number.isInteger(p.fit) ? p.fit : 2);
    fromReply++;
    const pitch = typeof p.pitch === 'string' ? p.pitch.trim().replace(/[\n\r]+/g, ' ') : '';
    if (pitch && !_VIBE_PITCH_DOUBT.test(pitch)) reasons[id] = pitch.slice(0, 200);   // else its "feel" line, below
    const t = (Array.isArray(p.tags) ? p.tags : []).filter(x => typeof x === 'string').map(x => x.trim().slice(0, 26)).filter(Boolean).slice(0, 3);
    if (t.length) tags[id] = t;
  }
  for (const e of top) if (e.named) fit.set(e.id, 3);   // the title the user typed is never a misfit
  if (found) fit.set(lead.id, 3);                        // nor the film the search is sure they describe
  // Blend order; misfits (fit 0, then 1) go last and drop off while 6+ remain. A film the reply
  // didn't grade counts as doubtful (1), unless it is one of the 70B's own confirmed picks.
  // No reply at all (failed, or past its deadline): the cards already on screen stay exactly as they are.
  // A reply cut off at max_tokens never reached the films after the cut: they aren't doubtful, just ungraded.
  const graded = top.map(e => ({ id: e.id, f: fit.has(e.id) ? fit.get(e.id) : e.guess || reply?.cut ? 2 : 1 }));
  const chosen = fromReply ? graded.filter(g => g.f >= 2).map(g => g.id).slice(0, 8) : first.map(e => e.id);
  for (const level of [1, 0]) {
    for (const g of graded) if (chosen.length < 6 && g.f === level) chosen.push(g.id);
  }
  for (const e of ranked.slice(10)) { if (chosen.length >= 6) break; chosen.push(e.id); }
  for (const id of chosen) if (!reasons[id]) { const e = byId.get(id) || ranked.find(x => x.id === id); if (e?.m.f) reasons[id] = e.m.f; }
  const movies = chosen.map(id => {
    const e = byId.get(id) || ranked.find(x => x.id === id);
    if (vibeTagOf(e)) vibeTags[id] = vibeTagOf(e);
    return _vibeRow(id, e.m);
  });
  const said = ['exact', 'close', 'none'].includes(reply?.match) ? reply.match : 'close';
  // A described film the reply graded 3 was found, whatever its match says.
  const match = found ? 'exact'
    : kind === 'rare' ? (said === 'none' ? 'none' : 'close') : kind === 'plenty' || [...fit.values()].includes(3) ? 'exact' : said;
  // FF Bot's line must agree with the answer: an exact one is handed over without hedging (on moods
  // the 8B said "none exactly fit your 100-minute limit, sorry!" over films the filter kept under 100).
  let message = typeof reply?.message === 'string' && reply.message.trim() ? reply.message.trim().slice(0, 240) : null;
  if (message && match === 'exact' && said !== 'exact' && movies[0] && _VIBE_MESSAGE_DOUBT.test(message)) {
    console.log(`[vibe-search] hedging message replaced: "${message.slice(0, 120)}"`);
    const title = movies[0].title + (/[!?.]$/.test(movies[0].title) ? '' : '!');
    message = found ? `I think I found it: ${title}` : `I'd start with ${title}`;
  }
  const payload = {
    aiCurated: true,
    vibeSearch: true,
    match,
    movies,
    reasons,
    tags,
    vibeTags,
    suggestedRefinements: (Array.isArray(reply?.refinements) ? reply.refinements : [])
      .filter(x => typeof x === 'string').map(x => x.replace(/^\s*(mood|era|place|setting|story|kind of story)\s*:\s*/i, '').trim().slice(0, 30)).filter(Boolean).slice(0, 4),
    // FF Bot always says something, even if the reply call failed (the 8B misses JSON mode now and then).
    message: message || interimMessage,
    translatedQuery: english,
    userLanguage,
  };
  emit('reply', payload);
  const pickOk = !!pick.kind;   // without the 70B's picks the answer is weaker: don't keep it 6 hours
  remember(payload, readOk && pickOk && rerankOk && fromReply >= 3 && !reply?.cut ? 21600 : 300);
  if (debug) {
    payload.debug = {
      parsed: { ...read, ...pick, filter, avoid: [...avoid], newest, found, rrSure }, ms, ok: { readOk, pickOk, rerankOk, fromReply },
      replyInput, reply,
      scored: ranked.slice(0, 20).map(e => ({ id: e.id, title: e.m.t, year: e.m.year, votes: e.m.votes, rating: e.m.rating, score: +e.score.toFixed(3), rr: e.rr == null ? null : +e.rr.toFixed(3), rrf: +(e.rrf / maxRrf).toFixed(3), guess: e.guess, ...(e.named ? { named: 1 } : {}) })),
    };
  }
  return { payload };
}

/* ════════════════════════════════════════════════════════════════════
   GROUP PICKER — taste-overlap movie matchmaking for 2-5 people.
   Reuses the closed-world KV catalog (same as ai-search). Given each
   person's free-text taste, the LLM returns the movies with the widest
   SHARED appeal plus a one-line "overlap" explanation per pick.
════════════════════════════════════════════════════════════════════ */
async function handleGroupPicker(request, env, cors, waitUntil) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let people = [];
  try {
    const body = await request.json();
    people = Array.isArray(body.people)
      ? body.people
          .filter(x => typeof x === 'string')
          .map(x => x.trim().replace(/[|\n\r]+/g, ' ').slice(0, 120))
          .filter(Boolean)
          .slice(0, 5)
      : [];
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (people.length < 2) return json({ error: 'Need at least 2 people' }, 400);

  if (!env.AI)           return json({ error: 'AI not available' }, 503);
  if (!env.MOVIES_CACHE) return json({ error: 'Cache not available', hint: 'Run sync-worker first' }, 503);

  // ── KV response cache ──────────────────────────────────────────────
  // Identical taste sets (order-independent) reuse the same picks — skip the LLM.
  const cacheKey = ('grp:v1:' + people.map(p => p.toLowerCase()).sort().join('|')).slice(0, 480);
  const cacheWrite = (payload) => {
    const w = env.MOVIES_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 21600 }).catch(() => {});
    if (waitUntil) waitUntil(w);
  };
  try {
    const hit = await env.MOVIES_CACHE.get(cacheKey);
    if (hit) return json({ ...JSON.parse(hit), cached: true });
  } catch {}

  const cached = await env.MOVIES_CACHE.get('new-releases');
  if (!cached) return json({ error: 'Movie cache empty', hint: 'Daily sync has not run yet' }, 404);
  const movies = JSON.parse(cached);

  // Compact catalog string, identical format to ai-search.
  const catalog = movies.map(m => {
    const genres    = (m.genres || []).join(', ');
    const desc      = (m.desc || '').slice(0, 140).replace(/[|\n]/g, ' ');
    const dir       = m.director ? `Dir: ${m.director}. ` : '';
    const titlePart = m.titleOrig && m.titleOrig !== m.title
      ? `${m.title} / ${m.titleOrig}`
      : m.title;
    return `${m.id}|${titlePart} (${m.year || '?'})|${genres}|${dir}${desc}`;
  }).join('\n');

  const personLabels = people.map((_, i) => `Person ${i + 1}`);
  const peopleBlock  = people.map((p, i) => `  ${personLabels[i]} likes: ${p}`).join('\n');

  const systemPrompt =
    'You are a group movie-night matchmaker. ' +
    'Respond with valid JSON only — no markdown fences, no extra text. ' +
    'You are given the individual tastes of several people and a movie catalog. ' +
    'Pick the 4-6 movies from the catalog that MAXIMIZE SHARED appeal — the intersection ' +
    'everyone in the group can enjoy together, not just one person\'s personal favorite. ' +
    'Heavily penalize picks that would delight one person but bore or alienate another. ' +
    'Favor crowd-pleasers that bridge the different tastes. ' +
    'For every pick, write a short "overlap" sentence (max 15-20 words) explaining why it ' +
    'works for the WHOLE group, and list which people it most appeals to. ' +
    'Also give a one-line "groupSummary" reading the group\'s combined taste.';

  const userPrompt =
    `The group (${people.length} people):\n${peopleBlock}\n\n` +
    `Catalog (format: id|title/orig (year)|genres|description):\n\n${catalog}\n\n` +
    `Return JSON:\n` +
    `{\n` +
    `  "results": [\n` +
    `    { "id": integer, "overlap": "why this works for the whole group", "appeals": ["Person 1", "Person 3"] },\n` +
    `    ...\n` +
    `  ],\n` +
    `  "groupSummary": "one-line read of the group's combined taste"\n` +
    `}\n` +
    `Pick 4-6 movies, best shared match first. Only use IDs from the catalog. ` +
    `"appeals" MUST be a subset of: ${personLabels.join(', ')}. ` +
    `Never return an empty results array — if tastes clash, pick the safest crowd-pleasers.`;

  try {
    const aiResp = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      max_tokens:  1400,
      temperature: 0.2,
      stream:      false,
    });

    let text = '';
    if (aiResp?.choices?.[0]?.message?.content) text = aiResp.choices[0].message.content;
    else if (typeof aiResp?.response === 'string') text = aiResp.response;
    else if (typeof aiResp === 'string') text = aiResp;
    else throw new Error(`Unexpected AI response: ${JSON.stringify(aiResp).slice(0, 200)}`);

    text = text.trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in AI response');
    const result = JSON.parse(match[0]);

    const validIds   = new Set(movies.map(m => m.id));
    const labelSet    = new Set(personLabels);
    const rawResults = Array.isArray(result.results) ? result.results : [];
    const seen    = new Set();
    const ids     = [];
    const reasons = {};
    const appeals = {};

    for (const r of rawResults) {
      const id = Number(r?.id);
      if (!Number.isInteger(id) || !validIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (typeof r.overlap === 'string' && r.overlap.trim()) {
        reasons[id] = r.overlap.trim().replace(/[\n\r]+/g, ' ').slice(0, 160);
      }
      if (Array.isArray(r.appeals)) {
        const clean = r.appeals
          .filter(a => typeof a === 'string' && labelSet.has(a.trim()))
          .map(a => a.trim())
          .slice(0, 5);
        if (clean.length) appeals[id] = clean;
      }
      if (ids.length >= 6) break;
    }

    const groupSummary = typeof result.groupSummary === 'string'
      ? result.groupSummary.trim().replace(/[\n\r]+/g, ' ').slice(0, 160)
      : null;

    const payload = { ids, reasons, appeals, groupSummary, message: null };
    cacheWrite(payload);
    return json(payload);

  } catch (e) {
    console.error('[group-picker] error:', e.message);
    return json({ error: 'Group picker failed', detail: e.message }, 500);
  }
}

/* ════════════════════════════════════════════════════════════════════
   TRAILER ARC — what FF Bot reacts with, and when, while a title's trailer
   plays (FFBot.watch in assets/social.js): { arc: [[share, reaction], …] }.
   Written nightly by sync-worker.js (syncTrailerArcs) for the Trending and
   Top Rated titles, so this only reads KV. { arc: null }: use the genre's arc
   (a 200 all the same: a miss is normal, and a 404 is a console error per trailer).
════════════════════════════════════════════════════════════════════ */
async function handleRx(type, id, env, cors) {
  let hit = null;
  try { hit = await env.MOVIES_CACHE?.get(`rx:v1:${type}:${id}`, 'json'); } catch {}
  // KV keeps each beat's moment too ([share, reaction, moment]); the page needs the first two.
  const arc = Array.isArray(hit?.arc) ? hit.arc.map(b => [b[0], b[1]]) : null;
  return new Response(JSON.stringify({ arc }), {
    headers: {
      'Content-Type': 'application/json',
      // A miss may be filled tonight: an hour. An arc lasts 30 days in KV.
      'Cache-Control': `public, max-age=${arc ? 86400 : 3600}`,
      ...cors,
    },
  });
}

/* ════════════════════════════════════════════════════════════════════
   FIT SUMMARY — FF Bot's spoiler-free take on ANY film or series: who will
   love it (by the titles it compares to), what watching it is like, and an
   honest reason to skip it. The model gets TMDB's facts (genres, length,
   director or creators, cast, keywords, languages), fetched here, so every
   line is about this title; the client's title and overview are the fallback.
   Cached in KV (fit:v2:<type>:<id>:<lang>) so repeat opens are instant.
════════════════════════════════════════════════════════════════════ */
// The site's languages, by the name the model is asked to write in.
const _FIT_LANGS = { en: 'English', es: 'Spanish', fr: 'French', zh: 'Simplified Chinese', ar: 'Arabic', uk: 'Ukrainian', de: 'German', sv: 'Swedish', no: 'Norwegian (Bokmål)' };
const FIT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const _FIT_SCHEMA = {
  type: 'object',
  properties: { forYou: { type: 'string' }, experience: { type: 'string' }, skipIf: { type: 'string' } },
  required: ['forYou', 'experience', 'skipIf'],
};

// Tuned on 18 films and series in four languages. Without the facts it wrote "Horror fans will love
// this" for every horror film. Banning every stock opener made it worse: "Lovers of" and
// "Be prepared for" took their place, the comparisons got sloppier and the Ukrainian broke.
function _fitPrompt(type, lang) {
  const what = type === 'tv' ? 'series' : 'film';
  return `You are FF Bot, the film-obsessed robot of FindFilm.ai, giving a friend your honest, spoiler-free take on one ${what}: warm, witty and specific. Use what you know about this ${what} as well as the facts given. Every sentence must be true of THIS ${what} and no other.

Return JSON with three values, each one sentence of 12-24 words:
- forYou: who will love it, through a taste they already have: name one or two well-known titles or filmmakers a sharp critic would compare it to (close in tone and story, not just genre), and the hook that will grab them.
- experience: what watching it actually feels like: the pace, the tone and the standout thing (a performance, the score, the look, the writing), with a concrete detail. Don't open it with "Watching".
- skipIf: an honest, specific reason someone might not enjoy it (graphic violence, a slow first hour, a bleak tone, its length, subtitles, but only if it isn't in English; a cliffhanger ending), said kindly.
A little humour is welcome where it fits. Write titles without straight double quotes. Never reveal twists, character fates or the ending. Never write lines that would fit any ${what}, like "fans of the genre will love this", "an emotional rollercoaster" or "a must-watch".` +
    (lang !== 'en' ? `\nWrite the three values in ${_FIT_LANGS[lang]}, the way a native speaker would say them, never word for word from English, with other titles under their usual ${_FIT_LANGS[lang]} names; keep the JSON keys in English.` : '');
}

// TMDB's details (English, with credits and keywords) → the fact sheet the model reads.
function _fitFacts(type, d) {
  const title = d.title || d.name, orig = d.original_title || d.original_name;
  const year = (d.release_date || d.first_air_date || '').slice(0, 4);
  const makers = type === 'tv'
    ? (d.created_by || []).map(p => p.name)
    : (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name);
  const cast = (d.credits?.cast || []).slice(0, 4).map(c => c.name);
  const keywords = (d.keywords?.keywords || d.keywords?.results || []).slice(0, 12).map(k => k.name);
  // Its own language first: "English (some French, German)" is not a subtitled film.
  const spoken = d.spoken_languages || [];
  const own = spoken.find(l => l.iso_639_1 === d.original_language);
  const others = spoken.filter(l => l !== own).slice(0, 2).map(l => l.english_name);
  const languages = own ? own.english_name + (others.length ? ` (some ${others.join(', ')})` : '') : others.join(', ');
  const length = type === 'tv'
    ? [d.number_of_seasons && `${d.number_of_seasons} season${d.number_of_seasons > 1 ? 's' : ''}`,
       d.number_of_episodes && `${d.number_of_episodes} episodes`,
       d.episode_run_time?.[0] && `about ${d.episode_run_time[0]} min each`,
       d.status === 'Ended' && 'ended'].filter(Boolean).join(', ')
    : d.runtime ? `${d.runtime} min` : '';
  return [
    `${type === 'tv' ? 'TV series' : 'Film'}: ${title}${year ? ` (${year})` : ''}`,
    orig && orig !== title && `Original title: ${orig}`,
    languages && `Language: ${languages}`,
    d.genres?.length && `Genres: ${d.genres.map(g => g.name).join(', ')}`,
    length && `Length: ${length}`,
    makers.length && `${type === 'tv' ? 'Created by' : 'Directed by'}: ${makers.slice(0, 2).join(', ')}`,
    cast.length && `Starring: ${cast.join(', ')}`,
    d.tagline && `Tagline: ${d.tagline}`,
    keywords.length && `Keywords: ${keywords.join(', ')}`,
    d.overview && `Overview: ${String(d.overview).replace(/[\n\r]+/g, ' ').slice(0, 600)}`,
  ].filter(Boolean).join('\n');
}

async function handleFitSummary(request, env, cors, waitUntil) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let id, title, year, genres, overview, type, lang;
  try {
    const body = await request.json();
    id       = Number(body.id);
    type     = body.type === 'tv' ? 'tv' : 'movie';             // Cinematic sends type + lang; Classic sends neither
    lang     = _FIT_LANGS[body.lang] ? body.lang : 'en';
    title    = (body.title || '').toString().trim().slice(0, 200);
    year     = (body.year || '').toString().trim().slice(0, 8);
    genres   = Array.isArray(body.genres)
      ? body.genres.filter(g => typeof g === 'string').map(g => g.trim()).slice(0, 6).join(', ')
      : (body.genres || '').toString().trim().slice(0, 80);
    overview = (body.overview || '').toString().trim().replace(/[\n\r]+/g, ' ').slice(0, 600);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!Number.isInteger(id) || !title) return json({ error: 'Missing id or title' }, 400);
  if (!env.AI) return json({ error: 'AI not available' }, 503);

  // ── KV cache lookup ──────────────────────────────────────────────
  const cacheKey = `fit:v2:${type}:${id}:${lang}`;
  if (env.MOVIES_CACHE) {
    try {
      const hit = await env.MOVIES_CACHE.get(cacheKey);
      if (hit) {
        const data = JSON.parse(hit);
        return json({ ...data, cached: true });
      }
    } catch {}
  }

  // TMDB's facts, in English for the model whatever the page's language; 3s, else what the client sent.
  let facts = '';
  if (env.TMDB_KEY) {
    try {
      const u = new URL(`https://api.themoviedb.org/3/${type}/${id}`);
      u.searchParams.set('api_key', env.TMDB_KEY);
      u.searchParams.set('language', 'en-US');
      u.searchParams.set('append_to_response', 'credits,keywords');
      const r = await fetch(u.toString(), { headers: { 'User-Agent': 'FindFilm.ai/1.0' }, signal: AbortSignal.timeout(3000) });
      if (r.ok) facts = _fitFacts(type, await r.json());
    } catch (e) {
      console.error('[fit-summary] TMDB details failed:', e.message);
    }
  }
  if (!facts) {
    facts = `${type === 'tv' ? 'TV series' : 'Film'}: ${title}${year ? ` (${year})` : ''}\n` +
      (genres ? `Genres: ${genres}\n` : '') +
      (overview ? `Overview: ${overview}` : '');
  }

  try {
    const aiResp = await env.AI.run(FIT_MODEL, {
      messages: [
        { role: 'system', content: _fitPrompt(type, lang) },
        { role: 'user',   content: facts },
      ],
      response_format: { type: 'json_schema', json_schema: _FIT_SCHEMA },
      max_tokens:  400,
      temperature: 0.35,
    });
    const result = _vibeJSON(aiResp);
    if (!result) throw new Error(`Unexpected AI response: ${JSON.stringify(aiResp).slice(0, 200)}`);

    // A value cut short (a title in "straight quotes" ends the JSON string: "Liebhaber von") is dropped.
    const clean = s => {
      const v = typeof s === 'string' ? s.trim().replace(/[\n\r]+/g, ' ').slice(0, 240) : '';
      return v.length >= 25 ? v : '';
    };
    const forYou     = clean(result.forYou);
    const skipIf     = clean(result.skipIf);
    const experience = clean(result.experience);

    if (!forYou && !skipIf && !experience) throw new Error('Empty fit summary');

    const payload = { id, forYou, skipIf, experience };

    // ── Cache write (30-day TTL), non-blocking; a take missing a line is tried again next time ──
    if (env.MOVIES_CACHE && forYou && skipIf && experience) {
      const write = env.MOVIES_CACHE.put(cacheKey, JSON.stringify(payload), {
        expirationTtl: 60 * 60 * 24 * 30,
      }).catch(() => {});
      if (waitUntil) waitUntil(write);
    }

    return json({ ...payload, cached: false });

  } catch (e) {
    console.error('[fit-summary] error:', e.message);
    return json({ error: 'Fit summary failed', detail: e.message }, 500);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * "Movie Pitch" — shared voting + discussion, backed by Cloudflare D1 (env.DB).
 * Tables: pitches / votes / comments (see schema.sql).
 * All DB access uses parameterized .bind() — never string interpolation.
 * ═══════════════════════════════════════════════════════════════════════ */

const PITCH_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function genPitchId(len = 8) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < len; i++) s += PITCH_ID_ALPHABET[bytes[i] % PITCH_ID_ALPHABET.length];
  return s;
}

function pitchJson(cors) {
  return (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
}

// POST /api/pitch — create a new pitch, return { id }
async function handlePitchCreate(request, env, cors) {
  const json = pitchJson(cors);
  if (!env.DB) return json({ error: 'DB unavailable' }, 503);

  let movieId, title, year, poster;
  try {
    const body = await request.json();
    movieId = Number(body.movieId);
    title   = (body.title || '').toString().trim().slice(0, 200);
    year    = (body.year || '').toString().trim().slice(0, 8);
    poster  = (body.poster || '').toString().trim().slice(0, 300);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!Number.isInteger(movieId) || !title) return json({ error: 'Missing movieId or title' }, 400);

  const now = Date.now();
  try {
    // Generate a unique id (retry once on the rare PK collision).
    let id = genPitchId();
    let res = await env.DB
      .prepare('INSERT OR IGNORE INTO pitches (id, movie_id, title, year, poster, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, movieId, title, year, poster, now)
      .run();
    if (!res.meta || res.meta.changes === 0) {
      id = genPitchId();
      await env.DB
        .prepare('INSERT INTO pitches (id, movie_id, title, year, poster, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, movieId, title, year, poster, now)
        .run();
    }
    return json({ id });
  } catch (e) {
    console.error('[pitch create] error:', e.message);
    return json({ error: 'Create failed', detail: e.message }, 500);
  }
}

// Dispatch /api/pitch/<id>, /api/pitch/<id>/vote, /api/pitch/<id>/comment
async function handlePitchSub(rest, request, env, cors) {
  const json = pitchJson(cors);
  if (!env.DB) return json({ error: 'DB unavailable' }, 503);

  const parts = rest.split('/').filter(Boolean);   // ["id"] | ["id","vote"] | ["id","comment"]
  const id = (parts[0] || '').slice(0, 16);
  const sub = parts[1] || '';

  if (!id || !/^[A-Za-z0-9]+$/.test(id)) return json({ error: 'Bad pitch id' }, 400);

  if (!sub && request.method === 'GET')          return pitchGet(id, env, json);
  if (sub === 'vote'    && request.method === 'POST') return pitchVote(id, request, env, json);
  if (sub === 'comment' && request.method === 'POST') return pitchComment(id, request, env, json);
  return json({ error: 'Not found' }, 404);
}

async function pitchTallies(id, env) {
  const rows = await env.DB
    .prepare('SELECT vote, COUNT(*) AS c FROM votes WHERE pitch_id = ? GROUP BY vote')
    .bind(id).all();
  const votes = { yes: 0, maybe: 0, no: 0, total: 0 };
  for (const r of (rows.results || [])) {
    if (r.vote in votes) { votes[r.vote] = r.c; votes.total += r.c; }
  }
  return votes;
}

// GET /api/pitch/:id — movie meta + vote tallies + comments (the poll endpoint)
async function pitchGet(id, env, json) {
  try {
    const pitch = await env.DB
      .prepare('SELECT id, movie_id, title, year, poster, created_at FROM pitches WHERE id = ?')
      .bind(id).first();
    if (!pitch) return json({ error: 'Pitch not found' }, 404);

    const votes = await pitchTallies(id, env);
    const cRows = await env.DB
      .prepare('SELECT name, body, created_at FROM comments WHERE pitch_id = ? ORDER BY created_at DESC LIMIT 200')
      .bind(id).all();

    return json({
      id: pitch.id,
      movie: { movieId: pitch.movie_id, title: pitch.title, year: pitch.year, poster: pitch.poster },
      votes,
      comments: (cRows.results || []).map(c => ({ name: c.name, body: c.body, created_at: c.created_at })),
    });
  } catch (e) {
    console.error('[pitch get] error:', e.message);
    return json({ error: 'Fetch failed', detail: e.message }, 500);
  }
}

// POST /api/pitch/:id/vote — { voter, vote } upsert (one vote per voter)
async function pitchVote(id, request, env, json) {
  let voter, vote;
  try {
    const body = await request.json();
    voter = (body.voter || '').toString().trim().slice(0, 64);
    vote  = (body.vote || '').toString().trim().toLowerCase();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!voter) return json({ error: 'Missing voter' }, 400);
  if (!['yes', 'maybe', 'no'].includes(vote)) return json({ error: 'Invalid vote' }, 400);

  try {
    const pitch = await env.DB.prepare('SELECT id FROM pitches WHERE id = ?').bind(id).first();
    if (!pitch) return json({ error: 'Pitch not found' }, 404);

    await env.DB
      .prepare(
        'INSERT INTO votes (pitch_id, voter, vote, created_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(pitch_id, voter) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at'
      )
      .bind(id, voter, vote, Date.now())
      .run();

    return json({ ok: true, votes: await pitchTallies(id, env) });
  } catch (e) {
    console.error('[pitch vote] error:', e.message);
    return json({ error: 'Vote failed', detail: e.message }, 500);
  }
}

// POST /api/pitch/:id/comment — { name, body }
async function pitchComment(id, request, env, json) {
  let name, text;
  try {
    const body = await request.json();
    name = (body.name || '').toString().replace(/[\n\r]+/g, ' ').trim().slice(0, 40) || 'Guest';
    text = (body.body || '').toString().replace(/[\r]+/g, '').trim().slice(0, 500);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!text) return json({ error: 'Empty comment' }, 400);

  try {
    const pitch = await env.DB.prepare('SELECT id FROM pitches WHERE id = ?').bind(id).first();
    if (!pitch) return json({ error: 'Pitch not found' }, 404);

    const countRow = await env.DB
      .prepare('SELECT COUNT(*) AS c FROM comments WHERE pitch_id = ?')
      .bind(id).first();
    if (countRow && countRow.c >= 200) return json({ error: 'Comment limit reached' }, 429);

    const now = Date.now();
    await env.DB
      .prepare('INSERT INTO comments (pitch_id, name, body, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, name, text, now)
      .run();

    return json({ ok: true, comment: { name, body: text, created_at: now } });
  } catch (e) {
    console.error('[pitch comment] error:', e.message);
    return json({ error: 'Comment failed', detail: e.message }, 500);
  }
}
