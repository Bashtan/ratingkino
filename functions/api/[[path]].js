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

  /* ── /api/search ── two-step: TMDB title search + AI semantic fallback ── */
  if (path === '/search') {
    return handleSearch(request, env, cors, waitUntil);
  }

  /* ── /api/ai-search ── semantic movie search via Cloudflare AI ── */
  if (path === '/ai-search') {
    return handleAISearch(request, env, cors);
  }

  /* ── /api/group-picker ── taste-overlap picks for a group via Cloudflare AI ── */
  if (path === '/group-picker') {
    return handleGroupPicker(request, env, cors);
  }

  /* ── /api/fit-summary ── spoiler-free "who's it for" summary (KV-cached) ── */
  if (path === '/fit-summary') {
    return handleFitSummary(request, env, cors, waitUntil);
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
      'You are a search query parser. Return ONLY a valid JSON object — no markdown, no extra text. ' +
      'Fields: ' +
      '"clean_title_guess": if the user is searching for a specific movie title (with possible typos or in another language), normalise it to English; otherwise empty string. ' +
      '"english_keywords": core plot or vibe elements translated to English, 3-5 words max. ' +
      '"intent": "title_search" if they want a specific movie, "vibe_search" if describing a theme or mood, "actor_search" if the query is specifically about movies featuring a particular real actor/actress. ' +
      '"actor_name": the actor/actress\'s name in English if intent is actor_search; otherwise empty string. ' +
      '"user_language": ISO 639-1 code of the input language.';

    const aiResp = await env.AI.run(_INTENT_MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: `Query: "${query.slice(0, 200)}"` },
      ],
      max_tokens:  150,
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
  // Tier 1:  effectiveQuery ⊂ title or original_title (case-insensitive).
  //          Sub-sorted by _serverTitleScore: exact > prefix > all-words > any-word.
  // Tier 2:  effectiveQuery ⊂ overview/description.
  // Tier 2b: TMDB cast/crew/keyword match — no text hit in title or overview.

  const rawResults = searchData.results || [];
  const seenIds    = new Set();
  const tier1 = [], tier2 = [], tier2b = [];

  for (const m of rawResults) {
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
  let exclude = [];
  try {
    const body = await request.json();
    query = (body.query || '').trim().slice(0, 300); // cap query length
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

  // Actor-focused queries ("Best movies with Leonardo DiCaprio") bypass the
  // closed-world KV catalog entirely — they return real TMDB filmography data.
  // Any failure here (intent parse, actor not found, TMDB error) falls through
  // unchanged to the existing catalog-embedding flow below.
  if (env.AI && env.TMDB_KEY) {
    try {
      const intent = await _parseIntent(query, env);
      if (intent?.intent === 'actor_search' && intent.actor_name) {
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

          return json({
            actorQuery: true,
            personName,
            movies: actorMovies,
            reasons,
            tags,
            suggestedRefinements,
            message: null,
          });
        }
        // actor not found in TMDB — fall through to the existing catalog-based flow
      }
    } catch (e) {
      console.error('[ai-search:actor] intent parse failed:', e.message);
      // fall through to existing flow
    }
  }

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
    '(3) thematic, genre, or mood similarity — rank these LAST. ' +
    'For every result, also write a short, punchy, conversational "reason" ' +
    '(max 10-15 words) explaining specifically why THAT movie matches the ' +
    'user\'s exact query — a personalized match explanation, not a generic plot summary. ' +
    'For every result, ALSO provide "tags": an array of 2-3 very short labels (1-3 words each) ' +
    'capturing that movie\'s standout traits relevant to the query ' +
    '(e.g. "Slow-burn mystery", "Strong female lead", "Twist ending", "Feel-good"). ' +
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
    `User query: "${query}"\n\n` +
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
    `    { "id": integer, "reason": "short punchy match reason, max 10-15 words", "tags": ["1-3 word trait", "..."] },\n` +
    `    ...\n` +
    `  ],\n` +
    `  "suggestedRefinements": ["1-3 word refinement", "...", "...", "..."],\n` +
    `  "message": null\n` +
    `}\n` +
    `Each result's "tags" MUST be 2-3 short labels (1-3 words each) describing that movie's standout traits.\n` +
    `results ordered best-match first, max 20 entries.\n` +
    `Example reason for query "crime movie like Zodiac but faster": ` +
    `"Maintains the dark, gritty tone of Zodiac but with a much faster, action-packed pace."\n` +
    `suggestedRefinements must be 3-4 short (1-3 word) follow-up tweaks relevant to this ` +
    `exact query and result set, e.g. ["Darker tone", "More recent", "Based on true story", "Faster pace"].\n` +
    `If no movie is a close match, return the 3 nearest IDs (each with a "reason" explaining ` +
    `the closest connection you found) and set "message" to a short friendly note ` +
    `(e.g. "These are the closest recent releases to your request."). ` +
    `Never return an empty results array.`;

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

    const seen    = new Set();
    const ids     = [];
    const reasons = {};
    const tags    = {};
    for (const r of rawResults) {
      const id = Number(r?.id);
      if (!Number.isInteger(id) || !validIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
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

    return json({ ids, reasons, tags, suggestedRefinements, message: result.message || null });

  } catch (e) {
    console.error('[ai-search] error:', e.message);
    return json({ error: 'AI search failed', detail: e.message }, 500);
  }
}

/* ════════════════════════════════════════════════════════════════════
   GROUP PICKER — taste-overlap movie matchmaking for 2-5 people.
   Reuses the closed-world KV catalog (same as ai-search). Given each
   person's free-text taste, the LLM returns the movies with the widest
   SHARED appeal plus a one-line "overlap" explanation per pick.
════════════════════════════════════════════════════════════════════ */
async function handleGroupPicker(request, env, cors) {
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

    return json({ ids, reasons, appeals, groupSummary, message: null });

  } catch (e) {
    console.error('[group-picker] error:', e.message);
    return json({ error: 'Group picker failed', detail: e.message }, 500);
  }
}

