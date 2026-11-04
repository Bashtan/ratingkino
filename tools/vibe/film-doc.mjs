/* A film in the vibe-search index (Vectorize findfilm-films): its text, its
   metadata, its vibe tags, its embedding. Shared by
     tools/vibe/ingest.mjs   the bulk ingest (Node, the 50K most-voted films)
     tools/vibe/worker.js    the dev Worker that ingest drives
     sync-worker.js          the nightly ingest of new releases (syncVibeIndex)
   so a film indexed tonight reads exactly like one from the bulk ingest.
   functions/api/[[path]].js (handleVibeSearch: _vibeRow, _vibeDoc) reads the
   metadata back: change a field here, check it there.

   A film here is a TMDB /discover row ({id, title, original_title, overview,
   release_date, genre_ids, vote_average, vote_count, popularity, poster_path,
   backdrop_path, original_language}) plus
     det  detailsRow(): runtime, tagline, keywords, director, cast
     tag  {tags, feel} from tagFilms()                                        */

export const TAG_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const EMBED_MODEL = '@cf/baai/bge-m3';
export const DIMS = 1024;

// TMDB's movie genres (/genre/movie/list, en-US).
export const GENRE_NAME = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary',
  18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller',
  10752: 'War', 37: 'Western',
};

export const genreNames = f => f.genreNames || (f.genre_ids || []).map(id => GENRE_NAME[id]).filter(Boolean);

export const cut = (s, n) => (s || '').length > n ? s.slice(0, n - 1).trimEnd() + '…' : (s || '');

// TMDB /movie/{id}?append_to_response=keywords,credits → det.
export function detailsRow(id, d) {
  return {
    id,
    runtime: d?.runtime || 0,
    tagline: (d?.tagline || '').slice(0, 160),
    kw: (d?.keywords?.keywords || []).map(k => k.name).slice(0, 15),
    dir: (d?.credits?.crew || []).find(p => p.job === 'Director')?.name || '',
    cast: (d?.credits?.cast || []).slice(0, 3).map(p => p.name),
  };
}

// The text that is embedded (bge-m3).
export function docText(f) {
  const y = (f.release_date || '').slice(0, 4);
  const d = f.det || {}, t = f.tag || {};
  const g = genreNames(f);
  return [
    `${f.title}${y ? ` (${y})` : ''}.`,
    g.length ? `${g.join(', ')}.` : '',
    d.tagline || '',
    f.overview || '',
    d.kw?.length ? `Themes: ${d.kw.slice(0, 12).join(', ')}.` : '',
    t.tags?.length ? `Vibe: ${t.tags.join(', ')}.` : '',
    t.feel || '',
    d.dir ? `Directed by ${d.dir}.` : '',
    d.cast?.length ? `Starring ${d.cast.join(', ')}.` : '',
  ].filter(Boolean).join(' ').slice(0, 2400);
}

// The metadata stored with the vector.
export function metadata(f) {
  const d = f.det || {}, t = f.tag || {};
  const m = {
    // indexed (filters): see the create-metadata-index calls in HANDOFF.md
    year: Number((f.release_date || '').slice(0, 4)) || 0,
    runtime: d.runtime || 0,
    rating: Math.round((f.vote_average || 0) * 10),
    votes: f.vote_count || 0,
    lang: f.original_language || '',
    // the TMDB row /api/vibe-search rebuilds for the AI panel, plus grounding for the reply
    t: f.title, d: f.release_date || '', g: (f.genre_ids || []).join(','),
    p: f.poster_path || '', b: f.backdrop_path || '', pop: Math.round((f.popularity || 0) * 10) / 10,
    o: cut(f.overview, 600), kw: (d.kw || []).slice(0, 12).join('|'), vt: (t.tags || []).join('|'),
    f: t.feel || '', dir: d.dir || '', cast: (d.cast || []).join('|'),
  };
  if (f.original_title && f.original_title !== f.title) m.ot = cut(f.original_title, 120);
  return m;
}

