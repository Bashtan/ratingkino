/* Dev-only ingest Worker for the vibe-search index (see wrangler.toml here).
   tools/vibe/ingest.mjs fetches the films from TMDB and calls these routes:

     POST /tags    {films: [{id, title, year, genres, keywords, overview}]}  ≤ 12 films
                   → {tags: {id: {tags: [...], feel: "..."}}}   (Workers AI, JSON mode)
     POST /upsert  {items: [{id, text, metadata}]}  ≤ 100 items
                   → embeds each text (bge-m3) and upserts vector "m<id>" with its metadata
     POST /query   {text, topK?, filter?}   a quick look at what the index returns
     GET  /info    the bound index's name (INDEX_NAME) and description (dimensions, vector count)

   The prompts and the model names here are the ingest half of the design in
   functions/api/[[path]].js (handleVibeSearch): change one, check the other. */
const TAG_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const EMBED_MODEL = '@cf/baai/bge-m3';
const DIMS = 1024;

const TAG_SYSTEM =
  'You tag films for a movie search that people use to find a film by its vibe. ' +
  'For EACH film, write 6-10 short lowercase tags (1-3 words each) about how it feels and what kind of watch it is: ' +
  'mood, tone, pacing, themes, setting, style, audience and distinctive hooks ' +
  '(e.g. "cozy", "slow-burn", "mind-bending", "found family", "dark humor", "heist", "talking animals", ' +
  '"space opera", "rainy-day comfort", "tearjerker", "date night", "twist ending", "coming of age"). ' +
  'Do not repeat the genre names verbatim and never use the title. ' +
  'Then one vivid "feel" sentence of 10-18 words about the experience of watching it, concrete and specific to this film ' +
  '(e.g. for Finding Nemo: "A bright, funny ocean road trip about a worried dad learning to let his kid go."). ' +
  'Use what you know about the film; if you do not know it, go by the overview. Answer for every id given.';

const TAG_SCHEMA = {
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

function parseJSON(out) {
  // JSON mode returns an object in `response`; some models still send a string.
  const r = out && typeof out === 'object' && 'response' in out ? out.response : out;
  if (r && typeof r === 'object') return r;
  const m = String(r || '').match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

async function tags({ films }, env) {
  if (!Array.isArray(films) || !films.length || films.length > 12) throw new Error('films: 1-12 items');
  const lines = films.map(f =>
    `${f.id}|${f.title} (${f.year || '?'})|${(f.genres || []).join(', ')}|${(f.keywords || []).slice(0, 10).join(', ')}|${String(f.overview || '').slice(0, 420)}`);
  const out = await env.AI.run(TAG_MODEL, {
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
  return { tags: byId };
}

async function embed(texts, env) {
  const out = await env.AI.run(EMBED_MODEL, { text: texts });
  const data = out?.data || out?.response?.data || out?.response;
  if (!Array.isArray(data) || data.length !== texts.length) throw new Error('embed: unexpected response shape ' + JSON.stringify(out).slice(0, 200));
  for (const v of data) if (!Array.isArray(v) || v.length !== DIMS) throw new Error(`embed: got ${v && v.length} dims, want ${DIMS}`);
  return data;
}

async function upsert({ items }, env) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('items: 1-100');
  const vectors = await embed(items.map(i => i.text), env);
  const rows = items.map((it, k) => ({ id: 'm' + it.id, values: vectors[k], metadata: it.metadata }));
  const res = await env.VECTORIZE.upsert(rows);
  return { count: rows.length, mutationId: res?.mutationId || null };
}

async function query({ text, topK = 10, filter }, env) {
  const [v] = await embed([text], env);
  const r = await env.VECTORIZE.query(v, { topK, filter, returnMetadata: 'all' });
  return r.matches.map(m => ({ id: m.id, score: +m.score.toFixed(4), title: m.metadata?.t, year: m.metadata?.year, vibe: m.metadata?.vt }));
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/info') return Response.json({ name: env.INDEX_NAME, ...(await env.VECTORIZE.describe()) });
      if (request.method !== 'POST') return new Response('POST only', { status: 405 });
      const body = await request.json();
      if (pathname === '/tags') return Response.json(await tags(body, env));
      if (pathname === '/upsert') return Response.json(await upsert(body, env));
      if (pathname === '/query') return Response.json(await query(body, env));
      return new Response('not found', { status: 404 });
    } catch (e) {
      return Response.json({ error: String(e && e.message || e) }, { status: 500 });
    }
  },
};