/* ════════════════════════════════════════════════════════════════════
   FIT SUMMARY — spoiler-free "who is this for / who should skip / what
   experience it delivers" for ANY movie. Generated on demand by the LLM
   and cached in KV (key fit:{id}) so repeat opens are instant.
════════════════════════════════════════════════════════════════════ */
async function handleFitSummary(request, env, cors, waitUntil) {
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let id, title, year, genres, overview;
  try {
    const body = await request.json();
    id       = Number(body.id);
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
  const cacheKey = `fit:${id}`;
  if (env.MOVIES_CACHE) {
    try {
      const hit = await env.MOVIES_CACHE.get(cacheKey);
      if (hit) {
        const data = JSON.parse(hit);
        return json({ ...data, cached: true });
      }
    } catch {}
  }

  const systemPrompt =
    'You write spoiler-free viewing guidance for a movie discovery app. ' +
    'Respond with valid JSON only — no markdown fences, no extra text. ' +
    'NEVER reveal plot twists, character fates, surprises, or the ending. ' +
    'Focus only on tone, pace, genre, mood, and who will enjoy it. ' +
    'Return exactly this JSON: ' +
    '{ "forYou": "who will love this, one concrete sentence", ' +
    '"skipIf": "who should skip it, one honest sentence", ' +
    '"experience": "the kind of experience it delivers (tone/pace/feel), one sentence" }. ' +
    'Each value MUST be a single sentence, max 140 characters, concrete and punchy — ' +
    'no generic filler like "if you like good movies".';

  const userPrompt =
    `Movie: "${title}"${year ? ` (${year})` : ''}\n` +
    (genres ? `Genres: ${genres}\n` : '') +
    (overview ? `Overview: ${overview}\n` : '') +
    `\nWrite the spoiler-free fit guidance as JSON.`;

  try {
    const aiResp = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      max_tokens:  350,
      temperature: 0.3,
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

    const clean = s => typeof s === 'string'
      ? s.trim().replace(/[\n\r]+/g, ' ').slice(0, 160)
      : '';
    const forYou     = clean(result.forYou);
    const skipIf     = clean(result.skipIf);
    const experience = clean(result.experience);

    if (!forYou && !skipIf && !experience) throw new Error('Empty fit summary');

    const payload = { id, forYou, skipIf, experience };

    // ── Cache write (30-day TTL), non-blocking ──────────────────────
    if (env.MOVIES_CACHE) {
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