export const TAG_SYSTEM =
  'You tag films for a movie search that people use to find a film by its vibe. ' +
  'For EACH film, write 6-10 short lowercase tags (1-3 words each) about how it feels and what kind of watch it is: ' +
  'mood, tone, pacing, themes, setting, style, audience and distinctive hooks ' +
  '(e.g. "cozy", "slow-burn", "mind-bending", "found family", "dark humor", "heist", "talking animals", ' +
  '"space opera", "rainy-day comfort", "tearjerker", "date night", "twist ending", "coming of age"). ' +
  'Do not repeat the genre names verbatim and never use the title. ' +
  'Then one vivid "feel" sentence of 10-18 words about the experience of watching it, concrete and specific to this film ' +
  '(e.g. for Finding Nemo: "A bright, funny ocean road trip about a worried dad learning to let his kid go."). ' +
  'Use what you know about the film; if you do not know it, go by the overview. Answer for every id given.';

export const TAG_SCHEMA = {
  type: 'object',
  properties: {
    films: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          tags: { type: 'array', items: { type: 'string' } },
          feel: { type: 'string' },
        },
        required: ['id', 'tags', 'feel'],
      },
    },
  },
  required: ['films'],
};

// JSON mode answers with an object in `response`, at times in OpenAI's chat shape
// (choices[0].message.content), and now and then as text.
export function parseJSON(out) {
  const r = out?.response ?? out?.choices?.[0]?.message?.content ?? out;
  if (r && typeof r === 'object') return r;
  const m = String(r || '').match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// Vibe tags + a feel line for up to 12 films in one 70B call:
// films [{id, title, year, genres, keywords, overview}] → {id: {tags, feel}}.
export async function tagFilms(ai, films) {
  if (!Array.isArray(films) || !films.length || films.length > 12) throw new Error('films: 1-12 items');
  const lines = films.map(f =>
    `${f.id}|${f.title} (${f.year || '?'})|${(f.genres || []).join(', ')}|${(f.keywords || []).slice(0, 10).join(', ')}|${String(f.overview || '').slice(0, 420)}`);
  const out = await ai.run(TAG_MODEL, {
    messages: [
      { role: 'system', content: TAG_SYSTEM },
      { role: 'user', content: 'Films (id|title (year)|genres|keywords|overview):\n' + lines.join('\n') },
    ],
    response_format: { type: 'json_schema', json_schema: TAG_SCHEMA },
    max_tokens: 1800,
    temperature: 0.3,
  });
  const res = parseJSON(out);
  const want = new Set(films.map(f => Number(f.id)));
  const byId = {};
  for (const r of (res && Array.isArray(res.films) ? res.films : [])) {
    const id = Number(r && r.id);
    if (!want.has(id)) continue;
    const t = (Array.isArray(r.tags) ? r.tags : [])
      .filter(x => typeof x === 'string')
      .map(x => x.trim().toLowerCase().replace(/[|\n\r]+/g, ' ').slice(0, 32))
      .filter(Boolean)
      .slice(0, 10);
    byId[id] = { tags: [...new Set(t)], feel: String(r.feel || '').replace(/[\n\r]+/g, ' ').trim().slice(0, 160) };
  }
  return byId;
}

// The film as tagFilms() wants it.
export const tagInput = f => ({
  id: f.id, title: f.title, year: (f.release_date || '').slice(0, 4),
  genres: genreNames(f), keywords: f.det?.kw || [], overview: f.overview,
});

// bge-m3 vectors for up to 100 texts.
export async function embed(ai, texts) {
  const out = await ai.run(EMBED_MODEL, { text: texts });
  const data = out?.data || out?.response?.data || out?.response;
  if (!Array.isArray(data) || data.length !== texts.length) throw new Error('embed: unexpected response shape ' + JSON.stringify(out).slice(0, 200));
  for (const v of data) if (!Array.isArray(v) || v.length !== DIMS) throw new Error(`embed: got ${v && v.length} dims, want ${DIMS}`);
  return data;
}

export const vectorId = id => 'm' + id;
